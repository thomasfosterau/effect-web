# @thomasfosterau/effect-web-cloudflare

The Cloudflare Workers / Alchemy runtime scaffold the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications share, extracted with the per-application parts injected: the Worker's `LogicalId`, the binding-client catalogue and the `Database` layer. Plus the queue glue, the KV read-through resource cache and the in-memory binding stubs their integration harnesses run on.

Every export's doc comment names the application behaviour it carries and the invariant id it honours (`PERF-CACHE-004`, `CACHE-AUTH-005`, `PERF-PIPE-001`, `#455`, `#1978`, `#1096`); those ids and the `#NNN` issue citations point at the applications' specs.

## Install

```sh
pnpm add @thomasfosterau/effect-web-cloudflare @thomasfosterau/effect-web @thomasfosterau/effect-web-robots effect alchemy@2.0.0-beta.79
```

Peers: `effect` (>= 4.0.0-rc.118), `alchemy` (**exactly** `2.0.0-beta.79` — the runtime scaffold mirrors that beta's `WorkerBridge` internals; note that `2.0.0-beta.72` cannot be imported under effect rc.115 at all, since rc.115 renamed `Config.string` to `Config.String` and beta.72 still calls the old name at module load), and `@cloudflare/workers-types` (optional, types only). `@thomasfosterau/effect-web` and `@thomasfosterau/effect-web-robots` are dependencies.

| Entry | What it is |
| --- | --- |
| `.` | `makeWorkerRuntime` (the scaffold: `requestLayer`, `workerLayer`, `handlerLayer`, `bind` / `bindAll`), the `AlchemyExecutionContext` lifecycle, `buildRequestService`, the `Scheduler` bridge, the read-path query counter (`withRequestMetrics`, `countingDatabase`, `logDbQueryCount`), the env helpers (`workerEnv`, `envStringEntries`, `workerEnvConfigProviderLayer`) and `resolveKvNamespace`. |
| `./hyperdrive` | `hyperdriveConnectionString`, `hyperdriveDatabaseLayer` (the degrading `Database` layer with the pg client factory injected), `makeRequestDatabase`. |
| `./queues` | `enqueueBestEffort`, `enqueueBatchBestEffort`, `sendBatchChunked`, `decodeQueueMessage`, `consumeBatch`, `MissingHyperdrive`, `ENQUEUE_CHUNK`. |
| `./cache` | `makeResourceCache`, `isPubliclyServeable`, `RESOURCE_CACHE_TTL`, `MIN_RESOURCE_CACHE_TTL`. |
| `./robots` | `robotsKvCache` — the KV adapter for `@thomasfosterau/effect-web-robots`' `RobotsCache` seam (a read fault is a miss, a write fault a dropped write). |
| `./testing` | `makeStubKv`, `makeStubR2`, `makeStubQueue`, `makeStubBindings`, `makeStubEnv`, `throwingBinding`, `stubHyperdriveConnectLayer`, `stubBindingsLayer`, `logicalIdOf`, `RetryVisibilityReporter`. |

Every entry is `sideEffects: false`: no top-level statements in `dist/`.

## The runtime scaffold

Alchemy's binding clients (`Cloudflare.KV.ReadWriteNamespace`, `R2.ReadWriteBucket`, `Queues.WriteQueue`, `Hyperdrive.Connect`, …) resolve `env[LogicalId]` through services that alchemy's own `WorkerBridge` provides inside a `Worker` entrypoint: `RuntimeContext`, `Stack`, `Self<Worker>`, `WorkerEnvironment`. A SvelteKit hook on adapter-cloudflare, an integration harness under Node and a hand-written queue consumer all run outside that entrypoint, so the scaffold provides the same services from stubs.

```ts
// packages/bindings/src/runtime.ts — one per application
import * as Cloudflare from "alchemy/Cloudflare";
import * as Layer from "effect/Layer";
import { makeWorkerRuntime, schedulerLayer } from "@thomasfosterau/effect-web-cloudflare";
import { hyperdriveDatabaseLayer } from "@thomasfosterau/effect-web-cloudflare/hyperdrive";
import { makePgDatabase, pgClientFromPool } from "@thomasfosterau/effect-drizzle-ext-pg";
import { Cache, PrimaryHyperdrive, relations } from "./index.ts"; // the app's declarations

export const runtime = makeWorkerRuntime({ logicalId: "Website" });

/** The binding clients this app's Workers reach. */
const bindings = (env: WorkerEnv) =>
  runtime.bindAll(
    env,
    Cloudflare.KV.ReadWriteNamespaceBinding,
    Cloudflare.R2.ReadWriteBucketBinding,
    Cloudflare.Hyperdrive.ConnectBinding,
  );

export const Database = makePgDatabase({ relations, key: "Database" });

const database = (env: WorkerEnv) =>
  hyperdriveDatabaseLayer({
    connection: PrimaryHyperdrive,
    tag: Database,
    client: (url) => pgClientFromPool({ connectionString: url }),
    database: Database.layer,
  }).pipe(Layer.provide(bindings(env)), Layer.provide(runtime.scaffoldFor(env)));

/** The per-request catalogue a SvelteKit hook builds a ManagedRuntime from. */
export const requestBindingsLayer = (input: { env: WorkerEnv; ctx?: ExecutionContext }) =>
  Layer.mergeAll(
    runtime.requestLayer(input),
    bindings(input.env),
    database(input.env),
    schedulerLayer(input.ctx),
  );

/** The per-event catalogue a queue consumer or cron handler provides itself. */
export const handlerLayer = (env: WorkerEnv) =>
  Layer.mergeAll(runtime.handlerLayer(env), bindings(env), database(env));
```

The three bases differ in one thing, the `AlchemyExecutionContext`'s lifetime: `requestLayer` takes the caller's (or binds one to its build scope), `handlerLayer` binds a fresh one per build so a pool lives for exactly one batch or cron fire (#455), and `workerLayer` shares one process-lifetime context for a Node harness.

## The read-through cache

```ts
import * as Effect from "effect/Effect";
import { resolveKvNamespace } from "@thomasfosterau/effect-web-cloudflare";
import { makeResourceCache } from "@thomasfosterau/effect-web-cloudflare/cache";
import { Cache } from "@thomasfosterau/bindings"; // the app's KV declaration
import { bypassesCacheForFreshness } from "./viewer.ts";

export const createCache = makeResourceCache({ resolveKv: resolveKvNamespace(Cache) });

const posts = createCache(Post, "posts", { owned: true, bypass: bypassesCacheForFreshness });
const pages = createCache(Page, "pages", { publishGated: true, bypass: bypassesCacheForFreshness });
const comments = createCache(Comment, "comments", {
  ttlSeconds: 60,
  bypass: bypassesCacheForFreshness,
});

// In an operation:
const getPost = (id: string) => posts.readThrough(id, dbGetPost(id));
const updatePost = (id: string, input: UpdatePost) =>
  dbUpdatePost(id, input).pipe(Effect.tap((post) => posts.setOnKv(id, post)));
```

`isPubliclyServeable` is the default policy: `visibility` must be `"public"` (and present, for an `owned` family), `moderationState` must be `"approved"`, `draft` must not be `true`, `deletedAt` must be absent, and with `publishGated` the `publishedAt` stamp must be present and arrived. A family whose gate depends on state outside the cached resource cannot express it here: it closes the gap on the write path and cuts its TTL to the 60-second floor.

## The stubs

```ts
// packages/integration-harness/stub-bindings.ts
import { makeWorkerRuntime } from "@thomasfosterau/effect-web-cloudflare";
import {
  makeStubBindings,
  makeStubEnv,
  stubBindingsLayer,
  throwingBinding,
} from "@thomasfosterau/effect-web-cloudflare/testing";

export const stubs = makeStubBindings();
export const STUB_ENV = makeStubEnv<PipelineWorkerEnv>(
  {
    Cache: stubs.kv.namespace,
    Robots: stubs.kv.namespace,
    FeedArchive: stubs.r2.bucket,
    FEED_QUEUE: stubs.queue("FEED_QUEUE").queue,
    ORIGIN_CRAWLER: throwingBinding("ORIGIN_CRAWLER"),
  },
  "preferenceflow",
);
export const stubBindings = stubBindingsLayer(
  makeWorkerRuntime({ logicalId: "Pipeline" }),
  STUB_ENV,
);
// setup.ts: beforeEach(() => stubs.reset())
```

A spec asserts through the handles (`stubs.kv.peek(key)`, `stubs.kv.seed(key, value)`, `stubs.kv.setGetFault(true)`, `stubs.r2.keys()`, `stubs.peekStubQueue("FEED_QUEUE")`) so an assertion about what the cache refused is never vacuous.

## Superseded application files

| Application file | Here |
| --- | --- |
| `packages/bindings/src/runtime.ts` (website, gardeneria, preferenceflow) | `.` — `makeWorkerRuntime`, the execution-context lifecycle, `buildRequestService`, `workerEnvConfigProviderLayer` |
| `packages/bindings/src/scheduler.ts` | `.` — `Scheduler`, `schedulerLayer` |
| `packages/bindings/src/observability-metrics.ts` | `.` — `withRequestMetrics`, `countingDatabase`, `logDbQueryCount`, `QUERY_METHODS` |
| `apps/worker/src/env.ts` (preferenceflow, `pipelineEnv`) | `.` — `workerEnv` |
| `packages/database/src/index.ts` — `connectionString`, `acquirePool`, `withoutThen`, `DatabaseLive`; `packages/bindings` `makeRequestDatabase` | `./hyperdrive` |
| `packages/jobs/src/producer.ts` (gardeneria), `embedding/queue.ts` (website), `packages/jobs/src/queue.ts` `sendBatch` (preferenceflow) | `./queues` — the producers |
| `packages/jobs/src/queues.ts` `decodeQueueMessage` (gardeneria), `consume.ts` `decodeOrDrop` (preferenceflow), `apps/worker/src/handlers.ts` `consume` + `MissingHyperdrive` (preferenceflow), `apps/worker/src/worker.ts` (website) | `./queues` — the consumers |
| `apps/api/src/cache.ts` (gardeneria, the reference; website's copy lacks the owned / publication axes) | `./cache` + `resolveKvNamespace` |
| `packages/jobs/src/web-archive/robots.ts` (website), `crawl/robots.ts` (preferenceflow) — the KV read / write around the fetch | `./robots` — `robotsKvCache` (the rest is `@thomasfosterau/effect-web-robots`) |
| `packages/integration-harness/stub-bindings.ts`, `retry-reporter.ts` (preferenceflow); `harness.ts` `peekStubQueue` / `recordingQueue` (gardeneria) | `./testing` |

The resource declarations (`Cache`, `PrimaryHyperdrive`, `FeedQueue`, …), the env types, `WorkerBindings` and each app's `Database` service stay in the application.
