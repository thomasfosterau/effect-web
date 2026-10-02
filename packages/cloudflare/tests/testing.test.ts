/**
 * Unit tests for the in-memory Cloudflare binding stubs — preferenceflow's
 * `packages/integration-harness/tests/stub-bindings.test.ts` over the
 * factories, plus gardeneria's per-binding queue peek, the env builder, the
 * resource-id helper and the retry-visibility reporter
 * (`tests/retry-reporter.test.ts`).
 */

/* oxlint-disable effect/effect-run-in-body */

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { makeWorkerRuntime } from "@thomasfosterau/effect-web-cloudflare";
import {
  logicalIdOf,
  makeStubBindings,
  makeStubEnv,
  makeStubKv,
  makeStubQueue,
  makeStubR2,
  type ReportedTestCase,
  RetryVisibilityReporter,
  STUB_ALCHEMY_ENV,
  stubBindingsLayer,
  throwingBinding,
} from "@thomasfosterau/effect-web-cloudflare/testing";

describe("makeStubKv", () => {
  const kv = makeStubKv();
  const stubKv = kv.namespace;
  beforeEach(() => kv.reset());

  it("round-trips a put through get in every read type, and misses resolve null", async () => {
    await stubKv.put("doc", JSON.stringify({ n: 1 }));
    await expect(stubKv.get("doc")).resolves.toBe('{"n":1}');
    await expect(stubKv.get("doc", "text")).resolves.toBe('{"n":1}');
    await expect(stubKv.get("doc", { type: "json" })).resolves.toEqual({ n: 1 });
    await expect(stubKv.get("doc", "json")).resolves.toEqual({ n: 1 });
    const buffer = (await stubKv.get("doc", "arrayBuffer")) as ArrayBuffer;
    expect(new TextDecoder().decode(buffer)).toBe('{"n":1}');
    const stream = (await stubKv.get("doc", "stream")) as ReadableStream;
    await expect(new Response(stream).text()).resolves.toBe('{"n":1}');
    await expect(stubKv.get("absent")).resolves.toBeNull();
    await expect(stubKv.get("absent", "json")).resolves.toBeNull();
  });

  it("reads several keys at once as a Map, null for the missing ones", async () => {
    await stubKv.put("a", "1");
    await stubKv.put("b", "2");
    const got = (await stubKv.get(["a", "b", "c"], "text")) as Map<string, unknown>;
    expect([...got.entries()]).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", null],
    ]);
  });

  it("stores bytes as written and hands them back decoded or raw", async () => {
    await stubKv.put("bytes", new TextEncoder().encode("héllo"));
    await expect(stubKv.get("bytes")).resolves.toBe("héllo");
    const raw = (await stubKv.get("bytes", "arrayBuffer")) as ArrayBuffer;
    expect(new Uint8Array(raw)).toEqual(new TextEncoder().encode("héllo"));
  });

  it("records the expirationTtl and metadata each put carried", async () => {
    await stubKv.put("robots:example", "User-agent: *", {
      expirationTtl: 86_400,
      metadata: { fetchedAt: 1 },
    });
    expect(kv.peekTtl("robots:example")).toEqual(Option.some(86_400));
    await expect(stubKv.getWithMetadata("robots:example")).resolves.toEqual({
      value: "User-agent: *",
      metadata: { fetchedAt: 1 },
    });
    await stubKv.put("robots:example", "Disallow: /");
    expect(kv.peekTtl("robots:example")).toEqual(Option.none());
    await expect(stubKv.getWithMetadata("absent")).resolves.toEqual({
      value: null,
      metadata: null,
    });
  });

  it("deletes, and a deleted key reads as a miss", async () => {
    await stubKv.put("gone", "x");
    await stubKv.delete("gone");
    await expect(stubKv.get("gone")).resolves.toBeNull();
    expect(kv.peek("gone")).toEqual(Option.none());
  });

  it("lists keys in order, honouring prefix, limit and the cursor", async () => {
    for (const key of ["p:3", "p:1", "q:1", "p:2"]) await stubKv.put(key, key);
    await expect(stubKv.list({ prefix: "p:" })).resolves.toEqual({
      keys: [{ name: "p:1" }, { name: "p:2" }, { name: "p:3" }],
      list_complete: true,
      cacheStatus: null,
    });
    const first = await stubKv.list({ prefix: "p:", limit: 2 });
    expect(first.keys.map((key) => key.name)).toEqual(["p:1", "p:2"]);
    expect(first.list_complete).toBe(false);
    if (first.list_complete) throw new Error("expected a cursor");
    const rest = await stubKv.list({ prefix: "p:", limit: 2, cursor: first.cursor });
    expect(rest).toEqual({ keys: [{ name: "p:3" }], list_complete: true, cacheStatus: null });
    // An unknown cursor starts from the top rather than failing.
    const fromTop = await stubKv.list({ prefix: "p:", limit: 1, cursor: "zzz" });
    expect(fromTop.keys.map((key) => key.name)).toEqual(["p:1"]);
  });

  it("seeds bypass every write gate and peek reads the stored JSON back", async () => {
    kv.seed("stale", { fromKv: true });
    expect(kv.peek("stale")).toEqual(Option.some({ fromKv: true }));
    await expect(stubKv.get("stale", "json")).resolves.toEqual({ fromKv: true });
    expect(kv.peekTtl("stale")).toEqual(Option.none());
    kv.seed("text", "raw");
    await expect(stubKv.get("text")).resolves.toBe("raw");
  });

  it("rejects every get while the fault flag is set, and reset clears it", async () => {
    await stubKv.put("k", "v");
    kv.setGetFault(true);
    await expect(stubKv.get("k")).rejects.toThrow(/stub KV get fault/);
    await expect(stubKv.getWithMetadata("k")).rejects.toThrow(/stub KV get fault/);
    kv.reset();
    await expect(stubKv.get("k")).resolves.toBeNull();
  });

  it("stores one namespace per factory call", async () => {
    const other = makeStubKv();
    await stubKv.put("only-here", "1");
    await expect(other.namespace.get("only-here")).resolves.toBeNull();
  });
});

describe("makeStubR2", () => {
  const r2 = makeStubR2();
  const stubR2 = r2.bucket;
  beforeEach(() => r2.reset());

  it("puts every body shape and reads the same bytes back through get / head", async () => {
    await stubR2.put("s", "text body", { httpMetadata: { "content-type": "text/plain" } });
    await stubR2.put("u", new TextEncoder().encode("bytes body"));
    await stubR2.put("a", new TextEncoder().encode("buffer body").buffer as ArrayBuffer);
    await stubR2.put("b", new Blob(["blob body"]));
    await stubR2.put("r", new Blob(["stream body"]).stream());
    await stubR2.put("n", null);
    await stubR2.put("h", "headers", { httpMetadata: new Headers({ "content-type": "text/x" }) });

    const s = await stubR2.get("s");
    if (s === null) throw new Error("expected an object");
    await expect(s.text()).resolves.toBe("text body");
    expect(s.size).toBe("text body".length);
    expect(s.httpMetadata).toEqual({ "content-type": "text/plain" });
    await expect(new Response(s.body).text()).resolves.toBe("text body");
    const headers = new Headers();
    s.writeHttpMetadata(headers);
    expect(headers.get("content-type")).toBe("text/plain");

    const texts = await Promise.all(
      ["u", "a", "b", "r", "n"].map(async (key) => {
        const object = await stubR2.get(key);
        return object === null ? null : object.text();
      }),
    );
    expect(texts).toEqual(["bytes body", "buffer body", "blob body", "stream body", ""]);

    const head = await stubR2.head("s");
    expect(head?.key).toBe("s");
    expect(head?.etag).toBe(s.etag);
    expect((await stubR2.head("h"))?.httpMetadata).toEqual({ "content-type": "text/x" });
    expect(r2.peek("u")).toEqual(Option.some(new TextEncoder().encode("bytes body")));
  });

  it("decodes JSON bodies and copies bytes out so a caller cannot mutate the store", async () => {
    await stubR2.put("feed/1/message.json", JSON.stringify({ cycle: 1 }), {
      customMetadata: { cycle: "1" },
    });
    const object = await stubR2.get("feed/1/message.json");
    if (object === null) throw new Error("expected an object");
    await expect(object.json()).resolves.toEqual({ cycle: 1 });
    await expect(object.blob().then((blob) => blob.text())).resolves.toBe('{"cycle":1}');
    await expect(object.arrayBuffer().then((b) => new TextDecoder().decode(b))).resolves.toBe(
      '{"cycle":1}',
    );
    expect(object.customMetadata).toEqual({ cycle: "1" });
    const bytes = await object.bytes();
    bytes.fill(0);
    await expect(stubR2.get("feed/1/message.json").then((o) => o?.text())).resolves.toBe(
      '{"cycle":1}',
    );
  });

  it("gives equal bodies equal etags and different bodies different ones", async () => {
    const one = await stubR2.put("one", "same");
    const two = await stubR2.put("two", "same");
    const other = await stubR2.put("other", "different");
    expect(one.etag).toBe(two.etag);
    expect(other.etag).not.toBe(one.etag);
    expect(one.httpEtag).toBe(`"${one.etag}"`);
  });

  it("misses resolve null, and delete accepts one key or many", async () => {
    await expect(stubR2.get("absent")).resolves.toBeNull();
    await expect(stubR2.head("absent")).resolves.toBeNull();
    await stubR2.put("x", "1");
    await stubR2.put("y", "2");
    await stubR2.put("z", "3");
    await stubR2.delete("x");
    await stubR2.delete(["y", "z"]);
    expect(r2.keys()).toEqual([]);
    expect(r2.peek("x")).toEqual(Option.none());
  });

  it("lists objects in key order, honouring prefix, limit and the cursor", async () => {
    for (const key of ["feed/2/b", "feed/1/a", "other", "feed/1/b"]) await stubR2.put(key, key);
    expect(r2.keys()).toEqual(["feed/1/a", "feed/1/b", "feed/2/b", "other"]);
    const page = await stubR2.list({ prefix: "feed/", limit: 2 });
    expect(page.objects.map((object) => object.key)).toEqual(["feed/1/a", "feed/1/b"]);
    expect(page.truncated).toBe(true);
    if (!page.truncated) throw new Error("expected a cursor");
    const rest = await stubR2.list({ prefix: "feed/", limit: 2, cursor: page.cursor });
    expect(rest.objects.map((object) => object.key)).toEqual(["feed/2/b"]);
    expect(rest.truncated).toBe(false);
    const all = await stubR2.list();
    expect(all.objects).toHaveLength(4);
  });

  it("refuses multipart uploads loudly rather than passing against a fake", async () => {
    await expect(stubR2.createMultipartUpload()).rejects.toThrow(/multipart/);
    expect(() => stubR2.resumeMultipartUpload()).toThrow(/multipart/);
  });
});

describe("makeStubQueue", () => {
  it("records every send and every batched message in order, with their options", async () => {
    const queue = makeStubQueue();
    await queue.queue.send({ id: 1 });
    await queue.queue.send("raw", { contentType: "text", delaySeconds: 30 });
    await queue.queue.sendBatch([{ body: { id: 2 } }, { body: { id: 3 }, contentType: "json" }], {
      delaySeconds: 5,
    });
    expect(queue.sent()).toEqual([
      { body: { id: 1 }, contentType: Option.none(), delaySeconds: Option.none() },
      { body: "raw", contentType: Option.some("text"), delaySeconds: Option.some(30) },
      { body: { id: 2 }, contentType: Option.none(), delaySeconds: Option.some(5) },
      { body: { id: 3 }, contentType: Option.some("json"), delaySeconds: Option.some(5) },
    ]);
    expect(queue.bodies()).toEqual([{ id: 1 }, "raw", { id: 2 }, { id: 3 }]);
  });

  it("hands out a copy, and reset empties the log", async () => {
    const queue = makeStubQueue();
    await queue.queue.send("a");
    const snapshot = queue.sent();
    await queue.queue.send("b");
    expect(snapshot).toHaveLength(1);
    expect(queue.sent()).toHaveLength(2);
    queue.reset();
    expect(queue.sent()).toEqual([]);
  });
});

describe("makeStubBindings", () => {
  it("memoises one recording queue per binding name and peeks its bodies (gardeneria's peekStubQueue)", async () => {
    const stubs = makeStubBindings();
    await stubs.queue("EMBED_QUEUE").queue.send({ id: "n1" });
    await stubs.queue("EMBED_QUEUE").queue.sendBatch([{ body: { id: "n2" } }]);
    await stubs.queue("NOTIFICATION_QUEUE").queue.send("hello");
    expect(stubs.peekStubQueue("EMBED_QUEUE")).toEqual([{ id: "n1" }, { id: "n2" }]);
    expect(stubs.peekStubQueue("NOTIFICATION_QUEUE")).toEqual(["hello"]);
    expect(stubs.peekStubQueue("NEVER_USED")).toEqual([]);
  });

  it("reset clears the KV store, the R2 map and every queue", async () => {
    const stubs = makeStubBindings();
    await stubs.kv.namespace.put("k", "v");
    await stubs.r2.bucket.put("o", "b");
    await stubs.queue("Q").queue.send(1);
    stubs.reset();
    expect(stubs.kv.peek("k")).toEqual(Option.none());
    expect(stubs.r2.keys()).toEqual([]);
    expect(stubs.peekStubQueue("Q")).toEqual([]);
  });
});

describe("makeStubEnv / throwingBinding", () => {
  it("keys the bindings by name and adds the provider-emitted values", () => {
    interface Env {
      readonly Cache: unknown;
      readonly ALCHEMY_STAGE: string;
      readonly ALCHEMY_PHASE: string;
      readonly ALCHEMY_STACK_NAME: string;
    }
    const cache = makeStubKv().namespace;
    const env = makeStubEnv<Env>({ Cache: cache }, "app");
    expect(env.Cache).toBe(cache);
    expect(env.ALCHEMY_STACK_NAME).toBe("app");
    expect(env.ALCHEMY_STAGE).toBe(STUB_ALCHEMY_ENV.ALCHEMY_STAGE);
    expect(env.ALCHEMY_PHASE).toBe("runtime");
  });

  it("throwingBinding throws on any use, naming the binding", () => {
    const crawler = throwingBinding("ORIGIN_CRAWLER") as { idFromName: (name: string) => unknown };
    expect(() => crawler.idFromName("x")).toThrow(/ORIGIN_CRAWLER not available/);
  });
});

describe("logicalIdOf", () => {
  it("resolves a declared resource's LogicalId under the stub Stack", async () => {
    const ids = await Effect.runPromise(
      Effect.all(
        [
          logicalIdOf(Cloudflare.KV.Namespace("Cache")),
          logicalIdOf(Cloudflare.R2.Bucket("FeedArchive")),
          logicalIdOf(Cloudflare.Queues.Queue("FEED_QUEUE")),
        ],
        { concurrency: 1 },
      ),
    );
    expect(ids).toEqual(["Cache", "FeedArchive", "FEED_QUEUE"]);
  });
});

describe("stubBindingsLayer — the real binding clients over a stub env", () => {
  const Cache = Cloudflare.KV.Namespace("Cache");
  const Robots = Cloudflare.KV.Namespace("Robots");
  const FeedArchive = Cloudflare.R2.Bucket("FeedArchive");
  const FeedQueue = Cloudflare.Queues.Queue("FEED_QUEUE");

  const stubs = makeStubBindings();
  const env = makeStubEnv(
    {
      Cache: stubs.kv.namespace,
      Robots: stubs.kv.namespace,
      FeedArchive: stubs.r2.bucket,
      FEED_QUEUE: stubs.queue("FEED_QUEUE").queue,
      ORIGIN_CRAWLER: throwingBinding("ORIGIN_CRAWLER"),
    },
    "app",
  );
  const layer = stubBindingsLayer(makeWorkerRuntime({ logicalId: "Pipeline" }), env);
  beforeEach(() => stubs.reset());

  const runWithStubs = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);

  it("resolves the Cache and Robots KV clients against the stub namespace", async () => {
    const got = await runWithStubs(
      Effect.gen(function* () {
        const cache = yield* Cloudflare.KV.ReadWriteNamespace(Cache);
        const robots = yield* Cloudflare.KV.ReadWriteNamespace(Robots);
        yield* cache.put("doc:1", JSON.stringify({ id: 1 }), { expirationTtl: 60 });
        yield* robots.put("https://example.test", "User-agent: *");
        const doc = yield* cache.get("doc:1", "json");
        const miss = yield* cache.get("doc:2", "json");
        const directive = yield* robots.get("https://example.test");
        yield* cache.delete("doc:1");
        const afterDelete = yield* cache.get("doc:1");
        return { doc, miss, directive, afterDelete };
      }),
    );
    expect(got).toEqual({
      doc: { id: 1 },
      miss: null,
      directive: "User-agent: *",
      afterDelete: null,
    });
    expect(stubs.kv.peekTtl("doc:1")).toEqual(Option.none());
  });

  it("archives and reads back a feed message through the FeedArchive R2 client", async () => {
    const got = await runWithStubs(
      Effect.gen(function* () {
        const archive = yield* Cloudflare.R2.ReadWriteBucket(FeedArchive);
        const written = yield* archive.put("feed/1/message.xml", "<MediaFeed/>", {
          httpMetadata: { contentType: "application/xml" },
        });
        const object = yield* archive.get("feed/1/message.xml");
        const text = object === null ? null : yield* object.text();
        const head = yield* archive.head("feed/1/message.xml");
        const listed = yield* archive.list({ prefix: "feed/1/" });
        yield* archive.delete("feed/1/message.xml");
        const gone = yield* archive.head("feed/1/message.xml");
        return {
          size: written.size,
          text,
          headKey: head?.key,
          listed: listed.objects.length,
          gone,
        };
      }),
    );
    expect(got).toEqual({
      size: "<MediaFeed/>".length,
      text: "<MediaFeed/>",
      headKey: "feed/1/message.xml",
      listed: 1,
      gone: null,
    });
    expect(stubs.r2.keys()).toEqual([]);
  });

  it("records what the FEED_QUEUE producer client sends", async () => {
    await runWithStubs(
      Effect.gen(function* () {
        const queue = yield* Cloudflare.Queues.WriteQueue(FeedQueue);
        yield* queue.send({ key: "feed/1/message.xml" });
        yield* queue.sendBatch([
          { body: { key: "feed/1/a.xml" } },
          { body: "raw", contentType: "text" },
        ]);
      }),
    );
    expect(stubs.peekStubQueue("FEED_QUEUE")).toEqual([
      { key: "feed/1/message.xml" },
      { key: "feed/1/a.xml" },
      "raw",
    ]);
    expect(stubs.queue("FEED_QUEUE").sent()[2]?.contentType).toEqual(Option.some("text"));
  });

  it("panics on Hyperdrive Connect — the harness's Database is not Hyperdrive-backed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const connect = yield* Cloudflare.Hyperdrive.Connect;
        return yield* connect(undefined as never);
      }).pipe(Effect.provide(layer)) as Effect.Effect<unknown, unknown, never>,
    );
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toMatch(/Cloudflare\.Hyperdrive\.Connect used in the test harness/);
  });
});

describe("RetryVisibilityReporter", () => {
  const testCase = (
    name: string,
    state: "passed" | "failed",
    retryCount: Option.Option<number>,
  ): ReportedTestCase => ({
    fullName: name,
    module: { relativeModuleId: "packages/jobs/tests/integration/feed.test.ts" },
    result: () => ({ state }),
    diagnostic: () =>
      Option.getOrUndefined(Option.map(retryCount, (count) => ({ retryCount: count }))),
  });

  const runReporter = (cases: ReadonlyArray<ReportedTestCase>, ci: boolean): Array<string> => {
    const lines: Array<string> = [];
    const reporter = new RetryVisibilityReporter({
      warn: (line) => lines.push(line),
      isCI: () => ci,
    });
    for (const one of cases) reporter.onTestCaseResult(one);
    reporter.onTestRunEnd();
    return lines;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names every test that passed only after a retry, with its retry count", () => {
    const lines = runReporter(
      [
        testCase("suite > flaky", "passed", Option.some(1)),
        testCase("suite > flakier", "passed", Option.some(2)),
        testCase("suite > steady", "passed", Option.some(0)),
      ],
      false,
    );
    expect(lines[0]).toMatch(/2 test\(s\) passed only after a retry/);
    expect(lines.slice(1)).toEqual([
      "  retried-then-passed: packages/jobs/tests/integration/feed.test.ts > suite > flaky (retried 1x)",
      "  retried-then-passed: packages/jobs/tests/integration/feed.test.ts > suite > flakier (retried 2x)",
    ]);
  });

  it("stays silent when nothing was retried, and ignores failures and missing diagnostics", () => {
    expect(
      runReporter(
        [
          testCase("suite > clean", "passed", Option.some(0)),
          testCase("suite > no-diagnostic", "passed", Option.none()),
          testCase("suite > failed-after-retry", "failed", Option.some(1)),
        ],
        false,
      ),
    ).toEqual([]);
    expect(runReporter([], true)).toEqual([]);
  });

  it("emits GitHub Actions warning annotations in CI", () => {
    const lines = runReporter([testCase("suite > flaky", "passed", Option.some(1))], true);
    expect(lines[1]).toBe(
      "::warning::retried-then-passed: packages/jobs/tests/integration/feed.test.ts > suite > flaky (retried 1x)",
    );
  });

  it("defaults to console.warn and the CI environment variable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.CI;
    process.env.CI = "true";
    const reporter = new RetryVisibilityReporter();
    reporter.onTestCaseResult(testCase("suite > flaky", "passed", Option.some(1)));
    expect(reporter.retriedThenPassed()).toHaveLength(1);
    reporter.onTestRunEnd();
    expect(warn.mock.calls.map((call) => String(call[0]))[1]).toMatch(/^::warning::/);
    if (previous === undefined) Reflect.deleteProperty(process.env, "CI");
    else process.env.CI = previous;
  });
});
