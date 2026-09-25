/**
 * Unit tests for the runtime scaffold — ported from preferenceflow's
 * `packages/bindings/tests/runtime.test.ts` (the superset of website's and
 * gardeneria's), composed against STUB bindings, no Cloudflare runtime and
 * no database:
 *
 * - `makeAlchemyExecutionContext` / `closeAlchemyExecutionContext` — the
 *   per-request Alchemy `ExecutionContext` lifecycle the request path owns.
 * - `requestLayer` — `WorkerEnvironment` resolves straight from the supplied
 *   env; a real KV binding client resolves `env["Cache"]` from a stub
 *   namespace through the stub `Stack` / `Self` scaffold; Effect `Config`
 *   reads see the env's string entries; the caller's `executionContext` is
 *   honoured as-is.
 * - `workerLayer` / `handlerLayer` — the Node harness and per-event bases.
 * - `buildRequestService` — a service built against a caller-owned scope.
 *
 * The `Database` composition is `./hyperdrive`'s and is tested there.
 */

/*
 * A vitest test body IS the runtime boundary — it is the entrypoint that runs
 * the effect under test, and `effect-run-in-body` has no entrypoint detection.
 */
/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import { Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import {
  AlchemyExecutionContext,
  buildRequestService,
  closeAlchemyExecutionContext,
  makeAlchemyExecutionContext,
  makeWorkerRuntime,
  runtimeStubsLayer,
  type WorkerEnvLike,
  WorkerSelf,
} from "@thomasfosterau/effect-web-cloudflare";

/** The application's declaration — this package declares none of its own. */
const Cache = Cloudflare.KV.Namespace("Cache");

/**
 * An in-memory stand-in for the `Cache` KV namespace: only the `get` the
 * binding client under test reaches. Keyed by the resource's `LogicalId` on
 * the env below, because that is the key the client reads.
 */
const stubCache = {
  get: async (key: string) => (key === "warm" ? "hit" : null),
};

/**
 * A minimal Worker env: string entries (so the `ConfigProvider` has
 * something to expose) plus the one stub binding object.
 */
const fakeEnv: WorkerEnvLike = {
  Cache: stubCache,
  PUBLIC_SITE_URL: "https://stage.example",
  ALCHEMY_STAGE: "test",
  ALCHEMY_PHASE: "runtime",
  ALCHEMY_STACK_NAME: "app",
};

const runtime = makeWorkerRuntime({ logicalId: "App", stackName: "app", stage: "test" });

const linkBase = Config.String("PUBLIC_SITE_URL").pipe(Config.withDefault("https://fallback"));

/**
 * Run `effect` under `requestLayer` + the KV client for `fakeEnv`. The
 * residual requirements after `Effect.provide` are the deploy-time provider
 * tags an alchemy resource Effect carries in its type; at request time the
 * stub `Stack` resolves the resource from `stack.resources` and they are
 * never used, so the cast is the same one the runtime module itself carries.
 */
const runRequest = <A, E>(
  effect: Effect.Effect<A, E, unknown>,
  input: { readonly executionContext?: AlchemyExecutionContext["Service"] | undefined } = {},
  env: WorkerEnvLike = fakeEnv,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.merge(
          runtime.requestLayer({ env, ...input }),
          runtime.bindAll(env, Cloudflare.KV.ReadWriteNamespaceBinding),
        ),
      ),
    ) as Effect.Effect<A, E, never>,
  );

describe("makeAlchemyExecutionContext / closeAlchemyExecutionContext", () => {
  it("builds a context with a fresh closeable scope and empty cache, then closes it", async () => {
    const context = makeAlchemyExecutionContext();
    expect(context.cache).toEqual({});
    expect(context.scope).toBeDefined();
    await expect(closeAlchemyExecutionContext(context)).resolves.toBeUndefined();
  });

  it("hands out a distinct context (and cache) per call", () => {
    const a = makeAlchemyExecutionContext();
    const b = makeAlchemyExecutionContext();
    expect(a.cache).not.toBe(b.cache);
    expect(a.scope).not.toBe(b.scope);
  });

  it("runs the finalizers registered against the scope on close", async () => {
    const context = makeAlchemyExecutionContext();
    let finalized = false;
    await Effect.runPromise(
      Scope.addFinalizer(
        context.scope,
        Effect.sync(() => {
          finalized = true;
        }),
      ),
    );
    await closeAlchemyExecutionContext(context);
    expect(finalized).toBe(true);
  });
});

describe("requestLayer", () => {
  it("provides WorkerEnvironment resolved straight from the supplied env", async () => {
    const got = await runRequest(Cloudflare.WorkerEnvironment);
    expect(got).toBe(fakeEnv);
  });

  it("resolves a KV binding client against the stub namespace keyed by the resource id", async () => {
    const got = await runRequest(
      Effect.gen(function* () {
        const cache = yield* Cloudflare.KV.ReadWriteNamespace(Cache);
        const hit = yield* cache.get("warm");
        const miss = yield* cache.get("cold");
        return { hit, miss };
      }),
    );
    expect(got).toEqual({ hit: "hit", miss: null });
  });

  it("exposes the env's string entries to Effect Config reads", async () => {
    await expect(runRequest(linkBase)).resolves.toBe("https://stage.example");
  });

  it("uses the caller's ExecutionContext when one is supplied", async () => {
    const context = makeAlchemyExecutionContext();
    const got = await runRequest(AlchemyExecutionContext, { executionContext: context });
    expect(got).toBe(context);
    await closeAlchemyExecutionContext(context);
  });

  it("binds its own ExecutionContext to the layer's build scope when none is supplied", async () => {
    const got = await runRequest(AlchemyExecutionContext);
    expect(got.cache).toEqual({});
    expect(got.scope).toBeDefined();
  });

  it("reports the configured stack name and stage through the Stack stub", async () => {
    const got = await runRequest(Effect.map(Stack, (stack) => [stack.name, stack.stage]));
    expect(got).toEqual(["app", "test"]);
  });

  it("names the Worker through the specialised Self tag", async () => {
    const got = await runRequest(Effect.map(WorkerSelf, (self) => self.LogicalId));
    expect(got).toBe("App");
  });
});

describe("workerLayer", () => {
  it("provides WorkerEnvironment and the same lazy KV client the request path does", async () => {
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const env = yield* Cloudflare.WorkerEnvironment;
        const cache = yield* Cloudflare.KV.ReadWriteNamespace(Cache);
        return { env, hit: yield* cache.get("warm") };
      }).pipe(
        Effect.provide(
          Layer.merge(
            runtime.workerLayer(fakeEnv),
            runtime.bindAll(fakeEnv, Cloudflare.KV.ReadWriteNamespaceBinding),
          ),
        ),
      ) as Effect.Effect<{ env: unknown; hit: unknown }, never, never>,
    );
    expect(got).toEqual({ env: fakeEnv, hit: "hit" });
  });

  it("shares one process-lifetime ExecutionContext across builds", async () => {
    const read = Effect.runPromise(
      AlchemyExecutionContext.pipe(Effect.provide(runtime.workerLayer(fakeEnv))),
    );
    const a = await read;
    const b = await Effect.runPromise(
      AlchemyExecutionContext.pipe(Effect.provide(runtime.workerLayer(fakeEnv))),
    );
    expect(a).toBe(b);
  });
});

describe("handlerLayer", () => {
  it("provides WorkerEnvironment and Config reads for a per-event handler", async () => {
    const got = await Effect.runPromise(
      Effect.all([Cloudflare.WorkerEnvironment, linkBase], { concurrency: 1 }).pipe(
        Effect.provide(runtime.handlerLayer(fakeEnv)),
      ) as Effect.Effect<[unknown, string], never, never>,
    );
    expect(got).toEqual([fakeEnv, "https://stage.example"]);
  });

  it("binds a fresh ExecutionContext per build, so each event gets its own (#455)", async () => {
    const a = await Effect.runPromise(
      AlchemyExecutionContext.pipe(Effect.provide(runtime.handlerLayer(fakeEnv))),
    );
    const b = await Effect.runPromise(
      AlchemyExecutionContext.pipe(Effect.provide(runtime.handlerLayer(fakeEnv))),
    );
    expect(a).not.toBe(b);
    expect(a.cache).not.toBe(b.cache);
  });
});

describe("buildRequestService", () => {
  class Greeting extends Context.Service<Greeting, string>()("Greeting") {}

  it("builds the service against a caller-owned scope and runs its finalizer on close", async () => {
    let released = false;
    const layer = Layer.effect(
      Greeting,
      Effect.acquireRelease(Effect.succeed("hello"), () =>
        Effect.sync(() => {
          released = true;
        }),
      ),
    );
    const scope = Scope.makeUnsafe();
    await expect(buildRequestService(layer, Greeting, scope)).resolves.toBe("hello");
    expect(released).toBe(false);
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(released).toBe(true);
  });
});

describe("runtimeStubsLayer", () => {
  it("lets a resource declaration resolve its LogicalId outside a deploy", async () => {
    const id = await Effect.runPromise(
      Effect.map(Cache, (namespace) => namespace.LogicalId).pipe(
        Effect.provide(runtimeStubsLayer({ logicalId: "App" })),
      ) as Effect.Effect<string, never, never>,
    );
    expect(id).toBe("Cache");
  });
});
