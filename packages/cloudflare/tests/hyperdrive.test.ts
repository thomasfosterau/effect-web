/**
 * Unit tests for the Hyperdrive `Database` seam — website's `DatabaseLive`
 * (`packages/database/src/index.ts`) and the `Database` cases of
 * preferenceflow's `packages/bindings/tests/runtime.test.ts`, with the pg
 * client factory injected:
 *
 * - over a STUB Hyperdrive binding the layer builds a client without
 *   connecting (the injected factory is the only thing that could);
 * - with no binding at all it degrades to the fail-on-first-query client on
 *   the Effect path, and rejects immediately on the Promise path (#1978);
 * - the real `@thomasfosterau/effect-drizzle-ext-pg` composition runs when
 *   that peer resolves, and skips until it is published.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import { makeWorkerRuntime, type WorkerEnvLike } from "@thomasfosterau/effect-web-cloudflare";
import {
  hyperdriveConnectionString,
  hyperdriveDatabaseLayer,
  makeRequestDatabase,
} from "@thomasfosterau/effect-web-cloudflare/hyperdrive";

/** The application's declaration. */
const PrimaryHyperdrive = Cloudflare.Hyperdrive.Connection("HYPERDRIVE", {
  origin: {
    scheme: "postgresql",
    host: "db.example",
    database: "app",
    user: "user",
    password: Redacted.make("pw"),
  },
});

/**
 * A stand-in for the `HYPERDRIVE` binding: only the `connectionString` the
 * `Connect` client reads. Nothing listens on this address.
 */
const STUB_URL = "postgresql://stub:stub@127.0.0.1:5432/stub";
const stubHyperdrive = { connectionString: STUB_URL };

const runtime = makeWorkerRuntime({ logicalId: "App" });

/** A fake `PgClient` service standing in for effect-drizzle-ext-pg's. */
class PgClient extends Context.Service<PgClient, { readonly url: string }>()("PgClient") {}

/** A fake `Database` client with the one method the tests drive. */
interface FakeClient {
  readonly execute: (sql: string) => Effect.Effect<string>;
}
class Database extends Context.Service<Database, FakeClient>()("Database") {}

/** The injected factories: what an application passes from effect-drizzle-ext-pg. */
const seen: Array<string> = [];
const client = (url: Redacted.Redacted<string>) =>
  Layer.effect(
    PgClient,
    Effect.sync(() => {
      seen.push(Redacted.value(url));
      return { url: Redacted.value(url) };
    }),
  );
const database: Layer.Layer<Database, never, PgClient> = Layer.effect(
  Database,
  Effect.map(PgClient, (pg) => ({ execute: (sql) => Effect.succeed(`${pg.url}: ${sql}`) })),
);

const databaseLayer = (env: WorkerEnvLike) =>
  hyperdriveDatabaseLayer({ connection: PrimaryHyperdrive, tag: Database, client, database }).pipe(
    Layer.provide(runtime.bind(Cloudflare.Hyperdrive.ConnectBinding, env)),
    Layer.provide(runtime.scaffoldFor(env)),
  );

const envWith: WorkerEnvLike = { HYPERDRIVE: stubHyperdrive };
const envWithout: WorkerEnvLike = {};

const sqlErrorOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined;

describe("hyperdriveConnectionString", () => {
  it("yields the binding's connection string, redacted", async () => {
    const env = envWith;
    const got = await Effect.runPromise(
      hyperdriveConnectionString(PrimaryHyperdrive).pipe(
        Effect.provide(
          Layer.merge(
            runtime.requestLayer({ env }),
            runtime.bind(Cloudflare.Hyperdrive.ConnectBinding, env),
          ),
        ),
      ) as Effect.Effect<Redacted.Redacted<string>, never, never>,
    );
    expect(Redacted.value(got)).toBe(STUB_URL);
    expect(String(got)).not.toContain("stub:stub");
  });
});

describe("hyperdriveDatabaseLayer", () => {
  it("builds the Database over the stub binding through the injected client factory", async () => {
    seen.length = 0;
    const got = await Effect.runPromise(
      Effect.flatMap(Database, (db) => db.execute("select 1")).pipe(
        Effect.provide(databaseLayer(envWith)),
      ),
    );
    expect(got).toBe(`${STUB_URL}: select 1`);
    expect(seen).toEqual([STUB_URL]);
  });

  it("degrades to a client whose first query fails with a SqlError when HYPERDRIVE is absent", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const db = yield* Database;
        return yield* db.execute("select 1");
      }).pipe(Effect.provide(databaseLayer(envWithout))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const failure = sqlErrorOf(exit);
    expect(failure).toMatchObject({ _tag: "SqlError", reason: { _tag: "ConnectionError" } });
  });

  it("carries the client factory's error type rather than swallowing it", async () => {
    class PoolDown extends Error {}
    const failing = hyperdriveDatabaseLayer({
      connection: PrimaryHyperdrive,
      tag: Database,
      client: () => Layer.effect(PgClient, Effect.fail(new PoolDown("pool down"))),
      database,
    }).pipe(
      Layer.provide(runtime.bind(Cloudflare.Hyperdrive.ConnectBinding, envWith)),
      Layer.provide(runtime.scaffoldFor(envWith)),
    );
    const exit = await Effect.runPromiseExit(Database.pipe(Effect.provide(failing)));
    expect(sqlErrorOf(exit)).toBeInstanceOf(PoolDown);
  });
});

describe("makeRequestDatabase", () => {
  it("builds a client against a caller-owned scope over the stub binding, and closes cleanly", async () => {
    const scope = Scope.makeUnsafe();
    const db = await makeRequestDatabase(databaseLayer(envWith), Database, scope);
    expect(Predicate.isFunction(db.execute)).toBe(true);
    await expect(Effect.runPromise(Scope.close(scope, Exit.void))).resolves.toBeUndefined();
  });

  it("rejects immediately on the Promise path, instead of hanging, when HYPERDRIVE is absent (#1978)", async () => {
    // `proxyChain` answers `then` with another chain step, which the Promise
    // machinery would adopt as a never-settling thenable; `withoutThen`
    // makes it reject with the deferred SqlError instead.
    const scope = Scope.makeUnsafe();
    await expect(
      makeRequestDatabase(databaseLayer(envWithout), Database, scope),
    ).rejects.toMatchObject({ _tag: "SqlError" });
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});

/**
 * The real composition, gated on the unpublished peer: `pgClientFromPool`
 * + `makePgDatabase` from `@thomasfosterau/effect-drizzle-ext-pg`, over the
 * stub binding. A variable specifier keeps the runner from resolving the
 * bare name at transform time; it resolves (or not) at run time.
 */
interface DrizzleExtPg {
  readonly pgClientFromPool: (options: {
    readonly connectionString: Redacted.Redacted<string>;
  }) => Layer.Layer<unknown, unknown>;
  readonly makePgDatabase: (options: { readonly relations: unknown; readonly key: string }) => {
    readonly layer: Layer.Layer<unknown, never, unknown>;
  };
}
const specifier = "@thomasfosterau/effect-drizzle-ext-pg";
const drizzleExtPg: Option.Option<DrizzleExtPg> = await import(/* @vite-ignore */ specifier)
  // SAFETY: the module's shape is asserted by the composition below, which
  // only runs when it resolved.
  .then((module: unknown) => Option.some(module as DrizzleExtPg))
  .catch(() => Option.none<DrizzleExtPg>());

describe("with @thomasfosterau/effect-drizzle-ext-pg", () => {
  it.skipIf(Option.isNone(drizzleExtPg))(
    "composes pgClientFromPool + makePgDatabase over the stub binding without connecting",
    async () => {
      const ext = Option.getOrThrow(drizzleExtPg);
      const layer = hyperdriveDatabaseLayer({
        connection: PrimaryHyperdrive,
        tag: Database,
        client: (url) => ext.pgClientFromPool({ connectionString: url }),
        // SAFETY: `makePgDatabase(...).layer` installs the `Database` key it
        // was given; the fake tag here shares that key.
        database: ext.makePgDatabase({ relations: {}, key: "Database" }).layer as Layer.Layer<
          Database,
          never,
          unknown
        >,
      }).pipe(
        Layer.provide(runtime.bind(Cloudflare.Hyperdrive.ConnectBinding, envWith)),
        Layer.provide(runtime.scaffoldFor(envWith)),
      );
      const scope = Scope.makeUnsafe();
      const db = await makeRequestDatabase(
        // SAFETY: the requirements left are the client's own, provided above.
        layer as Layer.Layer<Database>,
        Database,
        scope,
      );
      expect(Predicate.isFunction(db.execute)).toBe(true);
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  );
});
