/**
 * The KV adapter for the robots cache, over the stub namespace through the
 * real alchemy client: a hit, a miss, the TTL on a write, and the degrade
 * posture on a KV fault.
 */

/* oxlint-disable effect/effect-run-in-body */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { makeWorkerRuntime } from "@thomasfosterau/effect-web-cloudflare";
import { robotsKvCache } from "@thomasfosterau/effect-web-cloudflare/robots";
import { makeStubKv } from "@thomasfosterau/effect-web-cloudflare/testing";

const Robots = Cloudflare.KV.Namespace("Robots");
const kv = makeStubKv();
const env = { Robots: kv.namespace };
const runtime = makeWorkerRuntime({ logicalId: "Pipeline" });
const layer = Layer.merge(
  runtime.requestLayer({ env }),
  runtime.bindAll(env, Cloudflare.KV.ReadWriteNamespaceBinding),
);
const cache = robotsKvCache(Robots);
const run = <A>(effect: Effect.Effect<A, never, unknown>) =>
  // SAFETY: the deploy-time provider tags are never used at runtime; the
  // scaffold satisfies everything the client reads.
  Effect.runPromise(effect.pipe(Effect.provide(layer)) as Effect.Effect<A, never, never>);

beforeEach(() => kv.reset());

describe("robotsKvCache", () => {
  it("misses on an empty namespace, then hits what put wrote, with the TTL", async () => {
    expect(await run(cache.get("https://origin.example"))).toEqual(Option.none());
    await run(cache.put("https://origin.example", "User-agent: *\nDisallow: /", 3600));
    expect(await run(cache.get("https://origin.example"))).toEqual(
      Option.some("User-agent: *\nDisallow: /"),
    );
    expect(kv.peekTtl("https://origin.example")).toEqual(Option.some(3600));
  });

  it("stores the sentinel values verbatim", async () => {
    await run(cache.put("https://origin.example", "", 60));
    expect(await run(cache.get("https://origin.example"))).toEqual(Option.some(""));
  });

  it("degrades a KV read fault to a miss", async () => {
    kv.seed("https://origin.example", "User-agent: *");
    kv.setGetFault(true);
    expect(await run(cache.get("https://origin.example"))).toEqual(Option.none());
  });

  it("degrades a missing binding to a miss and a dropped write", async () => {
    const bare = {};
    const unbound = Layer.merge(
      runtime.requestLayer({ env: bare }),
      runtime.bindAll(bare, Cloudflare.KV.ReadWriteNamespaceBinding),
    );
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        yield* cache.put("https://origin.example", "x", 60);
        return yield* cache.get("https://origin.example");
      }).pipe(Effect.provide(unbound)) as Effect.Effect<Option.Option<string>, never, never>,
    );
    expect(got).toEqual(Option.none());
  });
});
