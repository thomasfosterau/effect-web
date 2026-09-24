/**
 * `@thomasfosterau/effect-web-cloudflare/robots` — the KV adapter for
 * `@thomasfosterau/effect-web-robots`' per-origin cache: what the
 * applications' crawlers keep in their `Robots` KV namespace
 * (`packages/jobs/src/web-archive/robots.ts`, `crawl/robots.ts`), with the
 * same degrade posture — a KV read fault is a miss, a KV write fault is a
 * dropped write, and neither is a failed decision.
 *
 * @since 0.1.0
 */
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { RobotsCache } from "@thomasfosterau/effect-web-robots";

/**
 * A {@link RobotsCache} over a KV namespace declaration
 * (`Cloudflare.KV.Namespace("Robots")`): `get` reads the origin's entry as
 * text, `put` writes it with the TTL as `expirationTtl`. The binding client
 * (`KV.ReadWriteNamespaceBinding`, bound through the runtime scaffold) and
 * `RuntimeContext` are the requirements the checker carries; a `NamespaceError`
 * on either side degrades rather than fails.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import * as Option from "effect/Option"
 * import { makeWorkerRuntime } from "@thomasfosterau/effect-web-cloudflare"
 * import { robotsKvCache } from "@thomasfosterau/effect-web-cloudflare/robots"
 * import { makeStubKv } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const Robots = Cloudflare.KV.Namespace("Robots")
 * const kv = makeStubKv()
 * const env = { Robots: kv.namespace }
 * const runtime = makeWorkerRuntime({ logicalId: "Pipeline" })
 * const layer = Layer.merge(runtime.requestLayer({ env }), runtime.bindAll(env, Cloudflare.KV.ReadWriteNamespaceBinding))
 * const cache = robotsKvCache(Robots)
 * const got = await Effect.runPromise(
 *   Effect.gen(function* () {
 *     yield* cache.put("https://origin.example", "User-agent: *\nDisallow: /", 60)
 *     return yield* cache.get("https://origin.example")
 *   }).pipe(Effect.provide(layer)) as Effect.Effect<Option.Option<string>, never, never>,
 * )
 * got // Option.some("User-agent: *\nDisallow: /")
 * kv.peekTtl("https://origin.example") // Option.some(60)
 * ```
 *
 * @since 0.1.0
 * @category caches
 */
export const robotsKvCache = (
  namespace: unknown,
): RobotsCache<Cloudflare.KV.ReadWriteNamespace | RuntimeContext> => {
  // SAFETY: the deploy-time declaration (`Effect<Namespace, never, Providers>`)
  // is relabelled as the concrete `Namespace` overload of the binding; at
  // runtime the stub `Stack` resolves the resource and the providers are
  // never used (see `resolveKvNamespace`).
  const client = Cloudflare.KV.ReadWriteNamespace(namespace as Cloudflare.KV.Namespace);
  return {
    get: (origin) =>
      Effect.flatMap(client, (kv) => kv.get(origin, "text")).pipe(
        Effect.map(Option.fromNullishOr),
        // A KV read fault is a miss: the checker fetches instead.
        Effect.orElseSucceed(() => Option.none<string>()),
      ),
    put: (origin, value, ttlSeconds) =>
      Effect.flatMap(client, (kv) => kv.put(origin, value, { expirationTtl: ttlSeconds })).pipe(
        // A KV write fault drops the cache write, never the decision.
        Effect.ignore,
      ),
  };
};
