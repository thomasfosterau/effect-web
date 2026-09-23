---
"@thomasfosterau/effect-web-cloudflare": minor
---

Initial release: the Cloudflare Workers / Alchemy runtime scaffold extracted from the website, gardeneria and preferenceflow applications, with the per-application parts injected.

- `.` — `makeWorkerRuntime` (`requestLayer` / `workerLayer` / `handlerLayer`, `bind` / `bindAll`, `scaffoldFor`), `runtimeStubsLayer`, the `AlchemyExecutionContext` lifecycle, `buildRequestService`, `Scheduler` / `schedulerLayer`, `withRequestMetrics` / `countingDatabase` / `logDbQueryCount`, `workerEnv` / `envStringEntries` / `workerEnvConfigProviderLayer`, `resolveKvNamespace`.
- `./hyperdrive` — `hyperdriveConnectionString`, `hyperdriveDatabaseLayer` (the degrading `Database` layer, pg client factory injected — composes `@thomasfosterau/effect-drizzle-ext-pg` without depending on it), `makeRequestDatabase`.
- `./queues` — `enqueueBestEffort`, `enqueueBatchBestEffort`, `sendBatchChunked`, `decodeQueueMessage`, `consumeBatch`, `MissingHyperdrive`.
- `./cache` — `makeResourceCache` (the KV read-through resource cache, PERF-CACHE-004) with `isPubliclyServeable` and gardeneria's `{ owned, publishGated }` posture as the default serveability policy.
- `./testing` — `makeStubKv` / `makeStubR2` / `makeStubQueue` / `makeStubBindings`, `makeStubEnv`, `throwingBinding`, `stubHyperdriveConnectLayer`, `stubBindingsLayer`, `logicalIdOf`, `RetryVisibilityReporter`.

Peers: `effect` >= 4.0.0-rc.115, `alchemy` exactly 2.0.0-beta.79 (the first alchemy built for rc.115's `Config.String`), `@cloudflare/workers-types` optional.
