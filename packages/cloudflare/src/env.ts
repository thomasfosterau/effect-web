/**
 * The Worker `env` as an Effect input: the narrowing every handler reads it
 * through, and the `ConfigProvider` over its string entries. Ported from
 * `packages/bindings/src/runtime.ts` (`workerEnvConfigProviderLayer`) and
 * preferenceflow's `apps/worker/src/env.ts` (`pipelineEnv`).
 *
 * @since 0.1.0
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";

/**
 * The least this package needs to know about a Worker `env`: a record of
 * bindings and string values, keyed by each resource's `LogicalId`. An
 * application types its own `WorkerEnv` explicitly (never via
 * `Cloudflare.InferEnv`, so one env shape is shareable across its Workers)
 * and passes it where this appears.
 *
 * @since 0.1.0
 * @category models
 */
export type WorkerEnvLike = Readonly<Record<string, unknown>>;

/**
 * The runtime `env` off `Cloudflare.WorkerEnvironment`, narrowed to the
 * application's declared env type. Alchemy declares the service as
 * `Record<string, any>`; the one narrowing lives in the app (`const
 * pipelineEnv = workerEnv<PipelineWorkerEnv>()`) so every handler reads the
 * same shape. `env` is the live binding map on every event; inside a Durable
 * Object's constructor at plan time it is `undefined`, which is why nothing
 * reads a binding off it until a handler runs.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import { workerEnv } from "@thomasfosterau/effect-web-cloudflare"
 *
 * interface PipelineEnv { readonly FEED_QUEUE: { send(body: unknown): Promise<void> } }
 * const env = { FEED_QUEUE: { send: async () => {} } }
 * const got = await Effect.runPromise(
 *   workerEnv<PipelineEnv>().pipe(Effect.provideService(Cloudflare.WorkerEnvironment, env)),
 * )
 * got === env // true
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const workerEnv = <Env>(): Effect.Effect<Env, never, Cloudflare.WorkerEnvironment> =>
  // SAFETY: `WorkerEnvironment`'s declared value is `Record<string, any>`;
  // the application's env type is the one narrowing, and it is the caller's.
  Effect.map(Cloudflare.WorkerEnvironment, (env) => env as Env);

/**
 * The string-valued entries of a Worker `env`: the `PUBLIC_*` build-time
 * values and the provider-emitted `ALCHEMY_*` values. Binding objects (KV /
 * R2 / Hyperdrive) are skipped. Tolerates a missing env (a runtime built in
 * a test or a stub phase without one).
 *
 * @example
 * ```ts
 * import { envStringEntries } from "@thomasfosterau/effect-web-cloudflare"
 *
 * envStringEntries({ PUBLIC_SITE_URL: "https://stage.example", Cache: { get: async () => null } })
 * // { PUBLIC_SITE_URL: "https://stage.example" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const envStringEntries = (env: WorkerEnvLike | undefined): Record<string, string> =>
  Record.fromEntries(
    Arr.filterMap(
      Record.toEntries(env ?? {}),
      ([key, value]): Result.Result<[string, string], void> =>
        Predicate.isString(value) ? Result.succeed([key, value]) : Result.failVoid,
    ),
  );

/**
 * A `ConfigProvider` over the Worker `env`, so Effect `Config` reads resolve
 * at request time inside the Cloudflare isolate, where there is no
 * `process.env` for the default provider to read. Without this, every
 * `Config.String(...)` would fall through to its `withDefault`, silently
 * ignoring the deployed value.
 *
 * Effect rc.118 treats an empty string as missing, and this provider keeps
 * that default: a Worker var deployed as `""` falls through to `withDefault`
 * (and fails a bare `Config.String`) exactly like an unset one.
 *
 * @example
 * ```ts
 * import * as Config from "effect/Config"
 * import * as Effect from "effect/Effect"
 * import { workerEnvConfigProviderLayer } from "@thomasfosterau/effect-web-cloudflare"
 *
 * const siteUrl = await Effect.runPromise(
 *   Config.String("PUBLIC_SITE_URL").pipe(
 *     Effect.provide(workerEnvConfigProviderLayer({ PUBLIC_SITE_URL: "https://stage.example" })),
 *   ),
 * )
 * siteUrl // "https://stage.example"
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const workerEnvConfigProviderLayer = (env: WorkerEnvLike | undefined): Layer.Layer<never> =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(envStringEntries(env)));
