# @thomasfosterau/effect-web-cloudflare

The Cloudflare Workers / Alchemy half of the family: the per-request / per-event runtime scaffold, the Hyperdrive `Database` seam, queue glue, the KV read-through resource cache, the robots.txt KV cache adapter and the in-memory binding stubs. Held private until alchemy ships an Effect rc.118 build (effect-web#33).

## Boundary

Peers: `effect`, `alchemy`, `@cloudflare/workers-types` (optional, types only). May import from `@thomasfosterau/effect-web` (`.fallowrc.json` zone `cloudflare` → `web`, `robots`): `logStructured` for the `read-path.db` line, `logWarningEvent` / `describeError` for the queue drop; and from `@thomasfosterau/effect-web-robots` the `RobotsCache` type the `./robots` KV adapter implements. Nothing here is imported by `packages/web` or `packages/robots`.

## Invariants

- **`alchemy` is an exact-version peer** (`catalogs.peers.alchemy`, today `2.0.0-beta.79`). `runtimeStubsLayer` mirrors what alchemy's `WorkerBridge` provides inside its own entrypoints; widen the range only after re-reading `lib/Cloudflare/Workers/WorkerBridge.js` in the new beta. An alchemy beta loads only on the Effect line it was built for (beta.79 imports `effect/unstable/*`, which rc.118 removed), so the `alchemy` and `effect` pins move together.
- **No resource declarations.** `Cloudflare.KV.Namespace("Cache")` and friends stay in each application's bindings package; everything here takes the declaration (`resolveKvNamespace(Cache)`, `hyperdriveConnectionString(PrimaryHyperdrive)`) or the env key (`consumeBatch`'s `hyperdrive`) as a parameter.
- **`./hyperdrive` names neither `PgClient` nor drizzle.** The client factory and database layer are injected (`@thomasfosterau/effect-drizzle-ext-pg`'s `pgClientFromPool` + `makePgDatabase(...).layer` in the applications); `tests/hyperdrive.test.ts` composes the real peer when it resolves and skips until it is published. Do not vendor effect-drizzle-ext code here.
- **Enqueue is best-effort by design** (`enqueueBestEffort`, `enqueueBatchBestEffort`): a producer runs on the request path, and a failed enqueue is swallowed rather than propagated, in one documented place. `sendBatchChunked` (alchemy's client) is the exception: it fails with `SendError` and the caller decides.
- **The cache serves only what `serveable` passes** (PERF-CACHE-004 / CACHE-AUTH-005): a private hit falls through to the DB, a non-serveable DB result is never written, and `setOnKv` DELETES a non-serveable resource rather than skipping it (#1096). KV faults degrade to a DB read; they never fail a read or a mutation.
- **The counting proxy invokes with the real client as `this`** (`Reflect.apply(value, target, args)`); an unbound call 500'd the applications' create forms. Per query call it costs one `Set.has` and, with a scope active, one `updateUnsafe`.
- **The stubs implement the native binding surface**, so a test drives the SAME alchemy clients the deployed Worker runs; they never implement the client. A surface a local test may not reach (multipart upload, a Durable Object) throws rather than passing against a fake.

## Terms

- **Scaffold** — the services every alchemy `*Binding` layer reads outside an alchemy `Worker` entrypoint: `RuntimeContext`, `Stack`, `Self<Cloudflare.Worker>` (stubs — `runtimeStubsLayer`), `WorkerEnvironment` (the live `env`) and the `AlchemyExecutionContext`. One `WorkerRuntime` per application, from `makeWorkerRuntime({ logicalId })`.
- **Bind** — `runtime.bind(SomeBinding, env)`: an alchemy binding-client layer with the scaffold provided and its deploy-time provider tags dropped. Lazy: it reads `env[LogicalId]` when a method is called, never at build.
- **Execution context** — the app-owned `alchemy/ExecutionContext` service (`{ scope, cache }`), the scope a request's pool is bound to. Request-scoped on Workers (#455), process-lifetime under Node. Alchemy itself does not read it.
- **Degraded client** — the `proxyChain` a `Database` layer installs when its Hyperdrive binding cannot be resolved: chainable, fails with a `SqlError` on first `yield*`, rejects on `await` (`withoutThen`, #1978).
- **Serveability** — the pure gate the read-through cache applies on both the serve-a-hit and populate-on-miss sites. `isPubliclyServeable` with `{ owned, publishGated }` is the default policy; a family passes its own predicate instead.
- **Freshness bypass** — a viewer who reads the DB directly because the cache cannot be fresh for them (`bypass`). A routing decision, not a security check (#1215).
