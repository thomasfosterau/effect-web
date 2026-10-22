/**
 * Unit tests for the Service Worker entry: the Cache Storage effects, the
 * cacheability predicate, the five strategies, precache and the activate
 * sweep, and the listeners' event wiring (`respondWith` / `waitUntil`),
 * all against `memoryCacheStorage` and a stubbed `FetchHttpClient.Fetch`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { FetchFailed } from "@thomasfosterau/effect-web/net";
import {
  CacheError,
  Caches,
  cacheFirst,
  cacheNames,
  cacheOnly,
  deleteCache,
  deleteCachesExcept,
  EventLifetime,
  type EventLifetimeService,
  extendableListener,
  type FetchEventLike,
  fetchListener,
  isCacheable,
  isNavigationRequest,
  memoryCacheStorage,
  messageListener,
  networkFirst,
  networkOnly,
  openCache,
  precache,
  route,
  staleWhileRevalidate,
} from "@thomasfosterau/effect-web/service-worker";

const URL_A = "https://example.com/a";

/** A scripted `fetch`: records every call and answers with `respond`. */
const stubFetch = (
  respond: (request: Request, init: RequestInit | undefined) => Promise<Response>,
) => {
  const calls: Array<{ readonly request: Request; readonly init: RequestInit | undefined }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push({ request, init });
    return respond(request, init);
  };
  return { fetch, calls };
};

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

/**
 * An {@link EventLifetime} that keeps every background fiber, so a test can
 * wait for the writes a strategy started before asserting on the cache.
 */
const collectingLifetime = () => {
  const fibers: Array<Fiber.Fiber<unknown, unknown>> = [];
  const service: EventLifetimeService = {
    extend: (effect) =>
      Effect.asVoid(
        Effect.tap(Effect.forkDetach(effect), (fiber) => Effect.sync(() => fibers.push(fiber))),
      ),
  };
  // Settles everything started so far, including work started by work.
  const settleFrom = async (index: number): Promise<ReadonlyArray<Exit.Exit<unknown, unknown>>> => {
    const fiber = fibers[index];
    if (fiber === undefined) return [];
    const exit = await Effect.runPromise(Fiber.await(fiber));
    return [exit, ...(await settleFrom(index + 1))];
  };
  const settle = () => settleFrom(0);
  return { service, settle };
};

/** Runs `effect` against a fresh in-memory storage, a stubbed fetch and a collecting lifetime. */
const harness = (respond: Parameters<typeof stubFetch>[0]) => {
  const storage = memoryCacheStorage();
  const network = stubFetch(respond);
  const lifetime = collectingLifetime();
  const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(Caches, storage),
        Effect.provideService(FetchHttpClient.Fetch, network.fetch),
        Effect.provideService(EventLifetime, lifetime.service),
      ),
    );
  const cached = async (cacheName: string, url: string) =>
    (await (await storage.open(cacheName)).match(url))?.text();
  return { storage, network, lifetime, run, cached };
};

describe("memoryCacheStorage", () => {
  it("stores, matches and deletes by URL, handing out unread copies", async () => {
    const storage = memoryCacheStorage();
    const cache = await storage.open("v1");
    await cache.put(URL_A, new Response("a", { headers: { "x-kind": "test" } }));
    const first = await cache.match(URL_A);
    expect(await first?.text()).toBe("a");
    expect(first?.headers.get("x-kind")).toBe("test");
    expect(await (await cache.match(URL_A))?.text()).toBe("a");
    expect(await storage.match(URL_A)).toBeInstanceOf(Response);
    expect(await storage.match(URL_A, { cacheName: "other" })).toBeUndefined();
    expect((await cache.keys()).map((request) => request.url)).toStrictEqual([URL_A]);
    expect(await cache.matchAll()).toHaveLength(1);
    expect(await cache.delete(URL_A)).toBe(true);
    expect(await cache.delete(URL_A)).toBe(false);
    expect(await cache.match(URL_A)).toBeUndefined();
  });

  it("honours ignoreSearch and ignoreMethod, and never matches a POST otherwise", async () => {
    const cache = await memoryCacheStorage().open("v1");
    await cache.put(`${URL_A}?v=1`, new Response("a"));
    expect(await cache.match(`${URL_A}?v=2`)).toBeUndefined();
    expect(await cache.match(`${URL_A}?v=2`, { ignoreSearch: true })).toBeInstanceOf(Response);
    expect(await cache.keys(URL_A, { ignoreSearch: true })).toHaveLength(1);
    expect(await cache.matchAll(URL_A, { ignoreSearch: true })).toHaveLength(1);
    const post = new Request(`${URL_A}?v=1`, { method: "POST" });
    expect(await cache.match(post)).toBeUndefined();
    expect(await cache.match(post, { ignoreMethod: true })).toBeInstanceOf(Response);
  });

  it("rejects what the browser's Cache.put rejects", async () => {
    const cache = await memoryCacheStorage().open("v1");
    await expect(
      cache.put(new Request(URL_A, { method: "POST" }), new Response("a")),
    ).rejects.toThrow(TypeError);
    await expect(cache.put(URL_A, new Response("a", { status: 206 }))).rejects.toThrow(TypeError);
    await expect(cache.put(URL_A, new Response("a", { headers: { vary: "*" } }))).rejects.toThrow(
      TypeError,
    );
    const used = new Response("a");
    await used.text();
    await expect(cache.put(URL_A, used)).rejects.toThrow(TypeError);
  });

  it("adds through the injected fetch, all or nothing", async () => {
    const network = stubFetch(async (request) =>
      request.url.endsWith("/missing") ? new Response("", { status: 404 }) : new Response("ok"),
    );
    const storage = memoryCacheStorage({ fetch: network.fetch });
    const cache = await storage.open("v1");
    await cache.add(URL_A);
    expect(await (await cache.match(URL_A))?.text()).toBe("ok");
    await expect(
      cache.addAll(["https://example.com/b", "https://example.com/missing"]),
    ).rejects.toThrow(TypeError);
    expect(await cache.match("https://example.com/b")).toBeUndefined();
  });

  it("opens one cache per name and lists and deletes caches", async () => {
    const storage = memoryCacheStorage();
    expect(await storage.open("v1")).toBe(await storage.open("v1"));
    await storage.open("v2");
    expect(await storage.keys()).toStrictEqual(["v1", "v2"]);
    expect(await storage.has("v1")).toBe(true);
    expect(await storage.delete("v1")).toBe(true);
    expect(await storage.has("v1")).toBe(false);
  });
});

describe("cache storage effects", () => {
  it("open, list and delete caches", async () => {
    const { run } = harness(offline);
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* openCache("v1");
        yield* cache.put(URL_A, new Response("a"));
        const hit = yield* cache.match(URL_A);
        const keys = yield* cache.keys();
        const removed = yield* cache.delete(URL_A);
        const miss = yield* cache.match(URL_A);
        const names = yield* cacheNames;
        const deleted = yield* deleteCache("v1");
        const deletedAgain = yield* deleteCache("v1");
        return {
          hit: Option.isSome(hit),
          keys: keys.length,
          removed,
          miss,
          names,
          deleted,
          deletedAgain,
        };
      }),
    );
    expect(result).toStrictEqual({
      hit: true,
      keys: 1,
      removed: true,
      miss: Option.none(),
      names: ["v1"],
      deleted: true,
      deletedAgain: false,
    });
  });

  it("fails with a CacheError naming the operation and cache", async () => {
    const quota = new DOMException("quota", "QuotaExceededError");
    const broken: CacheStorage = {
      ...memoryCacheStorage(),
      open: () => Promise.reject(quota),
    };
    const error = await Effect.runPromise(
      Effect.flip(openCache("v1")).pipe(Effect.provideService(Caches, broken)),
    );
    expect(error).toBeInstanceOf(CacheError);
    expect(error).toMatchObject({ operation: "open", cacheName: "v1", cause: quota });
  });

  it("sweeps every cache but the kept ones, by list or by predicate", async () => {
    const { run } = harness(offline);
    const swept = await run(
      Effect.gen(function* () {
        yield* openCache("static-v1");
        yield* openCache("static-v2");
        yield* openCache("other-lib");
        const byList = yield* deleteCachesExcept(["static-v2", "other-lib"]);
        yield* openCache("static-v3");
        const byPredicate = yield* deleteCachesExcept((name) => !name.startsWith("static-"));
        return { byList, byPredicate, left: yield* cacheNames };
      }),
    );
    expect(swept).toStrictEqual({
      byList: ["static-v1"],
      byPredicate: ["static-v2", "static-v3"],
      left: ["other-lib"],
    });
  });
});

describe("isCacheable", () => {
  const get = () => new Request(URL_A);

  it("accepts a plain 200 to a GET", () => {
    expect(isCacheable(get(), new Response("ok"))).toBe(true);
    expect(
      isCacheable(get(), new Response("ok", { headers: { "cache-control": "max-age=60" } })),
    ).toBe(true);
    expect(isCacheable(get(), new Response("ok", { headers: { vary: "accept" } }))).toBe(true);
  });

  it("refuses what Cache.put would reject or the origin forbade", () => {
    expect(isCacheable(new Request(URL_A, { method: "POST" }), new Response("ok"))).toBe(false);
    expect(isCacheable(get(), new Response("", { status: 404 }))).toBe(false);
    expect(isCacheable(get(), new Response("", { status: 206 }))).toBe(false);
    expect(isCacheable(get(), Response.error())).toBe(false);
    expect(isCacheable(get(), new Response("ok", { headers: { vary: " * " } }))).toBe(false);
    Arr.forEach(
      ["no-store", "private, no-store", "No-Store , max-age=0", "no-store=1"],
      (value) => {
        expect(
          isCacheable(get(), new Response("ok", { headers: { "cache-control": value } })),
        ).toBe(false);
      },
    );
  });

  it("matches no-store as a whole directive only", () => {
    expect(
      isCacheable(get(), new Response("ok", { headers: { "cache-control": "no-storey" } })),
    ).toBe(true);
  });
});

describe("cacheFirst", () => {
  it("serves a hit without the network", async () => {
    const h = harness(offline);
    await (await h.storage.open("assets")).put(URL_A, new Response("cached"));
    const response = await h.run(cacheFirst({ cacheName: "assets" })(new Request(URL_A)));
    expect(await response.text()).toBe("cached");
    expect(h.network.calls).toHaveLength(0);
  });

  it("fetches a miss and writes it back in the background", async () => {
    const h = harness(async () => new Response("fresh"));
    const response = await h.run(cacheFirst({ cacheName: "assets" })(new Request(URL_A)));
    expect(await response.text()).toBe("fresh");
    await h.lifetime.settle();
    expect(await h.cached("assets", URL_A)).toBe("fresh");
  });

  it("writes back only what `cacheable` accepts", async () => {
    const h = harness(async () => new Response("", { status: 500 }));
    const response = await h.run(cacheFirst({ cacheName: "assets" })(new Request(URL_A)));
    expect(response.status).toBe(500);
    expect(await h.lifetime.settle()).toHaveLength(0);

    const custom = harness(async () => new Response("", { status: 500 }));
    await custom.run(
      cacheFirst({ cacheName: "assets", cacheable: () => true })(new Request(URL_A)),
    );
    await custom.lifetime.settle();
    expect(await custom.cached("assets", URL_A)).toBe("");
  });

  it("passes matchOptions to the cache", async () => {
    const h = harness(offline);
    await (await h.storage.open("assets")).put(URL_A, new Response("cached"));
    const strategy = cacheFirst({ cacheName: "assets", matchOptions: { ignoreSearch: true } });
    const response = await h.run(strategy(new Request(`${URL_A}?v=2`)));
    expect(await response.text()).toBe("cached");
  });

  it("fails with FetchFailed when the miss cannot be fetched", async () => {
    const h = harness(offline);
    const error = await h.run(Effect.flip(cacheFirst({ cacheName: "assets" })(new Request(URL_A))));
    expect(error).toBeInstanceOf(FetchFailed);
    expect(error).toMatchObject({ url: URL_A });
  });
});

describe("networkFirst", () => {
  it("serves the network and writes it back", async () => {
    const h = harness(async () => new Response("fresh"));
    await (await h.storage.open("pages")).put(URL_A, new Response("stale"));
    const response = await h.run(networkFirst({ cacheName: "pages" })(new Request(URL_A)));
    expect(await response.text()).toBe("fresh");
    await h.lifetime.settle();
    expect(await h.cached("pages", URL_A)).toBe("fresh");
  });

  it("falls back to the cache when the network fails", async () => {
    const h = harness(offline);
    await (await h.storage.open("pages")).put(URL_A, new Response("stale"));
    const response = await h.run(networkFirst({ cacheName: "pages" })(new Request(URL_A)));
    expect(await response.text()).toBe("stale");
  });

  it("fails with the network's FetchFailed when the cache misses too", async () => {
    const h = harness(offline);
    const error = await h.run(
      Effect.flip(networkFirst({ cacheName: "pages" })(new Request(URL_A))),
    );
    expect(error).toBeInstanceOf(FetchFailed);
  });

  /** A network that answers after `ms`, or rejects when its signal aborts. */
  const slow = (ms: number) => (_request: Request, init: RequestInit | undefined) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("fresh")), ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      });
    });

  it("serves the cache once the timeout elapses, aborting the network", async () => {
    const h = harness(slow(5_000));
    await (await h.storage.open("pages")).put(URL_A, new Response("stale"));
    const strategy = networkFirst({ cacheName: "pages", timeout: "20 millis" });
    const response = await h.run(strategy(new Request(URL_A)));
    expect(await response.text()).toBe("stale");
    expect(h.network.calls[0]?.init?.signal?.aborted).toBe(true);
  });

  it("keeps waiting on the network when the timeout elapses on a miss", async () => {
    const h = harness(slow(60));
    const strategy = networkFirst({ cacheName: "pages", timeout: "10 millis" });
    const response = await h.run(strategy(new Request(URL_A)));
    expect(await response.text()).toBe("fresh");
  });

  it("serves the network when it beats the timeout", async () => {
    const h = harness(async () => new Response("fresh"));
    await (await h.storage.open("pages")).put(URL_A, new Response("stale"));
    const strategy = networkFirst({ cacheName: "pages", timeout: "1 second" });
    expect(await (await h.run(strategy(new Request(URL_A)))).text()).toBe("fresh");
  });

  it("fails fast when the network fails before the timeout on a miss", async () => {
    const h = harness(offline);
    const strategy = networkFirst({ cacheName: "pages", timeout: "1 minute" });
    const error = await h.run(Effect.flip(strategy(new Request(URL_A))));
    expect(error).toBeInstanceOf(FetchFailed);
  });
});

describe("staleWhileRevalidate", () => {
  it("serves the hit and revalidates it in the background", async () => {
    const h = harness(async () => new Response("v2"));
    await (await h.storage.open("avatars")).put(URL_A, new Response("v1"));
    const response = await h.run(
      staleWhileRevalidate({ cacheName: "avatars" })(new Request(URL_A)),
    );
    expect(await response.text()).toBe("v1");
    await h.lifetime.settle();
    expect(h.network.calls).toHaveLength(1);
    expect(await h.cached("avatars", URL_A)).toBe("v2");
  });

  it("fetches a miss", async () => {
    const h = harness(async () => new Response("v1"));
    const response = await h.run(
      staleWhileRevalidate({ cacheName: "avatars" })(new Request(URL_A)),
    );
    expect(await response.text()).toBe("v1");
    await h.lifetime.settle();
    expect(await h.cached("avatars", URL_A)).toBe("v1");
  });

  it("keeps the hit when revalidation fails, and never surfaces the failure", async () => {
    const h = harness(offline);
    await (await h.storage.open("avatars")).put(URL_A, new Response("v1"));
    const response = await h.run(
      staleWhileRevalidate({ cacheName: "avatars" })(new Request(URL_A)),
    );
    expect(await response.text()).toBe("v1");
    const [exit] = await h.lifetime.settle();
    expect(exit !== undefined && Exit.isFailure(exit)).toBe(true);
    expect(await h.cached("avatars", URL_A)).toBe("v1");
  });
});

describe("cacheOnly and networkOnly", () => {
  it("cacheOnly serves a hit and fails a miss with CacheMiss", async () => {
    const h = harness(offline);
    await (await h.storage.open("shell")).put(URL_A, new Response("shell"));
    const strategy = cacheOnly({ cacheName: "shell" });
    expect(await (await h.run(strategy(new Request(URL_A)))).text()).toBe("shell");
    const miss = await h.run(Effect.flip(strategy(new Request("https://example.com/b"))));
    expect(miss).toMatchObject({
      _tag: "CacheMiss",
      cacheName: "shell",
      url: "https://example.com/b",
    });
  });

  it("networkOnly fetches and writes nothing", async () => {
    const h = harness(async () => new Response("live"));
    expect(await (await h.run(networkOnly(new Request(URL_A)))).text()).toBe("live");
    expect(await h.lifetime.settle()).toHaveLength(0);
    expect(await h.run(cacheNames)).toStrictEqual([]);
  });
});

describe("precache", () => {
  it("installs every URL, fetched past the HTTP cache", async () => {
    const h = harness(async (request) => new Response(request.url));
    await h.run(precache("shell-v1", [URL_A, new URL("https://example.com/b")]));
    expect(h.network.calls.map(({ request }) => request.cache)).toStrictEqual(["reload", "reload"]);
    expect(await h.cached("shell-v1", URL_A)).toBe(URL_A);
    expect(await h.cached("shell-v1", "https://example.com/b")).toBe("https://example.com/b");
  });

  it("writes nothing when any URL is not a 200", async () => {
    const h = harness(async (request) =>
      request.url.endsWith("/b") ? new Response("", { status: 404 }) : new Response("ok"),
    );
    const error = await h.run(Effect.flip(precache("shell-v1", [URL_A, "https://example.com/b"])));
    expect(error).toMatchObject({
      _tag: "PrecacheRejected",
      url: "https://example.com/b",
      status: 404,
    });
    expect(await h.run(cacheNames)).toStrictEqual([]);
  });

  it("writes nothing when any URL fails to fetch", async () => {
    const h = harness(offline);
    const error = await h.run(Effect.flip(precache("shell-v1", [URL_A])));
    expect(error).toBeInstanceOf(FetchFailed);
    expect(await h.run(cacheNames)).toStrictEqual([]);
  });
});

describe("route and isNavigationRequest", () => {
  it("builds a route from a predicate and a strategy", () => {
    const assets = route((request) => request.url.endsWith(".js"), networkOnly);
    expect(assets.match(new Request("https://example.com/app.js"))).toBe(true);
    expect(assets.handle).toBe(networkOnly);
  });

  it("recognises only navigations", () => {
    expect(isNavigationRequest(new Request(URL_A))).toBe(false);
    expect(isNavigationRequest({ mode: "navigate" } as Request)).toBe(true);
  });
});

/** A fake `FetchEvent` that records what the listener did with it. */
const fakeFetchEvent = (url: string) => {
  const extended: Array<Promise<unknown>> = [];
  let response: PromiseLike<Response> | Response | undefined;
  const event: FetchEventLike = {
    request: new Request(url),
    respondWith: (answer) => {
      response = answer;
    },
    waitUntil: (promise) => {
      extended.push(promise);
    },
  };
  return {
    event,
    extended,
    responded: () => response !== undefined,
    response: () => Promise.resolve(response),
  };
};

describe("fetchListener", () => {
  const build = <A>(
    listener: Effect.Effect<A>,
    storage: CacheStorage,
    fetch: typeof globalThis.fetch,
  ) =>
    Effect.runSync(
      listener.pipe(
        Effect.provideService(Caches, storage),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    );

  it("answers through the first matching route", async () => {
    const network = stubFetch(async () => new Response("network"));
    const onFetch = build(
      fetchListener([
        route(
          (request) => request.url.endsWith(".js"),
          () => Effect.succeed(new Response("first")),
        ),
        route(() => true, networkOnly),
      ]),
      memoryCacheStorage(),
      network.fetch,
    );
    const js = fakeFetchEvent("https://example.com/app.js");
    onFetch(js.event);
    expect(await (await js.response())?.text()).toBe("first");
    const page = fakeFetchEvent(URL_A);
    onFetch(page.event);
    expect(await (await page.response())?.text()).toBe("network");
  });

  it("leaves an unmatched request to the browser", () => {
    const onFetch = build(
      fetchListener([route(() => false, networkOnly)]),
      memoryCacheStorage(),
      stubFetch(offline).fetch,
    );
    const fake = fakeFetchEvent(URL_A);
    onFetch(fake.event);
    expect(fake.responded()).toBe(false);
    expect(fake.extended).toHaveLength(0);
  });

  it("binds background writes to the event's waitUntil", async () => {
    const storage = memoryCacheStorage();
    const onFetch = build(
      fetchListener([route(() => true, cacheFirst({ cacheName: "assets" }))]),
      storage,
      stubFetch(async () => new Response("fresh")).fetch,
    );
    const fake = fakeFetchEvent(URL_A);
    onFetch(fake.event);
    expect(await (await fake.response())?.text()).toBe("fresh");
    expect(fake.extended).toHaveLength(1);
    await Promise.all(fake.extended);
    expect(await (await (await storage.open("assets")).match(URL_A))?.text()).toBe("fresh");
  });

  it("rejects respondWith when the answer fails", async () => {
    const onFetch = build(
      fetchListener([route(() => true, networkOnly)]),
      memoryCacheStorage(),
      stubFetch(offline).fetch,
    );
    const fake = fakeFetchEvent(URL_A);
    onFetch(fake.event);
    await expect(fake.response()).rejects.toMatchObject({ _tag: "FetchFailed", url: URL_A });
  });
});

describe("extendableListener", () => {
  it("hands the effect's promise to waitUntil, rejecting on failure", async () => {
    const storage = memoryCacheStorage();
    const onInstall = Effect.runSync(
      extendableListener(
        (event: {
          readonly waitUntil: (promise: Promise<unknown>) => void;
          readonly fail: boolean;
        }) =>
          Effect.gen(function* () {
            if (event.fail) return yield* Effect.fail("nope");
            yield* precache("shell", []);
            return yield* cacheNames;
          }),
      ).pipe(Effect.provideService(Caches, storage)),
    );
    const pending: Array<Promise<unknown>> = [];
    const waitUntil = (promise: Promise<unknown>) => {
      pending.push(promise);
    };
    onInstall({ waitUntil, fail: false });
    onInstall({ waitUntil, fail: true });
    expect(pending).toHaveLength(2);
    await expect(pending[0]).resolves.toStrictEqual(["shell"]);
    await expect(pending[1]).rejects.toBeDefined();
  });
});

describe("messageListener", () => {
  const Ping = Schema.Struct({ type: Schema.Literal("PING"), id: Schema.Number });

  it("runs the handler on a decoded message and drops the rest", async () => {
    const seen: Array<number> = [];
    const onMessage = Effect.runSync(
      messageListener(Ping, (message) => Effect.sync(() => seen.push(message.id))),
    );
    const pending: Array<Promise<unknown>> = [];
    const waitUntil = (promise: Promise<unknown>) => {
      pending.push(promise);
    };
    onMessage({ data: { type: "PING", id: 1 }, waitUntil });
    onMessage({ data: { type: "PING", id: "one" }, waitUntil });
    onMessage({ data: null, waitUntil });
    await Promise.all(pending);
    expect(pending).toHaveLength(3);
    expect(seen).toStrictEqual([1]);
  });

  it("rejects waitUntil when the handler fails", async () => {
    const onMessage = Effect.runSync(messageListener(Ping, () => Effect.fail("handler failed")));
    const pending: Array<Promise<unknown>> = [];
    onMessage({
      data: { type: "PING", id: 1 },
      waitUntil: (promise) => void pending.push(promise),
    });
    await expect(pending[0]).rejects.toBeDefined();
  });
});

describe("EventLifetime default", () => {
  it("runs background work detached and swallows its failure", async () => {
    // The work is detached, so the answer may come back before it runs: wait
    // for the work itself (bounded), never for a fixed interval (#139).
    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const ran = yield* Deferred.make<void>();
        const lifetime = yield* EventLifetime;
        yield* lifetime.extend(
          Deferred.succeed(ran, undefined).pipe(Effect.andThen(Effect.fail("boom"))),
        );
        yield* Deferred.await(ran).pipe(Effect.timeout("1 second"));
        return "answered";
      }),
    );
    expect(answered).toBe("answered");
  });
});
