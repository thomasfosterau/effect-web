/**
 * The KV read-through resource cache (PERF-CACHE-004), ported from
 * gardeneria's `apps/api/src/cache.ts` (the reference: website's copy lacks
 * the owned / publication axes, and gardeneria's is the multi-tenant one).
 * Serialised JSON:API resources keyed by `type:id`; reads validate against
 * an Effect Schema and a stale entry (a schema change) is deleted and read
 * as a miss so the caller falls through to the database.
 *
 * Two things are injected that the application hard-coded:
 *
 * - **the KV binding** — `resolveKv`, an Effect yielding the raw namespace
 *   or `None` (`resolveKvNamespace(Cache)` from the root entry, over the
 *   app's own `Cache` declaration);
 * - **the serveability policy** — the pure gate that decides whether a
 *   cached resource may be served to, or written for, the read-through
 *   audience. {@link isPubliclyServeable} with gardeneria's
 *   `{ owned, publishGated }` posture is the exported default; an
 *   application with a different publication model passes its own
 *   predicate.
 *
 * The **freshness** bypass (a viewer who reads the DB directly because the
 * cache cannot be fresh for them — the owner, a moderator) is the third
 * seam: `bypass`, an Effect over whatever viewer service the application
 * has. It is a routing decision, not a security check (#1215).
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { KvNamespaceLike } from "../kv.ts";

/**
 * KV resource-cache TTL backstop (seconds). Write-time invalidation keeps
 * the cache consistent on the happy path; this TTL is the self-healing
 * backstop so a missed invalidation (best-effort KV writes can fail) cannot
 * pin a stale resource indefinitely (PERF-CACHE-004).
 *
 * @since 0.1.0
 * @category constants
 */
export const RESOURCE_CACHE_TTL = 3600;

/**
 * Cloudflare KV's floor for `expirationTtl`, and therefore the tightest
 * staleness window a family can ask for; `ttlSeconds` clamps up to it.
 *
 * @since 0.1.0
 * @category constants
 */
export const MIN_RESOURCE_CACHE_TTL = 60;

/**
 * The posture flags {@link isPubliclyServeable} takes — gardeneria's
 * `CacheOptions`, minus the TTL.
 *
 * @since 0.1.0
 * @category models
 */
export interface ServeabilityOptions {
  /**
   * Whether the family's rows are **owned** — carrying an `owner_id` and the
   * three-state `visibility` axis (#1096) rather than being reference data
   * gated by role alone. Sets the posture on a MISSING `visibility`
   * attribute, and nothing else: for reference data, absence means "does not
   * ride that axis"; for an owned family it can only mean the projection
   * dropped the attribute that decides who may see the row, and reading that
   * as public is how a private row would reach the cache. An owned family
   * whose resource lacks `visibility` therefore caches **nothing** — a
   * visible performance regression instead of a silent leak.
   */
  readonly owned?: boolean | undefined;
  /**
   * Whether the family's read gate is the **publication stamp** —
   * `publishedAt` present AND arrived — rather than a `visibility` or
   * `draft` attribute (#1096). With it, a missing stamp refuses and a future
   * stamp refuses; the second is time-dependent, so a resource cached a
   * minute before its stamp arrives is refused on that read and cached on
   * the next, the stamp behaving as a natural expiry.
   */
  readonly publishGated?: boolean | undefined;
}

/**
 * Whether a serialised `publishedAt` names an instant that has arrived — the
 * cache-side reading of `published_at IS NOT NULL AND published_at <=
 * now()`. Conservative on shape as well as on time: the value crosses KV as
 * JSON, so it arrives as a string rather than a `Date`, and anything that
 * does not parse to a finite instant is refused rather than guessed at.
 */
const hasArrivedStamp = (publishedAt: unknown): boolean => {
  if (publishedAt === undefined || publishedAt === null) return false;
  const instant = Predicate.isDate(publishedAt)
    ? publishedAt.getTime()
    : Predicate.isString(publishedAt)
      ? // oxlint-disable-next-line effect/use-clock-service -- a parse of the serialised stamp, not a read of the clock.
        Date.parse(publishedAt)
      : Number.NaN;
  // oxlint-disable-next-line effect/use-clock-service -- the gate is a synchronous predicate applied inside plain `Promise` KV reads, where no `Clock` service is in scope; the applications read wall-clock time here too, and the stamp behaves as a natural expiry (see `publishGated`).
  return Number.isFinite(instant) && instant <= Date.now();
};

/**
 * Whether a cached resource may be served from KV to a viewer who reaches
 * the read-through gate at all — the security gate of the read-through
 * path (PERF-CACHE-004 / CACHE-AUTH-005). KV is populated by mutations, so
 * it CAN hold a `private` resource, or a `pending` comment the instant a
 * non-admin submits one; serving either to an anonymous viewer would leak
 * unpublished material. This predicate rejects them, forcing a DB
 * fall-through where the operation's own gate returns `NotFound`.
 *
 * **The rule: every publication axis the operation-layer read gates on must
 * be present in the cached attributes AND pass.** Each axis is checked when
 * the attribute is present; absence means the resource does not ride that
 * axis at all (unless `owned` / `publishGated` say otherwise):
 *
 * - `visibility` — only `"public"` is serveable; absent refuses when `owned`.
 * - `moderationState` — only `"approved"` is serveable.
 * - `draft` — `true` refuses (a wiki article's draft state IS a gate).
 * - `deletedAt` — present only on a tombstone, which is admin-only; a delete
 *   already evicts the key, so this is defence in depth.
 * - `publishedAt` — when `publishGated`, must be present AND arrived.
 *
 * What it structurally cannot express: a gate that depends on state living
 * outside the cached resource (a comment unreadable once its target goes
 * private). Such a family closes it on the WRITE path (the target's own
 * mutation evicts its dependants' keys) and cuts its TTL to the floor.
 *
 * Deliberately conservative: a present axis whose value is not exactly the
 * serveable literal — `null`, `""`, an unknown state a schema change
 * introduces — is non-serveable.
 *
 * @example
 * ```ts
 * import { isPubliclyServeable } from "@thomasfosterau/effect-web-cloudflare/cache"
 *
 * isPubliclyServeable({ attributes: { visibility: "public" } }) // true
 * isPubliclyServeable({ attributes: { visibility: "private" } }) // false
 * isPubliclyServeable({ attributes: { name: "Ada" } }, { owned: true }) // false — visibility missing
 * isPubliclyServeable({ attributes: { title: "Draft" } }, { publishGated: true }) // false — no stamp
 * ```
 *
 * @since 0.1.0
 * @category policy
 */
export const isPubliclyServeable = (
  resource: unknown,
  options: ServeabilityOptions = {},
): boolean => {
  if (!Predicate.isObjectOrArray(resource)) return false;
  // SAFETY: a structural read of the one key the gate inspects; every value
  // is re-checked below before anything is decided on it.
  const attributes = (resource as { readonly attributes?: unknown }).attributes;
  // No attributes block to inspect — refuse rather than guess.
  if (!Predicate.isObjectOrArray(attributes)) return false;
  // SAFETY: same — each axis is read as `unknown` and compared to its one
  // serveable literal.
  const { visibility, moderationState, deletedAt, draft, publishedAt } = attributes as {
    readonly visibility?: unknown;
    readonly moderationState?: unknown;
    readonly deletedAt?: unknown;
    readonly draft?: unknown;
    readonly publishedAt?: unknown;
  };
  // The owned-family inversion (#1096).
  if (options.owned === true && visibility === undefined) return false;
  // The publication axis (#1096): stamped AND arrived.
  if (options.publishGated === true && !hasArrivedStamp(publishedAt)) return false;
  if (visibility !== undefined && visibility !== "public") return false;
  if (moderationState !== undefined && moderationState !== "approved") return false;
  if (draft === true) return false;
  // A tombstone is an admin-only read, and it is never `undefined`-valued
  // when present (#691: emitters omit the key entirely while live).
  if (deletedAt !== undefined) return false;
  return true;
};

/**
 * A serveability policy: the pure gate {@link makeResourceCache} applies on
 * BOTH the serve-a-hit and populate-on-miss sites, so a family cannot be
 * strict on one and lax on the other.
 *
 * @since 0.1.0
 * @category models
 */
export type Serveable = (resource: unknown) => boolean;

/**
 * What one application's cache factory is built from.
 *
 * @since 0.1.0
 * @category models
 */
export interface ResourceCacheConfig<RKv> {
  /**
   * Resolves the per-request KV namespace, or `None` when it is unavailable
   * (build time, a misconfigured environment, a binding fault) — a `None`
   * degrades every operation to a no-op or a plain DB read. Must not fail:
   * a resolver that can is `Effect.orElseSucceed`d to `None` by the caller.
   */
  readonly resolveKv: Effect.Effect<Option.Option<KvNamespaceLike>, never, RKv>;
  /**
   * The TTL backstop a family gets when it asks for none. Defaults to
   * {@link RESOURCE_CACHE_TTL}.
   */
  readonly defaultTtlSeconds?: number | undefined;
}

/**
 * Per-family options for {@link ResourceCacheFactory}.
 *
 * @since 0.1.0
 * @category models
 */
export interface ResourceCacheOptions<RBypass> extends ServeabilityOptions {
  /**
   * TTL backstop for this family's entries, in seconds; clamped up to
   * {@link MIN_RESOURCE_CACHE_TTL}. Lower it for a family whose readability
   * depends on state the cached resource does not carry, so the predicate
   * cannot re-check it on a hit: the TTL is then the only bound on how long
   * a hit can outlive the gate that justified caching it. A **security**
   * knob, not a tuning one.
   */
  readonly ttlSeconds?: number | undefined;
  /**
   * The serveability policy. Defaults to {@link isPubliclyServeable} with
   * this family's `owned` / `publishGated` posture.
   */
  readonly serveable?: Serveable | undefined;
  /**
   * The **freshness** bypass: `true` for a viewer who must read the DB
   * directly because the cache cannot be fresh for them (they can see
   * private or soft-deleted rows, the latest version). A routing decision,
   * not a security check — it exists because the cache cannot be fresh for
   * such a viewer, not because serving them a hit would leak anything
   * (#1215). Defaults to never bypassing.
   */
  readonly bypass?: Effect.Effect<boolean, never, RBypass> | undefined;
}

/**
 * A typed cache handle for one resource family.
 *
 * @since 0.1.0
 * @category models
 */
export interface ResourceCache<T, RKv, RBypass> {
  /** The family's `type` (the key prefix). */
  readonly type: string;
  /** The TTL each write carries, after clamping. */
  readonly ttlSeconds: number;
  /** The policy both gate sites apply. */
  readonly serveable: Serveable;
  /** `type:id`. */
  readonly key: (id: string) => string;
  /** Reads a cached resource, or `None` (and the key deleted) if the entry is missing or fails schema validation. */
  readonly get: (kv: KvNamespaceLike, id: string) => Promise<Option.Option<T>>;
  /** Writes a resource as JSON with the TTL backstop. */
  readonly set: (kv: KvNamespaceLike, id: string, data: T) => Promise<void>;
  /** Deletes a cached resource. */
  readonly delete: (kv: KvNamespaceLike, id: string) => Promise<void>;
  /**
   * Best-effort write-through to the per-request KV binding. Resolves the
   * binding, no-ops when unavailable, swallows any error so the underlying
   * mutation result still surfaces. Gated on the SAME predicate as the read
   * (#1096): a non-serveable resource DELETES rather than skips, because
   * this is the update path and the row may have just been flipped
   * `public` → `private`, so a skipped write would leave the previous
   * public snapshot live until its TTL.
   */
  readonly setOnKv: (id: string, data: T) => Effect.Effect<void, never, RKv>;
  /** Best-effort delete from the per-request KV binding; same semantics as `setOnKv`. */
  readonly deleteOnKv: (id: string) => Effect.Effect<void, never, RKv>;
  /**
   * Read-through the KV cache before the database (PERF-CACHE-004). A viewer
   * the `bypass` names reads `dbGet` directly (freshness). For every other
   * viewer a KV hit is served only when it passes `serveable` (security); a
   * rejected or absent entry falls through to `dbGet`, whose own viewer-aware
   * gate returns `NotFound` for a row this viewer may not read. A DB read
   * populates KV with the TTL backstop only when the resolved resource is
   * itself serveable. KV faults are non-fatal: any error resolving or
   * reading the binding degrades to a plain `dbGet`.
   */
  readonly readThrough: <E, R>(
    id: string,
    dbGet: Effect.Effect<T, E, R>,
  ) => Effect.Effect<T, E, R | RKv | RBypass>;
}

/**
 * One application's cache factory — see {@link makeResourceCache}.
 *
 * @since 0.1.0
 * @category models
 */
export type ResourceCacheFactory<RKv> = <
  S extends Schema.ConstraintDecoder<unknown>,
  RBypass = never,
>(
  schema: S,
  type: string,
  options?: ResourceCacheOptions<RBypass>,
) => ResourceCache<S["Type"], RKv, RBypass>;

/**
 * The KV value encoder — `Schema.fromJsonString(Schema.Unknown)` in the encode
 * direction (value → JSON text), byte-identical to `JSON.stringify` (same
 * `undefined`-dropping, same key order), so cached bytes and therefore cache
 * hits are unchanged from the applications'.
 */
const encodeJsonValue = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * Builds an application's cache factory over its KV resolver. Each factory
 * call creates a typed handle for one resource family, pre-bound to its
 * schema and `type`.
 *
 * Decoders are cached per schema per isolate (a `WeakMap`), so a read never
 * rebuilds one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Schema from "effect/Schema"
 * import { makeResourceCache } from "@thomasfosterau/effect-web-cloudflare/cache"
 *
 * const store = new Map<string, string>()
 * const kv = {
 *   get: async (key: string) => { const v = store.get(key); return v === undefined ? null : JSON.parse(v) },
 *   put: async (key: string, value: string) => { store.set(key, value) },
 *   delete: async (key: string) => { store.delete(key) },
 * }
 * const createCache = makeResourceCache({ resolveKv: Effect.succeed(Option.some(kv)) })
 * const Post = Schema.Struct({ id: Schema.String, attributes: Schema.Struct({ visibility: Schema.String }) })
 * const posts = createCache(Post, "posts", { owned: true })
 *
 * let dbReads = 0
 * const dbGet = Effect.sync(() => { dbReads += 1; return { id: "p1", attributes: { visibility: "public" } } })
 * await Effect.runPromise(posts.readThrough("p1", dbGet)) // miss → DB, populated
 * await Effect.runPromise(posts.readThrough("p1", dbGet)) // hit
 * dbReads // 1
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeResourceCache = <RKv = never>(
  config: ResourceCacheConfig<RKv>,
): ResourceCacheFactory<RKv> => {
  const decoders = new WeakMap<
    Schema.ConstraintDecoder<unknown>,
    (input: unknown) => Exit.Exit<unknown, Schema.SchemaError>
  >();
  const decoderFor = (schema: Schema.ConstraintDecoder<unknown>) => {
    const cached = decoders.get(schema);
    if (cached !== undefined) return cached;
    const decoder = Schema.decodeUnknownExit(schema);
    decoders.set(schema, decoder);
    return decoder;
  };
  const defaultTtl = config.defaultTtlSeconds ?? RESOURCE_CACHE_TTL;

  return <S extends Schema.ConstraintDecoder<unknown>, RBypass = never>(
    schema: S,
    type: string,
    options: ResourceCacheOptions<RBypass> = {},
  ): ResourceCache<S["Type"], RKv, RBypass> => {
    type T = S["Type"];
    const ttlSeconds = Math.max(options.ttlSeconds ?? defaultTtl, MIN_RESOURCE_CACHE_TTL);
    const serveable: Serveable =
      options.serveable ??
      ((resource) =>
        isPubliclyServeable(resource, {
          owned: options.owned === true,
          publishGated: options.publishGated === true,
        }));
    const bypass: Effect.Effect<boolean, never, RBypass> = options.bypass ?? Effect.succeed(false);
    const key = (id: string) => `${type}:${id}`;
    const decode = decoderFor(schema);

    const get = async (kv: KvNamespaceLike, id: string): Promise<Option.Option<T>> => {
      // `KVNamespace.get` resolves `null` for a key that isn't there — the
      // platform seam this `Option` return exists to close.
      const cached = await kv.get(key(id), { type: "json" });
      if (cached === null) return Option.none();
      const parsed = decode(cached);
      if (Exit.isSuccess(parsed)) {
        // SAFETY: the decoder is built from `schema`, so a success IS `S["Type"]`; the `WeakMap` erases that link.
        return Option.some(parsed.value as T);
      }
      await kv.delete(key(id));
      return Option.none();
    };
    const set = (kv: KvNamespaceLike, id: string, data: T): Promise<void> =>
      kv.put(key(id), encodeJsonValue(data), { expirationTtl: ttlSeconds });
    const del = (kv: KvNamespaceLike, id: string): Promise<void> => kv.delete(key(id));

    // `tryPromise`, not `promise`: a KV operational fault rejects, and a
    // rejection must land in the recoverable error channel so `Effect.ignore`
    // swallows it. `Effect.promise` would route it to the defect channel,
    // which `ignore` does NOT catch — failing the whole mutation on a
    // best-effort cache write.
    const setOnKv = (id: string, data: T): Effect.Effect<void, never, RKv> =>
      Effect.ignore(
        Effect.gen(function* () {
          const kv = yield* config.resolveKv;
          if (Option.isSome(kv)) {
            yield* Effect.tryPromise(() =>
              serveable(data) ? set(kv.value, id, data) : del(kv.value, id),
            );
          }
        }),
      );
    const deleteOnKv = (id: string): Effect.Effect<void, never, RKv> =>
      Effect.ignore(
        Effect.gen(function* () {
          const kv = yield* config.resolveKv;
          if (Option.isSome(kv)) yield* Effect.tryPromise(() => del(kv.value, id));
        }),
      );

    const readThrough = <E, R>(
      id: string,
      dbGet: Effect.Effect<T, E, R>,
    ): Effect.Effect<T, E, R | RKv | RBypass> =>
      Effect.gen(function* () {
        if (yield* bypass) return yield* dbGet;
        const kv = yield* config.resolveKv;
        if (Option.isSome(kv)) {
          // A KV read fault (operational, or a malformed stored value that
          // makes `get({ type: "json" })` reject) is a recoverable error
          // `orElseSucceed` turns into a miss — a KV outage degrades to `dbGet`.
          const cached = yield* Effect.orElseSucceed(
            Effect.tryPromise(() => get(kv.value, id)),
            () => Option.none<T>(),
          );
          if (Option.isSome(cached) && serveable(cached.value)) return cached.value;
        }
        // Miss (or non-serveable / KV unavailable): read the DB. Its own
        // visibility gate guarantees a viewer who reaches this point only
        // receives a live, public resource here.
        const resource = yield* dbGet;
        // Populate only for genuinely serveable resources, best-effort.
        if (Option.isSome(kv) && serveable(resource)) {
          yield* Effect.ignore(Effect.tryPromise(() => set(kv.value, id, resource)));
        }
        return resource;
      });

    return {
      type,
      ttlSeconds,
      serveable,
      key,
      get,
      set,
      delete: del,
      setOnKv,
      deleteOnKv,
      readThrough,
    };
  };
};
