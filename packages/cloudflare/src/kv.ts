/**
 * Resolving a KV namespace binding to its raw runtime object — the seam the
 * `./cache` entry's `resolveKv` takes, kept here because it is the one
 * alchemy-dependent step of the cache (`Cloudflare.KV.ReadWriteNamespace(binding)`
 * → `client.raw`). Ported from `apps/api/src/cache.ts`'s `resolveNodesKv`.
 *
 * @since 0.1.0
 */
import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * The subset of the Workers `KVNamespace` runtime interface a JSON
 * read-through cache reaches. Structural, so the `./cache` entry needs no
 * `@cloudflare/workers-types`; the platform's `KVNamespace` satisfies it.
 *
 * @since 0.1.0
 * @category models
 */
export interface KvNamespaceLike {
  get(key: string, options: { readonly type: "json" }): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { readonly expirationTtl?: number | undefined },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Resolves a KV namespace's raw runtime object from the per-request binding
 * client, or `None` when it is unavailable — build time, a misconfigured
 * environment, a Worker without the binding (`client.raw` is `undefined`
 * then), or a binding fault. A `None` degrades the caller (a cache read /
 * write / delete) to a no-op or a plain DB read rather than failing.
 *
 * The deploy-time `Providers` requirement the binding declaration carries in
 * its type is dropped: a per-request runtime never provides a `Providers`
 * layer (a deploy-time concern) and the binding accepts either form at
 * runtime.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as Option from "effect/Option"
 * import { makeWorkerRuntime, resolveKvNamespace } from "@thomasfosterau/effect-web-cloudflare"
 *
 * const Cache = Cloudflare.KV.Namespace("Cache")
 * const runtime = makeWorkerRuntime({ logicalId: "Website" })
 * const stub = { get: async () => null, put: async () => {}, delete: async () => {} }
 * const layer = Layer.merge(
 *   runtime.requestLayer({ env: { Cache: stub } }),
 *   runtime.bindAll({ Cache: stub }, Cloudflare.KV.ReadWriteNamespaceBinding),
 * )
 * const kv = await Effect.runPromise(
 *   resolveKvNamespace(Cache).pipe(Effect.provide(layer)) as Effect.Effect<Option.Option<unknown>, never, never>,
 * )
 * Option.isSome(kv) // true
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const resolveKvNamespace = (
  namespace: unknown,
): Effect.Effect<
  Option.Option<KvNamespaceLike>,
  never,
  Cloudflare.KV.ReadWriteNamespace | RuntimeContext
> =>
  Effect.gen(function* () {
    // SAFETY: the deploy-time declaration (`Effect<Namespace, never, Providers>`)
    // is relabelled as the concrete `Namespace` overload of the binding; at
    // runtime the stub `Stack` resolves the resource and the providers are
    // never used (see the doc above).
    const client = yield* Cloudflare.KV.ReadWriteNamespace(namespace as Cloudflare.KV.Namespace);
    // SAFETY: `client.raw` is the Workers `KVNamespace`, `undefined` when the
    // namespace is unbound; the structural subset is what the cache reaches.
    const raw = (yield* client.raw) as KvNamespaceLike | undefined;
    return Option.fromNullishOr(raw);
  }).pipe(Effect.orElseSucceed(() => Option.none<KvNamespaceLike>()));
