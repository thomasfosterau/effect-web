/**
 * The per-request / per-event runtime scaffold every Worker in the
 * applications composes, ported from `packages/bindings/src/runtime.ts`
 * (website; identical in gardeneria / preferenceflow modulo the seams):
 * the Alchemy `ExecutionContext` lifecycle, the `Stack` / `Self` /
 * `RuntimeContext` stubs that let alchemy's binding clients resolve
 * `env[LogicalId]` outside an alchemy `Worker` entrypoint (a SvelteKit
 * adapter-cloudflare hook, an integration harness), and the three layer
 * factories a request path, a Node harness and a queue / cron handler build
 * their catalogues from.
 *
 * What was hard-coded per application is a parameter here: the Worker's
 * `LogicalId` ({@link makeWorkerRuntime}), the binding-client catalogue
 * ({@link WorkerRuntime.bind} / {@link WorkerRuntime.bindAll} — website
 * declares a Browser Rendering client, gardeneria does not) and the
 * `Database` layer (it lives in `./hyperdrive`, injected through
 * {@link RequestLayerInput.services}).
 *
 * The stubs mirror `WorkerBridge` internals of `alchemy 2.0.0-beta.72` —
 * `getSharedBuild` provides `Stack` as `{ name, stage, bindings: {},
 * resources: {}, actions: {} }` and the Worker entrypoint under the `Self`
 * tag — which is why `alchemy` is a tightly-ranged peer.
 *
 * @since 0.1.0
 */
import { RuntimeContext, Stack, type BaseRuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Self } from "alchemy/Self";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { workerEnvConfigProviderLayer, type WorkerEnvLike } from "./env.ts";

/**
 * The Alchemy `ExecutionContext` service value shape: the scope a
 * request's resources (a lazy database pool) are bound to, and the cache
 * they are memoised in.
 *
 * @since 0.1.0
 * @category models
 */
export interface AlchemyExecutionContextValue {
  readonly scope: Scope.Scope;
  readonly cache: Record<string | symbol, unknown>;
}

/**
 * The per-request / per-event Alchemy execution context tag. Provided in the
 * binding graphs under the same key the applications used
 * (`alchemy/ExecutionContext`), so their runtime modules keep their
 * make / close / `executionContext` seam.
 *
 * @since 0.1.0
 * @category services
 */
export class AlchemyExecutionContext extends Context.Service<
  AlchemyExecutionContext,
  AlchemyExecutionContextValue
>()("alchemy/ExecutionContext") {}

/**
 * A closeable execution context: what {@link makeAlchemyExecutionContext}
 * hands out and {@link closeAlchemyExecutionContext} takes back.
 *
 * @since 0.1.0
 * @category models
 */
export interface CloseableExecutionContext extends AlchemyExecutionContextValue {
  readonly scope: Scope.Closeable;
}

/**
 * Builds a fresh per-request / per-event Alchemy `ExecutionContext`. The
 * caller owns the lifecycle: close it with {@link closeAlchemyExecutionContext}
 * after the last runtime sharing it has been disposed (on Workers, via
 * `ctx.waitUntil`).
 *
 * This MUST be request-scoped on Cloudflare Workers: workerd pins I/O objects
 * (a pool's TCP sockets) to the request that created them, so a context
 * shared across requests deadlocks every later request (#455).
 *
 * @example
 * ```ts
 * import { closeAlchemyExecutionContext, makeAlchemyExecutionContext } from "@thomasfosterau/effect-web-cloudflare"
 *
 * const context = makeAlchemyExecutionContext()
 * context.cache // {}
 * await closeAlchemyExecutionContext(context)
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeAlchemyExecutionContext = (): CloseableExecutionContext => ({
  scope: Scope.makeUnsafe(),
  cache: {},
});

/**
 * Closes a context created by {@link makeAlchemyExecutionContext}, running
 * the finalizers registered against its scope — notably a database pool's
 * `end`.
 *
 * @example
 * ```ts
 * import { closeAlchemyExecutionContext, makeAlchemyExecutionContext } from "@thomasfosterau/effect-web-cloudflare"
 *
 * await closeAlchemyExecutionContext(makeAlchemyExecutionContext())
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const closeAlchemyExecutionContext = (context: CloseableExecutionContext): Promise<void> =>
  // oxlint-disable-next-line effect/effect-run-in-body -- boundary: the callers are plain-JS Worker lifecycle hooks (`ctx.waitUntil(...)` in a SvelteKit hook or a `fetch` handler), which take a `Promise`, not an `Effect`. This function's whole contract is to hand them one.
  Effect.runPromise(Scope.close(context.scope, Exit.void));

/**
 * Per-build `ExecutionContext` layer: yields the layer's own build scope, so
 * the context (and the pool a database layer binds to its scope) lives
 * exactly as long as whatever built it — a `ManagedRuntime` for the request
 * path (torn down on `dispose()`), or the `Effect.provide` call for a queue
 * handler's per-event layer.
 *
 * @since 0.1.0
 * @category layers
 */
export const scopedExecutionContextLayer: Layer.Layer<AlchemyExecutionContext> = Layer.effect(
  AlchemyExecutionContext,
  Effect.map(Effect.scope, (scope) => ({ scope, cache: {} })),
);

/**
 * The `Self` tag alchemy's binding layers read the host Worker through —
 * *specialised to the Worker resource type* (`Self<Cloudflare.Worker>`,
 * key `Alchemy::Self<Cloudflare.Worker>`), which is distinct from the bare
 * `Self` factory since alchemy made `Self` a `GenericService`. Providing the
 * bare `Self` leaves a binding layer's `yield* Worker` unsatisfied.
 *
 * @since 0.1.0
 * @category services
 */
export const WorkerSelf = Self<Cloudflare.Worker>(Cloudflare.WorkerTypeId);

/**
 * What names a Worker runtime: the Worker resource's `LogicalId` (the key
 * `Self.LogicalId` reads), and the stack name / stage the `Stack` stub
 * reports.
 *
 * @since 0.1.0
 * @category models
 */
export interface WorkerRuntimeOptions {
  /** The Worker resource's `LogicalId` — `"Website"`, `"Gardeneria"`, … */
  readonly logicalId: string;
  /** The `Stack` stub's `name`. Defaults to `"test"`, as alchemy's own runtime stub does outside a deploy. */
  readonly stackName?: string | undefined;
  /** The `Stack` stub's `stage`. Defaults to `"test"`. */
  readonly stage?: string | undefined;
}

/**
 * The services every alchemy `*Binding` layer reads at build and at request
 * time, which the scaffold supplies outside an alchemy entrypoint.
 *
 * @since 0.1.0
 * @category models
 */
export type ScaffoldServices =
  | RuntimeContext
  | Stack
  | Self<Cloudflare.Worker>
  | AlchemyExecutionContext
  | Cloudflare.WorkerEnvironment;

/**
 * The services a request runtime's base layer provides — the scaffold plus
 * the `ConfigProvider` over the env's string entries.
 *
 * @since 0.1.0
 * @category models
 */
export type RequestScaffoldServices = ScaffoldServices;

/**
 * Inputs to build {@link WorkerRuntime.requestLayer}.
 *
 * @since 0.1.0
 * @category models
 */
export interface RequestLayerInput<Env extends WorkerEnvLike> {
  readonly env: Env;
  /**
   * The per-request Alchemy `ExecutionContext` carrying the scope + cache a
   * database layer builds its pool against. Pass one (from
   * {@link makeAlchemyExecutionContext}) to share a single pool across several
   * runtimes in the same request — a stub and a real runtime — and close it
   * after both dispose. When omitted, the layer creates its own, bound to the
   * layer's build scope.
   */
  readonly executionContext?: AlchemyExecutionContextValue | undefined;
}

/**
 * One application's runtime scaffold — see {@link makeWorkerRuntime}.
 *
 * @since 0.1.0
 * @category models
 */
export interface WorkerRuntime {
  readonly options: WorkerRuntimeOptions;
  /**
   * The scaffold wired to one Worker `env` — what every `*Binding` layer is
   * `Layer.provide`d: `RuntimeContext`, `Stack`, `Self<Worker>`, a
   * process-lifetime `ExecutionContext` (inert for a layer *build*), and
   * `WorkerEnvironment` so bindings resolve `env[LogicalId]`.
   */
  readonly scaffoldFor: (env: WorkerEnvLike) => Layer.Layer<ScaffoldServices>;
  /**
   * Provides the scaffold to one binding-client layer (`KV.ReadWriteNamespaceBinding`,
   * `R2.ReadWriteBucketBinding`, `Images.ImagesBinding`, `Workers.BrowserBinding`,
   * `Queues.WriteQueueBinding`, `Hyperdrive.ConnectBinding`, …) and drops
   * the deploy-time provider tags its type carries: at request time the stub
   * `Stack` resolves a resource from `stack.resources` and the providers are
   * never used. Each client is lazy — it reads `env[name]` when a method is
   * called, not when the layer is built — so one catalogue can serve Workers
   * with different `env:` surfaces, and a binding a Worker never declared
   * fails only if something reaches for it.
   */
  readonly bind: <S>(binding: Layer.Layer<S, never, any>, env: WorkerEnvLike) => Layer.Layer<S>;
  /**
   * {@link WorkerRuntime.bind} over a catalogue, merged.
   */
  readonly bindAll: <const Layers extends ReadonlyArray<Layer.Layer<any, never, any>>>(
    env: WorkerEnvLike,
    ...bindings: Layers
  ) => Layer.Layer<Layer.Success<Layers[number]>>;
  /**
   * The per-request base layer: `WorkerEnvironment`, the `ConfigProvider`
   * over the env's string entries, and the `RuntimeContext` / `Stack` /
   * `Self` stubs — required at *request* time, not only at layer build:
   * `Binding.Service.bind(resource)` yields the resource value itself
   * (resources are Effects whose evaluation reads `Stack`), and every
   * `Binding.Policy` wraps its body in `Self.use`, so the first Hyperdrive
   * query would otherwise die with "Service not found: Stack" (#455) — plus
   * the request's `ExecutionContext` (the caller's, or one bound to this
   * layer's build scope). Merge the app's binding clients
   * ({@link WorkerRuntime.bindAll}) and its `Database` layer onto it.
   */
  readonly requestLayer: <Env extends WorkerEnvLike>(
    input: RequestLayerInput<Env>,
  ) => Layer.Layer<RequestScaffoldServices>;
  /**
   * The Node-only catalogue base for an integration harness: the same
   * scaffold with a **process-lifetime** `ExecutionContext` — under Node a
   * process-lifetime context is the intended "serverful" semantics, and no
   * workerd I/O pinning applies.
   */
  readonly workerLayer: (env: WorkerEnvLike) => Layer.Layer<ScaffoldServices>;
  /**
   * The per-event base for a queue consumer or cron handler: the scaffold,
   * the `ConfigProvider`, and a `ExecutionContext` bound to the layer's own
   * build scope, so each handler invocation that `Effect.provide`s it gets
   * a context — and a pool — that lives for exactly one batch or run and is
   * torn down when the handler completes (#455).
   */
  readonly handlerLayer: (env: WorkerEnvLike) => Layer.Layer<RequestScaffoldServices>;
}

/**
 * The `RuntimeContext` / `Stack` / `Self<Worker>` stubs alone — what a
 * resource declaration needs to resolve outside a deploy (`logicalIdOf` in
 * `./testing`), and what {@link makeWorkerRuntime} builds its scaffold from.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import { runtimeStubsLayer } from "@thomasfosterau/effect-web-cloudflare"
 *
 * const id = await Effect.runPromise(
 *   Effect.map(Cloudflare.KV.Namespace("Cache"), (namespace) => namespace.LogicalId).pipe(
 *     Effect.provide(runtimeStubsLayer({ logicalId: "App" })),
 *   ) as Effect.Effect<string, never, never>,
 * )
 * id // "Cache"
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const runtimeStubsLayer = (
  options: WorkerRuntimeOptions,
): Layer.Layer<RuntimeContext | Stack | Self<Cloudflare.Worker>> => {
  // SAFETY: a deliberate stub. The real `Self<Cloudflare.Worker>` value is a
  // deploy-time alchemy `Worker` resource; only `LogicalId`, the type id and
  // `bind` are read at request time (see the doc above), so `never` is what
  // makes the stub assignable to the specialised tag.
  // oxlint-disable-next-line effect/no-chained-type-assertions -- there is no precise type to keep: the stub is assignable to nothing alchemy exports, and `never` is the one type `Layer.succeed(WorkerSelf, …)` accepts for it.
  const selfStub = {
    Type: Cloudflare.WorkerTypeId,
    LogicalId: options.logicalId,
    bind: () => () => Effect.void,
  } as unknown as never;

  const runtimeContextStub: BaseRuntimeContext = {
    Type: Cloudflare.WorkerTypeId,
    id: options.logicalId,
    env: {},
    get: () => Effect.die("RuntimeContext.get is deploy-time only"),
    set: () => Effect.die("RuntimeContext.set is deploy-time only"),
  };

  // SAFETY: a deliberate stub, same reason as `selfStub`: the full deploy-time
  // `Stack` surface is never exercised on the request path; only
  // `resources` / `bindings` / `actions` are read, and alchemy's own runtime
  // provides exactly this shape inside its Worker entrypoints.
  // oxlint-disable-next-line effect/no-chained-type-assertions -- same as `selfStub`: no precise type exists for a partial `Stack`.
  const stackStub = {
    name: options.stackName ?? "test",
    stage: options.stage ?? "test",
    resources: {},
    bindings: {},
    actions: {},
  } as unknown as never;

  return Layer.mergeAll(
    Layer.succeed(RuntimeContext, runtimeContextStub),
    Layer.succeed(Stack, stackStub),
    Layer.succeed(WorkerSelf, selfStub),
  );
};

/**
 * Builds one application's {@link WorkerRuntime} from its Worker's
 * `LogicalId`.
 *
 * The `Self` and `RuntimeContext` values are minimal stubs satisfying the
 * `BaseRuntimeContext` shape — `Binding.Policy.asEffect` only reads
 * `Self.LogicalId`; `isWorker(host)` is true for the stub (it carries the
 * Worker type id), so a binding policy calls `host.bind\`…\`({…})` to register
 * the binding, which at runtime is a no-op tagged-template function, and the
 * binding client then resolves `env[LogicalId]` from the live / stub env.
 * The `Stack` stub's `resources` / `bindings` / `actions` must be real
 * (empty) objects: alchemy's `Resource` constructor reads
 * `stack.resources[fqn]` when a binding resolves.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import { makeWorkerRuntime } from "@thomasfosterau/effect-web-cloudflare"
 *
 * const runtime = makeWorkerRuntime({ logicalId: "Website" })
 * const Cache = Cloudflare.KV.Namespace("Cache")
 * const env = { Cache: { get: async (key: string) => (key === "warm" ? "hit" : null) } }
 *
 * const layer = Layer.merge(
 *   runtime.requestLayer({ env }),
 *   runtime.bindAll(env, Cloudflare.KV.ReadWriteNamespaceBinding),
 * )
 * const hit = await Effect.runPromise(
 *   Effect.gen(function* () {
 *     const cache = yield* Cloudflare.KV.ReadWriteNamespace(Cache)
 *     return yield* cache.get("warm")
 *   }).pipe(Effect.provide(layer)) as Effect.Effect<unknown, never, never>,
 * )
 * hit // "hit"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeWorkerRuntime = (options: WorkerRuntimeOptions): WorkerRuntime => {
  /**
   * Module-lifetime `ExecutionContext` for the **Node-only** surfaces and
   * for the inert `ExecutionContext` requirement of binding-layer *builds*.
   * Never used on a Workers execution path (see the module doc, #455).
   */
  const processExecutionContext: AlchemyExecutionContextValue = {
    scope: Scope.makeUnsafe(),
    cache: {},
  };

  const stubs = runtimeStubsLayer(options);

  const environment = (env: WorkerEnvLike): Layer.Layer<Cloudflare.WorkerEnvironment> =>
    Layer.succeed(Cloudflare.WorkerEnvironment, env);

  const scaffoldFor = (env: WorkerEnvLike): Layer.Layer<ScaffoldServices> =>
    Layer.mergeAll(
      stubs,
      Layer.succeed(AlchemyExecutionContext, processExecutionContext),
      environment(env),
    );

  const bind = <S>(binding: Layer.Layer<S, never, any>, env: WorkerEnvLike): Layer.Layer<S> =>
    // SAFETY: the binding layer names alchemy's deploy-time `Worker` host tag
    // and provider tags in its requirement; the scaffold satisfies the host
    // under the `Self<Cloudflare.Worker>` key it is looked up by at runtime,
    // and the providers are never used there (the stub `Stack` resolves the
    // resource from `stack.resources`).
    binding.pipe(Layer.provide(scaffoldFor(env))) as Layer.Layer<S>;

  const bindAll = <const Layers extends ReadonlyArray<Layer.Layer<any, never, any>>>(
    env: WorkerEnvLike,
    ...bindings: Layers
  ): Layer.Layer<Layer.Success<Layers[number]>> =>
    // SAFETY: each member is `bind`-ed to `Layer<S>`; `mergeAll` over the
    // spread loses the tuple's success union, which this restates.
    Layer.mergeAll(
      ...(bindings.map((binding) => bind(binding, env)) as [Layer.Layer<any>]),
    ) as Layer.Layer<Layer.Success<Layers[number]>>;

  const requestLayer = <Env extends WorkerEnvLike>(
    input: RequestLayerInput<Env>,
  ): Layer.Layer<RequestScaffoldServices> =>
    Layer.mergeAll(
      environment(input.env),
      workerEnvConfigProviderLayer(input.env),
      stubs,
      input.executionContext === undefined
        ? scopedExecutionContextLayer
        : Layer.succeed(AlchemyExecutionContext, input.executionContext),
    );

  const workerLayer = (env: WorkerEnvLike): Layer.Layer<ScaffoldServices> => scaffoldFor(env);

  const handlerLayer = (env: WorkerEnvLike): Layer.Layer<RequestScaffoldServices> =>
    Layer.mergeAll(
      environment(env),
      workerEnvConfigProviderLayer(env),
      stubs,
      scopedExecutionContextLayer,
    );

  return { options, scaffoldFor, bind, bindAll, requestLayer, workerLayer, handlerLayer };
};

/**
 * Builds one service of a layer against a caller-owned scope and hands its
 * value to plain (non-Effect) code — the applications' `makeRequestDatabase`:
 * a SvelteKit hook builds ONE database client per request this way and
 * passes it (wrapped in `countingDatabase`) to both its stub and real
 * runtimes, so the whole request holds a single lazy pool; it closes the
 * scope after the last runtime sharing the client has been disposed
 * ({@link closeAlchemyExecutionContext}), which runs the pool's `end`
 * finalizer. Building is cheap and connection-free when the layer is lazy,
 * so requests that never query pay nothing.
 *
 * @example
 * ```ts
 * import * as Context from "effect/Context"
 * import * as Effect from "effect/Effect"
 * import * as Exit from "effect/Exit"
 * import * as Layer from "effect/Layer"
 * import * as Scope from "effect/Scope"
 * import { buildRequestService } from "@thomasfosterau/effect-web-cloudflare"
 *
 * class Greeting extends Context.Service<Greeting, string>()("Greeting") {}
 * const scope = Scope.makeUnsafe()
 * const greeting = await buildRequestService(Layer.succeed(Greeting, "hello"), Greeting, scope)
 * greeting // "hello"
 * await Effect.runPromise(Scope.close(scope, Exit.void))
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const buildRequestService = <Id, Value>(
  layer: Layer.Layer<Id>,
  tag: Context.Service<Id, Value>,
  scope: Scope.Scope,
): Promise<Value> =>
  // oxlint-disable-next-line effect/effect-run-in-body -- boundary: a SvelteKit hook / Worker `fetch` handler is plain async JS and awaits this before any `ManagedRuntime` exists to run it inside.
  Effect.runPromise(
    Effect.map(Layer.buildWithScope(layer, scope), (context) => Context.get(context, tag)),
  );
