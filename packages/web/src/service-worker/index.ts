/**
 * Service Worker primitives on Effect: the Cache Storage API as typed
 * effects, the five standard caching strategies, a synchronous route table
 * that turns into a `fetch` listener, and `install` / `activate` / `message`
 * listeners whose work runs as an `Effect` inside `event.waitUntil`, and
 * persistent notifications: shown through the registration, with
 * `notificationclick` / `notificationclose` listeners.
 *
 * Nothing here touches a global at import time. The globals a worker
 * talks to are context references with global defaults, so a worker needs no
 * layer and a test swaps each for a stub:
 *
 * - {@link Caches} — the `CacheStorage` (default `globalThis.caches`);
 * - {@link Registration} — the `ServiceWorkerRegistration` notifications
 *   are shown through (default the worker's `self.registration`);
 * - `FetchHttpClient.Fetch` from `effect/http/FetchHttpClient` — the `fetch`
 *   every network step calls (default `globalThis.fetch`), the same
 *   reference Effect's own fetch client reads. A rejected `fetch` fails
 *   with `./net`'s `FetchFailed`, so one `catchTag` covers both entries.
 *
 * Event types are structural ({@link FetchEventLike},
 * {@link ExtendableEventLike}, {@link ExtendableMessageEventLike}) so this
 * entry compiles under the `dom` lib; the `webworker` lib's `FetchEvent`,
 * `ExtendableEvent` and `ExtendableMessageEvent` satisfy them.
 *
 * A listener is built by running an effect once, synchronously, while the
 * worker script evaluates: the browser only dispatches events to listeners
 * added during that first evaluation.
 *
 * @since 0.2.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { reasonOf } from "../internal/dom.ts";
import { FetchFailed } from "../net/index.ts";

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

/**
 * The part of an `ExtendableEvent` (`install`, `activate`, and the base of
 * `fetch` / `message`) this entry uses: the lifetime extension.
 *
 * @since 0.2.0
 * @category models
 */
export interface ExtendableEventLike {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * The part of a `FetchEvent` this entry uses.
 *
 * @since 0.2.0
 * @category models
 */
export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  readonly respondWith: (response: Response | PromiseLike<Response>) => void;
}

/**
 * The part of an `ExtendableMessageEvent` (a `message` event in a service
 * worker) this entry uses.
 *
 * @since 0.2.0
 * @category models
 */
export interface ExtendableMessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Which Cache Storage call failed.
 *
 * @since 0.2.0
 * @category models
 */
export type CacheOperation = "open" | "delete-cache" | "keys" | "match" | "put" | "delete";

/**
 * A Cache Storage call rejected: a `QuotaExceededError` on `put`, a
 * `SecurityError` where storage is unavailable (an opaque origin, some
 * private modes), or a `TypeError` for a request `put` refuses. `cacheName`
 * is the cache the call addressed; `""` for the storage-wide `keys`.
 *
 * @since 0.2.0
 * @category errors
 */
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  operation: Schema.Literals(["open", "delete-cache", "keys", "match", "put", "delete"]),
  cacheName: Schema.String,
  cause: Schema.Unknown,
}) {}

/**
 * {@link cacheOnly} found nothing for the request.
 *
 * @since 0.2.0
 * @category errors
 */
export class CacheMiss extends Schema.TaggedError<CacheMiss>()("CacheMiss", {
  cacheName: Schema.String,
  url: Schema.String,
}) {}

/**
 * {@link precache} fetched a URL and got something it will not install: any
 * response but a `200` (an opaque, redirected-to-error or partial response
 * included). Nothing is written when any URL fails.
 *
 * @since 0.2.0
 * @category errors
 */
export class PrecacheRejected extends Schema.TaggedError<PrecacheRejected>()("PrecacheRejected", {
  url: Schema.String,
  status: Schema.Number,
}) {}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * The `CacheStorage` every cache operation here opens caches from. Defaults
 * to `globalThis.caches`, read on first use, never at import; provide a
 * stub (`Effect.provideService(Caches, memoryCacheStorage())`) in a test.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, cacheNames, memoryCacheStorage, openCache } from "@thomasfosterau/effect-web/service-worker"
 *
 * const names = await Effect.runPromise(
 *   openCache("v1").pipe(
 *     Effect.andThen(cacheNames),
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *   ),
 * )
 * names // ["v1"]
 * ```
 *
 * @since 0.2.0
 * @category context
 */
export const Caches: Context.Reference<CacheStorage> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-web/service-worker/Caches",
  { defaultValue: () => globalThis.caches },
);

/**
 * How background work outlives the effect that started it: inside a
 * listener built here, each call registers the work with the event's
 * `waitUntil`, so the browser keeps the worker alive until it settles.
 *
 * @since 0.2.0
 * @category models
 */
export interface EventLifetimeService {
  /**
   * Starts `effect` on a detached fiber and returns at once. A failure is
   * logged at `Warning` and never reaches the caller: the response the
   * caller is serving has already been decided.
   */
  readonly extend: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>;
}

const logBackgroundFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catchCause(effect, (cause) =>
    Effect.logWarning("service-worker: background work failed", cause),
  );

const detached: EventLifetimeService = {
  extend: (effect) => Effect.asVoid(Effect.forkDetach(logBackgroundFailure(effect))),
};

/**
 * Binds background work to `event`: the detached fiber's completion is
 * handed to `event.waitUntil`. It must be called while the event is still
 * extendable (before the `respondWith` / `waitUntil` promise the listener
 * registered settles), which holds for every call made from inside the
 * listener's effect.
 */
const eventLifetime = (event: ExtendableEventLike): EventLifetimeService => ({
  extend: (effect) =>
    Effect.flatMap(Effect.forkDetach(logBackgroundFailure(effect)), (fiber) =>
      Effect.sync(() =>
        event.waitUntil(
          new Promise<void>((resolve) => {
            fiber.addObserver(() => resolve());
          }),
        ),
      ),
    ),
});

/**
 * The current event's lifetime. The listeners here provide one bound to the
 * event they handle; outside a listener (a test, a page script) the default
 * forks the work detached with nothing to keep it alive.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { EventLifetime } from "@thomasfosterau/effect-web/service-worker"
 *
 * const program = Effect.gen(function* () {
 *   const lifetime = yield* EventLifetime
 *   yield* lifetime.extend(Effect.log("after the response"))
 *   return "response"
 * })
 *
 * await Effect.runPromise(program) // "response"
 * ```
 *
 * @since 0.2.0
 * @category context
 */
export const EventLifetime: Context.Reference<EventLifetimeService> =
  /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-web/service-worker/EventLifetime", {
    defaultValue: () => detached,
  });

// ---------------------------------------------------------------------------
// Cache Storage
// ---------------------------------------------------------------------------

/**
 * One named cache, its calls as effects. `match` is `None` on a miss
 * (`Cache.match` resolves `undefined`).
 *
 * @since 0.2.0
 * @category models
 */
export interface CacheHandle {
  readonly name: string;
  readonly match: (
    request: RequestInfo | URL,
    options?: CacheQueryOptions,
  ) => Effect.Effect<Option.Option<Response>, CacheError>;
  readonly put: (request: RequestInfo | URL, response: Response) => Effect.Effect<void, CacheError>;
  readonly delete: (
    request: RequestInfo | URL,
    options?: CacheQueryOptions,
  ) => Effect.Effect<boolean, CacheError>;
  readonly keys: () => Effect.Effect<ReadonlyArray<Request>, CacheError>;
}

const cacheCall = <A>(
  operation: CacheOperation,
  cacheName: string,
  call: () => Promise<A>,
): Effect.Effect<A, CacheError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new CacheError({ operation, cacheName, cause }),
  });

const handle = (name: string, cache: Cache): CacheHandle => ({
  name,
  match: (request, options) =>
    Effect.map(
      cacheCall("match", name, () => cache.match(request, options)),
      Option.fromUndefinedOr,
    ),
  put: (request, response) => cacheCall("put", name, () => cache.put(request, response)),
  delete: (request, options) => cacheCall("delete", name, () => cache.delete(request, options)),
  keys: () => cacheCall("keys", name, () => cache.keys()),
});

/**
 * Opens (creating if absent) the cache called `name` in {@link Caches}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Caches, memoryCacheStorage, openCache } from "@thomasfosterau/effect-web/service-worker"
 *
 * const program = Effect.gen(function* () {
 *   const cache = yield* openCache("v1")
 *   yield* cache.put("https://example.com/a", new Response("a"))
 *   const hit = yield* cache.match("https://example.com/a")
 *   return Option.isSome(hit)
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provideService(Caches, memoryCacheStorage()))) // true
 * ```
 *
 * @since 0.2.0
 * @category cache storage
 */
export const openCache = (name: string): Effect.Effect<CacheHandle, CacheError> =>
  Caches.use((storage) =>
    Effect.map(
      cacheCall("open", name, () => storage.open(name)),
      (cache) => handle(name, cache),
    ),
  );

/**
 * Deletes the cache called `name`; `true` when it existed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, deleteCache, memoryCacheStorage, openCache } from "@thomasfosterau/effect-web/service-worker"
 *
 * const deleted = await Effect.runPromise(
 *   openCache("v1").pipe(
 *     Effect.andThen(deleteCache("v1")),
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *   ),
 * )
 * deleted // true
 * ```
 *
 * @since 0.2.0
 * @category cache storage
 */
export const deleteCache = (name: string): Effect.Effect<boolean, CacheError> =>
  Caches.use((storage) => cacheCall("delete-cache", name, () => storage.delete(name)));

/**
 * The names of every cache in {@link Caches}, in creation order.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, cacheNames, memoryCacheStorage } from "@thomasfosterau/effect-web/service-worker"
 *
 * await Effect.runPromise(cacheNames.pipe(Effect.provideService(Caches, memoryCacheStorage()))) // []
 * ```
 *
 * @since 0.2.0
 * @category cache storage
 */
export const cacheNames: Effect.Effect<
  ReadonlyArray<string>,
  CacheError
> = /*#__PURE__*/ Caches.use((storage) => cacheCall("keys", "", () => storage.keys()));

/**
 * Deletes every cache whose name `keep` rejects, returning the names
 * deleted: the `activate`-time sweep of caches an earlier worker version
 * left behind. `keep` is the list of current names or a predicate (to keep
 * another library's caches, match its prefix).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, deleteCachesExcept, memoryCacheStorage, openCache } from "@thomasfosterau/effect-web/service-worker"
 *
 * const program = Effect.gen(function* () {
 *   yield* openCache("static-v1")
 *   yield* openCache("static-v2")
 *   return yield* deleteCachesExcept(["static-v2"])
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provideService(Caches, memoryCacheStorage()))) // ["static-v1"]
 * ```
 *
 * @since 0.2.0
 * @category cache storage
 */
export const deleteCachesExcept = (
  keep: ReadonlyArray<string> | ((name: string) => boolean),
): Effect.Effect<ReadonlyArray<string>, CacheError> => {
  const kept = Predicate.isFunction(keep) ? keep : (name: string) => keep.includes(name);
  return Effect.flatMap(cacheNames, (names) =>
    Effect.filter(
      names.filter((name) => !kept(name)),
      (name) => deleteCache(name),
    ),
  );
};

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Fetches `request` through `FetchHttpClient.Fetch`, keeping the native
 * `Response` (streaming body, `type`, `redirected`) that `respondWith`
 * needs, which Effect's `HttpClient` does not expose. Interruption aborts
 * the request.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { fetchRequest } from "@thomasfosterau/effect-web/service-worker"
 *
 * const stub: typeof fetch = async () => new Response("hello")
 * const response = await Effect.runPromise(
 *   fetchRequest(new Request("https://example.com/")).pipe(
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * )
 * await response.text() // "hello"
 * ```
 *
 * @since 0.2.0
 * @category network
 */
export const fetchRequest = (request: Request): Effect.Effect<Response, FetchFailed> =>
  FetchHttpClient.Fetch.use((fetchImpl) =>
    Effect.tryPromise({
      try: (signal) => fetchImpl(request, { signal }),
      catch: (cause) => new FetchFailed({ url: request.url, cause }),
    }),
  );

/** `Cache-Control` directive `no-store`, matched as a whole token. */
const NO_STORE = /(?:^|,)\s*no-store\s*(?:[,=]|$)/i;

/**
 * Whether `response` to `request` may be written to a cache: the default
 * `cacheable` of every strategy here.
 *
 * Requires a `GET` (`Cache.put` rejects any other method), status `200`
 * (which excludes an opaque cross-origin response, status `0`, whose
 * failure status cannot be read, and a `206` partial, which `Cache.put`
 * rejects), no `Vary: *` (also rejected by `Cache.put`) and no
 * `Cache-Control: no-store` (the origin asked for the bytes never to be
 * kept; the Cache API itself ignores `Cache-Control`).
 *
 * @example
 * ```ts
 * import { isCacheable } from "@thomasfosterau/effect-web/service-worker"
 *
 * const get = new Request("https://example.com/app.js")
 * isCacheable(get, new Response("ok")) // true
 * isCacheable(get, new Response("", { status: 404 })) // false
 * isCacheable(get, new Response("ok", { headers: { "cache-control": "private, no-store" } })) // false
 * isCacheable(new Request("https://example.com/", { method: "POST" }), new Response("ok")) // false
 * ```
 *
 * @since 0.2.0
 * @category predicates
 */
export const isCacheable = (request: Request, response: Response): boolean =>
  request.method === "GET" &&
  response.status === 200 &&
  response.headers.get("vary")?.trim() !== "*" &&
  !NO_STORE.test(response.headers.get("cache-control") ?? "");

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * A caching strategy: how one request is answered. Every strategy here is a
 * `Strategy`, and so is any `(request) => Effect<Response, E>` a caller
 * writes, so a route can name either.
 *
 * @since 0.2.0
 * @category models
 */
export type Strategy<E = never, R = never> = (request: Request) => Effect.Effect<Response, E, R>;

/**
 * What every caching strategy here takes.
 *
 * @since 0.2.0
 * @category models
 */
export interface StrategyOptions {
  /** The cache read from and written to. */
  readonly cacheName: string;
  /** Which network responses are written back; default {@link isCacheable}. */
  readonly cacheable?: ((request: Request, response: Response) => boolean) | undefined;
  /** Passed to `Cache.match` (`ignoreSearch`, `ignoreVary`, `ignoreMethod`). */
  readonly matchOptions?: CacheQueryOptions | undefined;
}

/** Opens the strategy's cache and looks `request` up in it. */
const lookup = (
  options: Pick<StrategyOptions, "cacheName" | "matchOptions">,
  request: Request,
): Effect.Effect<
  { readonly cache: CacheHandle; readonly hit: Option.Option<Response> },
  CacheError
> =>
  Effect.flatMap(openCache(options.cacheName), (cache) =>
    Effect.map(cache.match(request, options.matchOptions), (hit) => ({ cache, hit })),
  );

/**
 * Fetches, then writes a cacheable response's clone back in the
 * background, so the page gets the response without waiting on the write.
 */
const fetchAndCache = (
  cache: CacheHandle,
  request: Request,
  options: StrategyOptions,
): Effect.Effect<Response, FetchFailed> =>
  Effect.gen(function* () {
    const response = yield* fetchRequest(request);
    if ((options.cacheable ?? isCacheable)(request, response)) {
      // Cloned here, before the caller can consume the original body.
      const copy = response.clone();
      const lifetime = yield* EventLifetime;
      yield* lifetime.extend(cache.put(request, copy));
    }
    return response;
  });

/**
 * Answers from the cache; on a miss, from the network, writing a cacheable
 * response back. For content-hashed assets that never change under one URL.
 * A failure is the cache's ({@link CacheError}) or, on a miss, the
 * network's ({@link FetchFailed}).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, EventLifetime, cacheFirst, memoryCacheStorage } from "@thomasfosterau/effect-web/service-worker"
 *
 * let fetches = 0
 * const stub: typeof fetch = async () => (fetches++, new Response("asset"))
 * const strategy = cacheFirst({ cacheName: "assets" })
 * const request = () => new Request("https://example.com/app.3f2a.js")
 *
 * const program = Effect.gen(function* () {
 *   yield* strategy(request())
 *   const second = yield* strategy(request())
 *   return yield* Effect.promise(() => second.text())
 * })
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *     // Run the background cache write inline, so the next read sees it.
 *     Effect.provideService(EventLifetime, { extend: Effect.ignore }),
 *   ),
 * ) // "asset"
 * fetches // 1
 * ```
 *
 * @since 0.2.0
 * @category strategies
 */
export const cacheFirst =
  (options: StrategyOptions): Strategy<CacheError | FetchFailed> =>
  (request) =>
    Effect.gen(function* () {
      const { cache, hit } = yield* lookup(options, request);
      if (Option.isSome(hit)) return hit.value;
      return yield* fetchAndCache(cache, request, options);
    });

/**
 * Options for {@link networkFirst}.
 *
 * @since 0.2.0
 * @category models
 */
export interface NetworkFirstOptions extends StrategyOptions {
  /**
   * How long the network has before a cached response is served instead.
   * Unset (the default), the cache is consulted only once the network
   * fails. When it elapses and the cache misses, the network keeps its
   * chance; when the cache hits, the network request is aborted, so a
   * timed-out response never refreshes the cache.
   */
  readonly timeout?: Duration.Input | undefined;
}

/**
 * Answers from the network, writing a cacheable response back; when the
 * network fails (or `timeout` elapses with a cached copy to hand), from the
 * cache. For pages and API reads that should be fresh online and still
 * load offline. When the network fails and the cache misses, the failure is
 * the network's {@link FetchFailed}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, EventLifetime, memoryCacheStorage, networkFirst } from "@thomasfosterau/effect-web/service-worker"
 *
 * let online = true
 * const stub: typeof fetch = async () => {
 *   if (!online) throw new TypeError("Failed to fetch")
 *   return new Response("fresh")
 * }
 * const strategy = networkFirst({ cacheName: "pages", timeout: "3 seconds" })
 * const request = () => new Request("https://example.com/")
 *
 * const program = Effect.gen(function* () {
 *   yield* strategy(request())
 *   online = false
 *   const offline = yield* strategy(request())
 *   return yield* Effect.promise(() => offline.text())
 * })
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *     // Run the background cache write inline, so the next read sees it.
 *     Effect.provideService(EventLifetime, { extend: Effect.ignore }),
 *   ),
 * ) // "fresh"
 * ```
 *
 * @since 0.2.0
 * @category strategies
 */
export const networkFirst =
  (options: NetworkFirstOptions): Strategy<CacheError | FetchFailed> =>
  (request) =>
    Effect.gen(function* () {
      const cache = yield* openCache(options.cacheName);
      const cached = cache.match(request, options.matchOptions);
      const network = fetchAndCache(cache, request, options).pipe(
        Effect.catchTag("FetchFailed", (failure) =>
          Effect.flatMap(cached, Option.match({ onNone: () => failure, onSome: Effect.succeed })),
        ),
      );
      if (options.timeout === undefined) return yield* network;
      // The first arm to complete wins. The timer arm only completes on a
      // cache hit, so a miss after the timeout leaves the network to finish
      // (or fail) on its own.
      const timer = Effect.sleep(options.timeout).pipe(
        Effect.andThen(cached),
        Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: Effect.succeed })),
      );
      return yield* Effect.raceFirst(network, timer);
    });

/**
 * Answers from the cache when it can and revalidates in the background
 * (the network response, if cacheable, replaces the cached one for the next
 * request); on a miss, from the network. For content where a slightly stale
 * copy now beats a fresh one later: avatars, fonts, non-critical JSON. A
 * background revalidation failure is logged, never served.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, EventLifetime, memoryCacheStorage, staleWhileRevalidate } from "@thomasfosterau/effect-web/service-worker"
 *
 * let version = 0
 * const stub: typeof fetch = async () => new Response(`v${++version}`)
 * const strategy = staleWhileRevalidate({ cacheName: "avatars" })
 * const read = Effect.fnUntraced(function* () {
 *   const response = yield* strategy(new Request("https://example.com/me.png"))
 *   return yield* Effect.promise(() => response.text())
 * })
 *
 * const program = Effect.all([read(), read(), read()])
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *     // Run the background cache write inline, so the next read sees it.
 *     Effect.provideService(EventLifetime, { extend: Effect.ignore }),
 *   ),
 * ) // ["v1", "v1", "v2"]
 * ```
 *
 * @since 0.2.0
 * @category strategies
 */
export const staleWhileRevalidate =
  (options: StrategyOptions): Strategy<CacheError | FetchFailed> =>
  (request) =>
    Effect.gen(function* () {
      const { cache, hit } = yield* lookup(options, request);
      if (Option.isNone(hit)) return yield* fetchAndCache(cache, request, options);
      const lifetime = yield* EventLifetime;
      // The page may consume the request's body; revalidate with a copy.
      yield* lifetime.extend(fetchAndCache(cache, request.clone(), options));
      return hit.value;
    });

/**
 * Answers from the cache only, failing with {@link CacheMiss} on a miss:
 * for what {@link precache} installed.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, cacheOnly, memoryCacheStorage } from "@thomasfosterau/effect-web/service-worker"
 *
 * const miss = await Effect.runPromise(
 *   Effect.flip(cacheOnly({ cacheName: "shell" })(new Request("https://example.com/"))).pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *   ),
 * )
 * miss._tag // "CacheMiss"
 * ```
 *
 * @since 0.2.0
 * @category strategies
 */
export const cacheOnly =
  (options: Omit<StrategyOptions, "cacheable">): Strategy<CacheError | CacheMiss> =>
  (request) =>
    Effect.gen(function* () {
      const { hit } = yield* lookup(options, request);
      if (Option.isSome(hit)) return hit.value;
      return yield* new CacheMiss({ cacheName: options.cacheName, url: request.url });
    });

/**
 * Answers from the network only, writing nothing: {@link fetchRequest} as a
 * {@link Strategy}, for a route that must never be served stale.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { networkOnly } from "@thomasfosterau/effect-web/service-worker"
 *
 * const stub: typeof fetch = async () => new Response(null, { status: 204 })
 * const response = await Effect.runPromise(
 *   networkOnly(new Request("https://example.com/api/ping")).pipe(
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * )
 * response.status // 204
 * ```
 *
 * @since 0.2.0
 * @category strategies
 */
export const networkOnly: Strategy<FetchFailed> = fetchRequest;

// ---------------------------------------------------------------------------
// Install: precache
// ---------------------------------------------------------------------------

/**
 * Fetches every URL, bypassing the HTTP cache (`cache: "reload"`, so a
 * stale intermediary copy is never installed), and writes them into
 * `cacheName` only once all of them returned `200`: an `install` handler's
 * app-shell step. Any non-`200` fails with {@link PrecacheRejected} and any
 * network failure with {@link FetchFailed}, before anything is written; a
 * failed `install` leaves the previous worker in charge, which is the point.
 *
 * Writes run after every fetch, so a {@link CacheError} mid-write can leave
 * some entries behind; the next `install` overwrites them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import { Caches, memoryCacheStorage, openCache, precache } from "@thomasfosterau/effect-web/service-worker"
 *
 * const stub: typeof fetch = async (input) => new Response(String(input))
 * const program = Effect.gen(function* () {
 *   yield* precache("shell-v1", ["https://example.com/", "https://example.com/app.css"])
 *   const cache = yield* openCache("shell-v1")
 *   return (yield* cache.keys()).length
 * })
 *
 * await Effect.runPromise(
 *   program.pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * ) // 2
 * ```
 *
 * @since 0.2.0
 * @category install
 */
export const precache = (
  cacheName: string,
  urls: Iterable<string | URL>,
): Effect.Effect<void, CacheError | FetchFailed | PrecacheRejected> =>
  Effect.gen(function* () {
    const fetched = yield* Effect.forEach(
      urls,
      (url) =>
        Effect.gen(function* () {
          const request = new Request(url, { cache: "reload" });
          const response = yield* fetchRequest(request);
          if (response.status !== 200) {
            return yield* new PrecacheRejected({ url: request.url, status: response.status });
          }
          return [request, response] as const;
        }),
      { concurrency: "unbounded" },
    );
    const cache = yield* openCache(cacheName);
    yield* Effect.forEach(fetched, ([request, response]) => cache.put(request, response), {
      concurrency: 1,
      discard: true,
    });
  });

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

/**
 * One entry of a {@link fetchListener} route table: a synchronous `match`
 * and the effect that answers a matched request.
 *
 * @since 0.2.0
 * @category models
 */
export interface Route<E = never, R = never> {
  /**
   * Decides, during dispatch, whether this route answers. It must be
   * synchronous: `respondWith` has to be called before the event handler
   * returns, so the choice to answer cannot wait on an effect.
   */
  readonly match: (request: Request) => boolean;
  readonly handle: Strategy<E, R>;
}

/**
 * Builds a {@link Route}.
 *
 * @example
 * ```ts
 * import { cacheFirst, route } from "@thomasfosterau/effect-web/service-worker"
 *
 * const assets = route(
 *   (request) => new URL(request.url).pathname.startsWith("/assets/"),
 *   cacheFirst({ cacheName: "assets" }),
 * )
 * assets.match(new Request("https://example.com/assets/app.js")) // true
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const route = <E, R>(
  match: (request: Request) => boolean,
  handle: Strategy<E, R>,
): Route<E, R> => ({ match, handle });

/**
 * Whether `request` is a top-level navigation (`mode: "navigate"`): the
 * usual `match` of a page route.
 *
 * @example
 * ```ts
 * import { isNavigationRequest } from "@thomasfosterau/effect-web/service-worker"
 *
 * isNavigationRequest(new Request("https://example.com/app.js")) // false
 * ```
 *
 * @since 0.2.0
 * @category predicates
 */
export const isNavigationRequest = (request: Request): boolean => request.mode === "navigate";

/** The services a route table needs, the union across its routes. */
type RoutesServices<Routes extends ReadonlyArray<Route<unknown, unknown>>> =
  Routes[number] extends Route<unknown, infer R> ? R : never;

/**
 * Turns a route table into a `fetch` listener. The first route whose
 * `match` accepts the request answers it through `respondWith`; when none
 * does, the listener returns without calling `respondWith` and the browser
 * fetches the request itself, as if no worker were installed.
 *
 * The listener runs each answer with the services the building effect was
 * given, and with {@link EventLifetime} bound to the event, so a strategy's
 * background writes keep the worker alive. A failed answer rejects the
 * `respondWith` promise, which the page sees as a network error: the same
 * thing it sees when an unhandled fetch fails. Recover first (`Effect.catch`
 * in `handle`) to serve a fallback instead.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as FetchHttpClient from "effect/http/FetchHttpClient"
 * import {
 *   Caches,
 *   cacheFirst,
 *   type FetchEventLike,
 *   fetchListener,
 *   memoryCacheStorage,
 *   networkFirst,
 *   isNavigationRequest,
 *   route,
 * } from "@thomasfosterau/effect-web/service-worker"
 *
 * const stub: typeof fetch = async () => new Response("from the network")
 *
 * // In a worker: `self.addEventListener("fetch", onFetch)`, with the
 * // effect run synchronously while the script evaluates.
 * const onFetch = Effect.runSync(
 *   fetchListener([
 *     route(isNavigationRequest, networkFirst({ cacheName: "pages" })),
 *     route((request) => request.url.endsWith(".js"), cacheFirst({ cacheName: "assets" })),
 *   ]).pipe(
 *     Effect.provideService(Caches, memoryCacheStorage()),
 *     Effect.provideService(FetchHttpClient.Fetch, stub),
 *   ),
 * )
 *
 * let answered: Promise<Response> | undefined
 * const event: FetchEventLike = {
 *   request: new Request("https://example.com/app.js"),
 *   respondWith: (response) => { answered = Promise.resolve(response) },
 *   waitUntil: () => {},
 * }
 * onFetch(event)
 * await answered?.then((response) => response.text()) // "from the network"
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const fetchListener = <const Routes extends ReadonlyArray<Route<unknown, any>>>(
  routes: Routes,
): Effect.Effect<(event: FetchEventLike) => void, never, RoutesServices<Routes>> =>
  Effect.map(Effect.context<RoutesServices<Routes>>(), (context) => {
    const run = Effect.runPromiseWith(context);
    return (event: FetchEventLike) => {
      const matched = routes.find((candidate) => candidate.match(event.request));
      if (matched === undefined) return;
      event.respondWith(
        run(
          matched
            .handle(event.request)
            .pipe(Effect.provideService(EventLifetime, eventLifetime(event))),
        ),
      );
    };
  });

/**
 * Turns `handle` into a listener for an extendable event (`install`,
 * `activate`, or any other whose work belongs in `waitUntil`): the effect's
 * promise goes to `event.waitUntil`, so a failure rejects it. For `install`
 * that fails the installation, leaving the previous worker in charge; for
 * `activate` the browser logs it and activates anyway.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Caches, deleteCachesExcept, extendableListener, memoryCacheStorage, openCache } from "@thomasfosterau/effect-web/service-worker"
 *
 * const storage = memoryCacheStorage()
 * await Effect.runPromise(openCache("static-v1").pipe(Effect.provideService(Caches, storage)))
 *
 * // In a worker: `self.addEventListener("activate", onActivate)`.
 * const onActivate = Effect.runSync(
 *   extendableListener(() => deleteCachesExcept(["static-v2"])).pipe(
 *     Effect.provideService(Caches, storage),
 *   ),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onActivate({ waitUntil: (promise) => { pending.push(promise) } })
 * await Promise.all(pending) // [["static-v1"]]
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const extendableListener = <Event extends ExtendableEventLike, E, R>(
  handle: (event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R> =>
  Effect.map(Effect.context<R>(), (context) => {
    const run = Effect.runPromiseWith(context);
    return (event: Event) =>
      event.waitUntil(
        run(handle(event).pipe(Effect.provideService(EventLifetime, eventLifetime(event)))),
      );
  });

/**
 * Turns `handle` into a `message` listener that decodes `event.data` with
 * `schema` first: a client's `postMessage` arrives as `unknown`, and this
 * is its boundary. A message that fails to decode is logged at `Warning`
 * and dropped (the listener's promise still resolves); a decoded one runs
 * `handle` inside `waitUntil`, as {@link extendableListener} does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { messageListener } from "@thomasfosterau/effect-web/service-worker"
 *
 * const SkipWaiting = Schema.Struct({ type: Schema.Literal("SKIP_WAITING") })
 * const seen: Array<string> = []
 *
 * // In a worker, `handle` would call `self.skipWaiting()`.
 * const onMessage = Effect.runSync(
 *   messageListener(SkipWaiting, (message) => Effect.sync(() => seen.push(message.type))),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * const waitUntil = (promise: Promise<unknown>) => { pending.push(promise) }
 * onMessage({ data: { type: "SKIP_WAITING" }, waitUntil })
 * onMessage({ data: "not a message", waitUntil })
 * await Promise.all(pending)
 * seen // ["SKIP_WAITING"]
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const messageListener = <
  S extends Schema.Constraint,
  Event extends ExtendableMessageEventLike,
  E,
  R,
>(
  schema: S,
  handle: (message: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> =>
  decodedListener(schema, (event: Event) => event.data, "service-worker: message dropped", handle);

/**
 * An {@link extendableListener} that decodes `read(event)` with `schema`
 * first: an undecodable payload is logged at `Warning` as `dropped` and
 * the handler is skipped.
 */
const decodedListener = <S extends Schema.Constraint, Event extends ExtendableEventLike, E, R>(
  schema: S,
  read: (event: Event) => S["Encoded"],
  dropped: string,
  handle: (decoded: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> => {
  const decode = Schema.decodeUnknownEffect(schema);
  return extendableListener((event: Event) =>
    decode(read(event)).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.logWarning(dropped, error),
        onSuccess: (decoded) => handle(decoded, event),
      }),
    ),
  );
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * The part of a persistent `Notification` (one shown through a
 * registration) this entry reads: what it was shown with, and `close`.
 *
 * @since 0.2.0
 * @category models
 */
export interface PersistentNotificationLike {
  readonly title: string;
  readonly tag: string;
  readonly body: string;
  readonly data: unknown;
  close(): void;
}

/**
 * The part of a `ServiceWorkerRegistration` this entry calls. In a worker
 * it is `self.registration`; in a page, `await navigator.serviceWorker.ready`.
 *
 * @since 0.2.0
 * @category models
 */
export interface ServiceWorkerRegistrationLike {
  showNotification(title: string, options?: NotificationOptions): Promise<void>;
  getNotifications(
    filter?: GetNotificationOptions,
  ): Promise<ReadonlyArray<PersistentNotificationLike>>;
}

/**
 * The part of a `NotificationEvent` (`notificationclick`,
 * `notificationclose`) this entry uses: the notification, and which action
 * button was pressed (`""` for the notification itself).
 *
 * @since 0.2.0
 * @category models
 */
export interface NotificationEventLike extends ExtendableEventLike {
  readonly notification: PersistentNotificationLike;
  readonly action?: string | undefined;
}

/**
 * Why a registration notification call failed.
 *
 * - `Unsupported` — no registration to call (not a service worker, and
 *   none provided).
 * - `NotAllowed` — refused with `NotAllowedError` / `SecurityError`.
 * - `InvalidData` — refused with a `TypeError` or `DataCloneError`: invalid
 *   options, or `data` that cannot be structured-cloned. Chromium also
 *   rejects with a `TypeError` when the origin has no notification
 *   permission, which reads as this too; check the permission first.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type ShowNotificationErrorReason = "Unsupported" | "NotAllowed" | "InvalidData" | "Failed";

/**
 * A registration notification call that failed: `operation` names it.
 * Distinct from `./browser`'s `NotificationError` (a page's own
 * notifications), so a `catchTag` for one never swallows the other.
 *
 * @since 0.2.0
 * @category errors
 */
export class ShowNotificationError extends Schema.TaggedError<ShowNotificationError>()(
  "ShowNotificationError",
  {
    operation: Schema.Literals(["show", "get"]),
    reason: Schema.Literals(["Unsupported", "NotAllowed", "InvalidData", "Failed"]),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

const NOTIFICATION_REJECTIONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  TypeError: "InvalidData",
  DataCloneError: "InvalidData",
} satisfies Readonly<Record<string, ShowNotificationErrorReason>>;

const notificationError = (
  operation: "show" | "get",
  reason: ShowNotificationErrorReason,
  cause: unknown,
) =>
  new ShowNotificationError({
    operation,
    reason,
    cause,
    message: `service-worker: ${operation} notification: ${reason}`,
  });

/** The worker's own registration, read structurally: the `dom` lib has no `registration` global. */
const ambientRegistration = (): ServiceWorkerRegistrationLike | undefined => {
  // `caches` only keeps the annotation from reading as a weak type.
  const scope: { readonly registration?: ServiceWorkerRegistrationLike | undefined } & Pick<
    typeof globalThis,
    "caches"
  > = globalThis;
  return scope.registration;
};

/**
 * The `ServiceWorkerRegistration` notifications are shown through. Defaults
 * to the worker's `self.registration`, read on first use, never at import;
 * `undefined` (a page, a test) fails each call `Unsupported`. A page
 * provides `await navigator.serviceWorker.ready`, which is how it shows a
 * notification where the `Notification` constructor is refused (Chrome on
 * Android).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Registration, showNotification } from "@thomasfosterau/effect-web/service-worker"
 *
 * const shown: Array<string> = []
 * const registration = {
 *   showNotification: async (title: string) => { shown.push(title) },
 *   getNotifications: async () => [],
 * }
 * await Effect.runPromise(
 *   showNotification("Back online").pipe(Effect.provideService(Registration, registration)),
 * )
 * shown // ["Back online"]
 * ```
 *
 * @since 0.2.0
 * @category context
 */
export const Registration: Context.Reference<ServiceWorkerRegistrationLike | undefined> =
  /*#__PURE__*/ Context.Reference("@thomasfosterau/effect-web/service-worker/Registration", {
    defaultValue: ambientRegistration,
  });

const withRegistration = <A>(
  operation: "show" | "get",
  call: (registration: ServiceWorkerRegistrationLike) => Promise<A>,
): Effect.Effect<A, ShowNotificationError> =>
  Registration.use((registration) =>
    registration === undefined
      ? Effect.fail(notificationError(operation, "Unsupported", undefined))
      : Effect.tryPromise({
          try: () => call(registration),
          catch: (cause) =>
            notificationError(operation, reasonOf(cause, NOTIFICATION_REJECTIONS, "Failed"), cause),
        }),
  );

/**
 * Shows a persistent notification through the {@link Registration}. It
 * outlives the page and the worker's current event; its clicks and closes
 * arrive as `notificationclick` / `notificationclose` events in the worker
 * (see {@link notificationClickListener}). Inside a listener built here,
 * keep the worker alive until it is shown by yielding it from the handler.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Registration, showNotification } from "@thomasfosterau/effect-web/service-worker"
 *
 * const program = Effect.flip(showNotification("x").pipe(Effect.provideService(Registration, undefined)))
 * Effect.runPromise(program).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.2.0
 * @category notifications
 */
export const showNotification = (
  title: string,
  options?: NotificationOptions,
): Effect.Effect<void, ShowNotificationError> =>
  withRegistration("show", (registration) => registration.showNotification(title, options));

/**
 * The registration's notifications still showing, optionally only those
 * with `tag` — to close them, or to fold a new message into one already
 * on screen.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { getNotifications, Registration } from "@thomasfosterau/effect-web/service-worker"
 *
 * const registration = {
 *   showNotification: async () => {},
 *   getNotifications: async () => [{ title: "Hi", tag: "chat", body: "", data: null, close: () => {} }],
 * }
 * const titles = await Effect.runPromise(
 *   getNotifications({ tag: "chat" }).pipe(
 *     Effect.map((shown) => shown.map((notification) => notification.title)),
 *     Effect.provideService(Registration, registration),
 *   ),
 * )
 * titles // ["Hi"]
 * ```
 *
 * @since 0.2.0
 * @category notifications
 */
export const getNotifications = (filter?: {
  readonly tag?: string | undefined;
}): Effect.Effect<ReadonlyArray<PersistentNotificationLike>, ShowNotificationError> =>
  withRegistration("get", (registration) =>
    registration.getNotifications(filter?.tag === undefined ? undefined : { tag: filter.tag }),
  );

const notificationListener =
  (kind: string) =>
  <S extends Schema.Constraint, Event extends NotificationEventLike, E, R>(
    schema: S,
    handle: (data: S["Type"], event: Event) => Effect.Effect<unknown, E, R>,
  ): Effect.Effect<(event: Event) => void, never, R | S["DecodingServices"]> =>
    decodedListener(
      schema,
      (event: Event) => event.notification.data,
      `service-worker: ${kind} dropped`,
      handle,
    );

/**
 * Turns `handle` into a `notificationclick` listener that decodes the
 * notification's `data` with `schema` first (it is whatever was passed to
 * {@link showNotification}, structured-cloned). A notification whose data
 * fails to decode is logged at `Warning` and dropped; a decoded one runs
 * `handle` inside `waitUntil`, as {@link extendableListener} does — the
 * place to focus or open a window. Pass `Schema.Unknown` to skip decoding.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { notificationClickListener } from "@thomasfosterau/effect-web/service-worker"
 *
 * const Chat = Schema.Struct({ room: Schema.String })
 * const opened: Array<string> = []
 *
 * // In a worker: `self.addEventListener("notificationclick", onClick)`, and
 * // `handle` would call `clients.openWindow`.
 * const onClick = Effect.runSync(
 *   notificationClickListener(Chat, (data, event) =>
 *     Effect.sync(() => {
 *       event.notification.close()
 *       opened.push(data.room)
 *     }),
 *   ),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onClick({
 *   notification: { title: "New message", tag: "", body: "", data: { room: "general" }, close: () => {} },
 *   action: "",
 *   waitUntil: (promise) => { pending.push(promise) },
 * })
 * await Promise.all(pending)
 * opened // ["general"]
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const notificationClickListener = notificationListener("notificationclick");

/**
 * Turns `handle` into a `notificationclose` listener (the user dismissed a
 * notification), decoding its `data` with `schema` as
 * {@link notificationClickListener} does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { notificationCloseListener } from "@thomasfosterau/effect-web/service-worker"
 *
 * const dismissed: Array<unknown> = []
 * const onClose = Effect.runSync(
 *   notificationCloseListener(Schema.Unknown, (data) => Effect.sync(() => dismissed.push(data))),
 * )
 *
 * const pending: Array<Promise<unknown>> = []
 * onClose({
 *   notification: { title: "Reminder", tag: "", body: "", data: 7, close: () => {} },
 *   waitUntil: (promise) => { pending.push(promise) },
 * })
 * await Promise.all(pending)
 * dismissed // [7]
 * ```
 *
 * @since 0.2.0
 * @category listeners
 */
export const notificationCloseListener = notificationListener("notificationclose");

// ---------------------------------------------------------------------------
// In-memory CacheStorage
// ---------------------------------------------------------------------------

/** The cache key of a request: its URL, with or without the query. */
const cacheKey = (request: Request, options: CacheQueryOptions | undefined): string => {
  if (options?.ignoreSearch !== true) return request.url;
  const url = new URL(request.url);
  url.search = "";
  return url.href;
};

const toRequest = (request: RequestInfo | URL): Request =>
  request instanceof Request ? request : new Request(request);

/** Whether `request` can be matched at all: a `GET` / `HEAD`, or any method under `ignoreMethod`. */
const matchable = (request: Request, options: CacheQueryOptions | undefined): boolean =>
  options?.ignoreMethod === true || request.method === "GET" || request.method === "HEAD";

/**
 * Replaces the entry `name` names in place, or appends one: the insertion
 * order a `Map` keeps, which `match` (first hit) and `keys` expose.
 */
const upsert = <A>(
  entries: ReadonlyArray<readonly [string, A]>,
  name: string,
  value: A,
): ReadonlyArray<readonly [string, A]> =>
  Arr.some(entries, ([key]) => key === name)
    ? Arr.map(entries, (entry) => (entry[0] === name ? ([name, value] as const) : entry))
    : Arr.append(entries, [name, value] as const);

/** Runs `f` over `items` one after another, as an awaited `for … of` would. */
const sequentially = <A>(items: ReadonlyArray<A>, f: (item: A) => Promise<void>): Promise<void> =>
  Arr.reduce(items, Promise.resolve(), (previous, item) => previous.then(() => f(item)));

const memoryCache = (fetchImpl: typeof globalThis.fetch): Cache => {
  // Keyed by request URL, in insertion order.
  let entries: ReadonlyArray<readonly [string, readonly [Request, Response]]> = [];
  const find = (request: RequestInfo | URL, options: CacheQueryOptions | undefined) => {
    const wanted = toRequest(request);
    if (!matchable(wanted, options)) return [];
    const key = cacheKey(wanted, options);
    return entries.filter(([, [stored]]) => cacheKey(stored, options) === key);
  };
  const put = async (request: RequestInfo | URL, response: Response): Promise<void> => {
    const stored = toRequest(request);
    if (stored.method !== "GET") throw new TypeError(`Cache.put: method ${stored.method}`);
    if (response.status === 206) throw new TypeError("Cache.put: partial response");
    if (response.headers.get("vary")?.trim() === "*") throw new TypeError("Cache.put: Vary: *");
    if (response.bodyUsed) throw new TypeError("Cache.put: body already used");
    // Buffer the body so every match can hand out an unread clone.
    const body = await response.arrayBuffer();
    entries = upsert(entries, stored.url, [
      stored,
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    ] as const);
  };
  const addAll = async (requests: Iterable<RequestInfo | URL>): Promise<void> => {
    const fetched = await Promise.all(
      Arr.map(Arr.fromIterable(requests), async (request) => {
        const response = await fetchImpl(request);
        if (!response.ok) throw new TypeError(`Cache.addAll: status ${response.status}`);
        return [request, response] as const;
      }),
    );
    await sequentially(fetched, ([request, response]) => put(request, response));
  };
  return {
    match: async (request, options) => find(request, options)[0]?.[1][1].clone(),
    matchAll: async (request, options) =>
      request === undefined
        ? entries.map(([, [, response]]) => response.clone())
        : find(request, options).map(([, [, response]]) => response.clone()),
    put,
    add: (request) => addAll([request]),
    addAll,
    delete: async (request, options) => {
      const found = find(request, options);
      entries = entries.filter((entry) => !Arr.contains(found, entry));
      return Arr.isReadonlyArrayNonEmpty(found);
    },
    keys: async (request, options) =>
      request === undefined
        ? entries.map(([, [stored]]) => stored)
        : find(request, options).map(([, [stored]]) => stored),
  };
};

/**
 * Options for {@link memoryCacheStorage}.
 *
 * @since 0.2.0
 * @category testing
 */
export interface MemoryCacheStorageOptions {
  /** The `fetch` that `Cache.add` / `Cache.addAll` call; defaults to the global. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * An in-memory `CacheStorage` for tests (and for running the strategies
 * outside a worker): provide it as {@link Caches}. Entries are keyed by URL
 * (`ignoreSearch` and `ignoreMethod` are honoured; `Vary` is not, as if
 * `ignoreVary` were always set), and `put` rejects what the browser's does
 * (a non-`GET`, a `206`, `Vary: *`, a used body) with a `TypeError`.
 * `add` / `addAll` fetch through `options.fetch` (default the global).
 *
 * @example
 * ```ts
 * import { memoryCacheStorage } from "@thomasfosterau/effect-web/service-worker"
 *
 * const storage = memoryCacheStorage()
 * const cache = await storage.open("v1")
 * await cache.put("https://example.com/", new Response("hi"))
 * await (await storage.match("https://example.com/"))?.text() // "hi"
 * ```
 *
 * @since 0.2.0
 * @category testing
 */
export const memoryCacheStorage = (options: MemoryCacheStorageOptions = {}): CacheStorage => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  // Keyed by cache name, in creation order (the order `keys` reports).
  let caches: ReadonlyArray<readonly [string, Cache]> = [];
  const lookup = (name: string): Option.Option<Cache> =>
    Option.map(
      Arr.findFirst(caches, ([key]) => key === name),
      ([, cache]) => cache,
    );
  const open = async (name: string): Promise<Cache> =>
    Option.getOrElse(lookup(name), () => {
      const created = memoryCache(fetchImpl);
      caches = upsert(caches, name, created);
      return created;
    });
  const miss: ReturnType<CacheStorage["match"]> = Promise.resolve(undefined);
  return {
    open,
    has: async (name) => Option.isSome(lookup(name)),
    delete: async (name) => {
      const present = Option.isSome(lookup(name));
      caches = caches.filter(([key]) => key !== name);
      return present;
    },
    keys: async () => caches.map(([name]) => name),
    // The first cache (in creation order) holding a match wins; later caches
    // are not consulted once one answers.
    match: (request, options) =>
      Arr.reduce(
        options?.cacheName === undefined ? caches.map(([name]) => name) : [options.cacheName],
        miss,
        (previous, name) =>
          previous.then((hit) =>
            hit !== undefined
              ? hit
              : Option.match(lookup(name), {
                  onNone: () => miss,
                  onSome: (cache) => cache.match(request, options),
                }),
          ),
      ),
  };
};
