/**
 * `Scheduler` — the Effect → `ExecutionContext.waitUntil` bridge, ported from
 * `packages/bindings/src/scheduler.ts` (website; identical in every
 * application's per-request runtime, #945).
 *
 * Cloudflare Workers expose `ctx.waitUntil(promise)` so the runtime keeps the
 * Worker alive until the promise settles, even after the Response has been
 * returned. Operations that need fire-and-forget side effects (an analytics
 * flush, a background write) yield `Scheduler` and pass the Effect they want
 * to keep running.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * The `Scheduler` service: keep an effect running past the response.
 *
 * @since 0.1.0
 * @category models
 */
export interface SchedulerService {
  readonly waitUntil: <A>(effect: Effect.Effect<A, unknown>) => Effect.Effect<void>;
}

/**
 * Keeps an effect running past the response (`ctx.waitUntil` on Workers,
 * detached when there is no `ctx`); provide it with {@link schedulerLayer}.
 *
 * @since 0.1.0
 * @category services
 */
export class Scheduler extends Context.Service<Scheduler, SchedulerService>()("Scheduler") {}

/**
 * The one member of the platform `ExecutionContext` the bridge consumes.
 *
 * @since 0.1.0
 * @category models
 */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The live `Scheduler` layer over a platform `ExecutionContext`, taken as a
 * constructor argument so the service is self-contained. When the platform
 * supplies no `ctx` (local dev, a test without bindings) the bridge runs the
 * effect detached — the work still happens, but nothing keeps the Worker
 * alive past the response; a detached failure is swallowed rather than
 * surfacing as an unhandled rejection.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Scheduler, schedulerLayer } from "@thomasfosterau/effect-web-cloudflare"
 *
 * const handed: Array<Promise<unknown>> = []
 * const ctx = { waitUntil: (promise: Promise<unknown>) => { handed.push(promise) } }
 * await Effect.runPromise(
 *   Effect.gen(function* () {
 *     const scheduler = yield* Scheduler
 *     yield* scheduler.waitUntil(Effect.log("flushed after the response"))
 *   }).pipe(Effect.provide(schedulerLayer(ctx))),
 * )
 * handed.length // 1
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const schedulerLayer = (ctx: ExecutionContextLike | undefined): Layer.Layer<Scheduler> =>
  Layer.succeed(Scheduler)({
    waitUntil: <A>(effect: Effect.Effect<A, unknown>) =>
      Effect.sync(() => {
        // SAFETY: the service interface admits any effect with no requirements
        // (`Effect<A, unknown>` defaults `R` to `never`); the assertion restates
        // that for `runPromise`.
        // oxlint-disable-next-line effect/effect-run-in-body -- this service IS the Effect -> platform boundary: `ExecutionContext.waitUntil` takes a `Promise`, so the effect must be run to produce one. That bridge is the whole purpose of the module.
        const promise = Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
        if (ctx !== undefined) ctx.waitUntil(promise);
        // Detached fire-and-forget when no ctx: catch to avoid an unhandled rejection.
        promise.catch(() => {});
      }),
  });
