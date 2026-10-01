/**
 * The `Database` layer over a Cloudflare Hyperdrive binding, ported from
 * `packages/database/src/index.ts` (website, `connectionString` +
 * `DatabaseLive`; identical in gardeneria / preferenceflow), with the two
 * application-specific parts injected: the pg client factory (in the
 * applications, `@thomasfosterau/effect-drizzle-ext-pg`'s `pgClientFromPool`
 * — lazy, scope-bound, never pings) and the database layer built over it
 * (`makePgDatabase(...).layer`). This package names neither `PgClient` nor
 * drizzle: the seam is type-only, so `@thomasfosterau/effect-drizzle-ext-pg`
 * is composed by the application, not depended on here (effect-drizzle-ext#2
 * lists Hyperdrive as a non-goal there, which is why this is its home).
 *
 * @since 0.1.0
 */
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { proxyChain } from "alchemy/Util/proxy-chain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import type * as Scope from "effect/Scope";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { buildRequestService } from "../runtime.ts";

/**
 * The redacted connection string of a Hyperdrive binding:
 * `Cloudflare.Hyperdrive.Connect(connection)` yields the binding accessor,
 * then `.connectionString`. The requirements (the `Connect` binding client
 * and the runtime scaffold) are carried honestly in the type; the
 * per-request / per-event layer graphs satisfy them at build time.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Redacted from "effect/Redacted"
 * import { hyperdriveConnectionString } from "@thomasfosterau/effect-web-cloudflare/hyperdrive"
 *
 * const PrimaryHyperdrive = Cloudflare.Hyperdrive.Connection("HYPERDRIVE", {
 *   origin: { scheme: "postgresql", host: "db.example", database: "app", user: "user", password: Redacted.make("pw") },
 * })
 * const url = hyperdriveConnectionString(PrimaryHyperdrive)
 * typeof url // "object" — an Effect, run inside a runtime that binds HYPERDRIVE
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const hyperdriveConnectionString = (
  connection: unknown,
): Effect.Effect<
  Redacted.Redacted<string>,
  never,
  Cloudflare.Hyperdrive.Connect | RuntimeContext
> =>
  Effect.gen(function* () {
    // SAFETY: the deploy-time declaration is relabelled as the concrete
    // `Connection` overload of the binding; at runtime the stub `Stack`
    // resolves the resource and the providers are never used.
    const hd = yield* Cloudflare.Hyperdrive.Connect(connection as Cloudflare.Hyperdrive.Connection);
    return yield* hd.connectionString;
  });

/**
 * What {@link hyperdriveDatabaseLayer} composes.
 *
 * @since 0.1.0
 * @category models
 */
export interface HyperdriveDatabaseOptions<Id, Client, ClientServices, E> {
  /** The Hyperdrive `Connection` resource the Worker binds. */
  readonly connection: unknown;
  /** The `Database` service tag the layer installs. */
  readonly tag: Context.Service<Id, Client>;
  /**
   * The pg client factory: `connectionString → Layer<PgClient>`. Use a LAZY
   * one (`pgClientFromPool`): a factory that pings at build would open a
   * Hyperdrive connection on every request, including ones that never query.
   * Its pool must be scope-bound so it ends with the runtime (#455).
   */
  readonly client: (connectionString: Redacted.Redacted<string>) => Layer.Layer<ClientServices, E>;
  /** The database layer over the client — `makePgDatabase(...).layer`. */
  readonly database: Layer.Layer<Id, never, ClientServices>;
}

/**
 * Wraps a degraded `proxyChain` client so a bare `await` / `then` of the
 * client itself rejects with `error`, instead of hanging.
 *
 * `proxyChain`'s `get` trap answers every unrecognised property — `then`
 * included — with another chain step, which is itself callable. `Promise`
 * resolution treats any object with a callable `then` as a thenable and calls
 * it with `(resolve, reject)` expecting one of them to be invoked; the chain
 * step just records the call and returns yet another proxy, so neither fires
 * and the Promise hangs forever. Effect's own protocol never reads `then`, so
 * this only matters on the Promise path ({@link makeRequestDatabase}, which
 * resolves the client itself rather than a query built from it) — #1978.
 */
const withoutThen = <T extends object>(proxied: T, error: unknown): T =>
  new Proxy(proxied, {
    get: (target, prop, receiver) =>
      prop === "then"
        ? (_onFulfilled: unknown, onRejected?: (reason: unknown) => void) => onRejected?.(error)
        : // oxlint-disable-next-line effect/no-reflect-get -- a `Proxy` `get` trap forwarding every property but `then` to the chain it wraps.
          Reflect.get(target, prop, receiver),
  });

/**
 * The live `Database` layer over a Hyperdrive binding: one lazy pool per
 * layer build (= per request / event runtime), torn down with the layer's
 * scope. Requires the Hyperdrive `Connect` binding client and the runtime
 * scaffold — see `makeWorkerRuntime` for the composition.
 *
 * Binding-resolution failure is deferred to first USE, not surfaced at layer
 * build: runtimes are built for every request (including ones that never
 * query, and test runtimes with stub envs), so a missing / misconfigured
 * binding degrades to a chainable proxy client rather than failing the build.
 * On the Effect path, `yield*`ing the chain (a query built from it, or the
 * client itself) fails with a `SqlError` whose reason is a `ConnectionError`
 * — the same fail-on-first-query semantics a lazy pool has. The Promise path
 * (`await makeRequestDatabase(...)`) has no query to defer to, so it rejects
 * immediately instead (#1978).
 *
 * @example
 * ```ts
 * import * as Context from "effect/Context"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import { hyperdriveDatabaseLayer } from "@thomasfosterau/effect-web-cloudflare/hyperdrive"
 *
 * // In an application: `client: pgClientFromPool` from effect-drizzle-ext-pg and
 * // `database: makePgDatabase({ relations, key: "Database" }).layer`.
 * class PgClient extends Context.Service<PgClient, { readonly url: string }>()("PgClient") {}
 * class Database extends Context.Service<Database, { readonly client: string }>()("Database") {}
 * const layer = hyperdriveDatabaseLayer({
 *   connection: { LogicalId: "HYPERDRIVE" },
 *   tag: Database,
 *   client: () => Layer.succeed(PgClient, { url: "redacted" }),
 *   database: Layer.effect(Database, Effect.map(PgClient, (pg) => ({ client: pg.url }))),
 * })
 * typeof layer // "object"
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const hyperdriveDatabaseLayer = <Id, Client extends object, ClientServices, E = never>(
  options: HyperdriveDatabaseOptions<Id, Client, ClientServices, E>,
): Layer.Layer<Id, E, Cloudflare.Hyperdrive.Connect | RuntimeContext> =>
  Layer.unwrap(
    hyperdriveConnectionString(options.connection).pipe(
      Effect.map((url) => options.database.pipe(Layer.provide(options.client(url)))),
      // oxlint-disable-next-line effect/effect-catchall-default -- catching *everything* is the documented contract of this layer: a missing or misconfigured Hyperdrive binding must degrade to the chainable proxy client rather than fail layer build, and the failure variants of binding resolution are not a fixed tag set.
      Effect.catchCause((cause) => {
        const sqlError = new SqlError({
          reason: new ConnectionError({
            cause,
            message:
              "PgClient: Hyperdrive binding unavailable (binding resolution failed at layer build)",
            operation: "connect",
          }),
        });
        return Effect.succeed(
          Layer.succeed(
            options.tag,
            withoutThen(proxyChain<Client>(Effect.fail(sqlError)), sqlError),
          ),
        );
      }),
    ),
  );

/**
 * Builds the per-request database client against a caller-owned scope, for
 * a plain (non-Effect) front door — a SvelteKit hook builds ONE client per
 * request and passes it (wrapped in `countingDatabase`) to both its stub and
 * real runtimes, closing the scope after both dispose so the pool's `end`
 * finalizer runs. Building is connection-free (the pool is lazy), so a
 * request that never queries pays nothing. A layer whose binding is absent
 * resolves to the degraded client (which rejects on `await`) rather than
 * hanging.
 *
 * `layer` is the fully provided database layer for this request: the
 * application composes {@link hyperdriveDatabaseLayer} with its runtime's
 * `bind(Hyperdrive.ConnectBinding, env)` and `scaffoldFor(env)`.
 *
 * @example
 * ```ts
 * import * as Context from "effect/Context"
 * import * as Effect from "effect/Effect"
 * import * as Exit from "effect/Exit"
 * import * as Layer from "effect/Layer"
 * import * as Scope from "effect/Scope"
 * import { makeRequestDatabase } from "@thomasfosterau/effect-web-cloudflare/hyperdrive"
 *
 * class Database extends Context.Service<Database, { readonly execute: (sql: string) => string }>()("Database") {}
 * const scope = Scope.makeUnsafe()
 * const db = await makeRequestDatabase(Layer.succeed(Database, { execute: (sql) => `ran ${sql}` }), Database, scope)
 * db.execute("select 1") // "ran select 1"
 * await Effect.runPromise(Scope.close(scope, Exit.void))
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeRequestDatabase = <Id, Client>(
  layer: Layer.Layer<Id>,
  tag: Context.Service<Id, Client>,
  scope: Scope.Scope,
): Promise<Client> => buildRequestService(layer, tag, scope);
