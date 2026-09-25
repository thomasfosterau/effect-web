/**
 * Type-level tests: the expect-error directives are the assertions, checked
 * by tsconfig.test.json (which resolves the package name to `src/`). Every
 * binding is exported so an unused-local error can never stand in for the
 * assertion a directive expects.
 */
import type { RuntimeContext } from "alchemy";
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import {
  countingDatabase,
  makeWorkerRuntime,
  resolveKvNamespace,
  workerEnv,
} from "@thomasfosterau/effect-web-cloudflare";
import { makeResourceCache } from "@thomasfosterau/effect-web-cloudflare/cache";
import { hyperdriveDatabaseLayer } from "@thomasfosterau/effect-web-cloudflare/hyperdrive";
import { consumeBatch, type MissingHyperdrive } from "@thomasfosterau/effect-web-cloudflare/queues";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

const runtime = makeWorkerRuntime({ logicalId: "App" });

// The request layer needs nothing from the outside: it IS the base.
export const request = runtime.requestLayer({ env: {} });
export type RequestRequirements = Assert<Equals<Layer.Services<typeof request>, never>>;
export type RequestError = Assert<Equals<Layer.Error<typeof request>, never>>;

// `bind` drops the deploy-time tags: a bound client layer has no requirements.
export const bound = runtime.bind(
  {} as Layer.Layer<Cloudflare.KV.ReadWriteNamespace, never, Cloudflare.WorkerEnvironment>,
  {},
);
export type BoundRequirements = Assert<Equals<Layer.Services<typeof bound>, never>>;

// `workerEnv` narrows to the caller's type and requires only the environment.
interface Env {
  readonly Cache: unknown;
}
export const env = workerEnv<Env>();
export type EnvSuccess = Assert<Equals<Effect.Success<typeof env>, Env>>;
export type EnvServices = Assert<Equals<Effect.Services<typeof env>, Cloudflare.WorkerEnvironment>>;

// The KV resolver never fails and names its two runtime services.
export const kv = resolveKvNamespace({});
export type KvError = Assert<Equals<Effect.Error<typeof kv>, never>>;
export type KvServices = Assert<
  Equals<Effect.Services<typeof kv>, Cloudflare.KV.ReadWriteNamespace | RuntimeContext>
>;

// `countingDatabase` preserves the client's own type.
class Db {
  select() {
    return ["row"];
  }
}
export const counted = countingDatabase(new Db());
export type Counted = Assert<Equals<typeof counted, Db>>;

// The hyperdrive layer carries the injected client factory's error type.
class PgClient extends Context.Service<PgClient, string>()("PgClient") {}
class Database extends Context.Service<Database, { readonly q: string }>()("Database") {}
class PoolDown extends Schema.TaggedError<PoolDown>()("PoolDown", {}) {}
export const database = hyperdriveDatabaseLayer({
  connection: {},
  tag: Database,
  client: () => ({}) as Layer.Layer<PgClient, PoolDown>,
  database: {} as Layer.Layer<Database, never, PgClient>,
});
export type DatabaseError = Assert<Equals<Layer.Error<typeof database>, PoolDown>>;
export type DatabaseSuccess = Assert<Equals<Layer.Success<typeof database>, Database>>;

// The consumer prelude adds MissingHyperdrive to the handler's own failures.
export const consumed = consumeBatch(
  {} as Stream.Stream<Cloudflare.Queues.Message>,
  (): Effect.Effect<void, "boom"> => Effect.void,
  { env: workerEnv<Env>() },
);
export type ConsumedError = Assert<
  Equals<Effect.Error<typeof consumed>, "boom" | MissingHyperdrive>
>;
export type ConsumedServices = Assert<
  Equals<Effect.Services<typeof consumed>, Cloudflare.WorkerEnvironment>
>;

// The cache factory threads the KV resolver's services and the bypass's.
class Viewer extends Context.Service<Viewer, { readonly admin: boolean }>()("Viewer") {}
const Post = Schema.Struct({ id: Schema.String });
export const createCache = makeResourceCache({
  resolveKv: Effect.succeed(Option.none()),
});
export const posts = createCache(Post, "posts", {
  bypass: Effect.map(Viewer, (viewer) => viewer.admin),
});
export const read = posts.readThrough("p1", Effect.succeed({ id: "p1" }));
export type ReadServices = Assert<Equals<Effect.Services<typeof read>, Viewer>>;
export type ReadSuccess = Assert<Equals<Effect.Success<typeof read>, { readonly id: string }>>;

// A `dbGet` of the wrong shape is rejected.
// @ts-expect-error — the DB read must yield the family's resource type.
export const wrong = posts.readThrough("p1", Effect.succeed({ id: 1 }));
