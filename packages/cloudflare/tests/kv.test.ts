/**
 * Unit tests for `resolveKvNamespace` — gardeneria's `resolveNodesKv`
 * (`apps/api/src/cache.ts`): the raw namespace when the binding is present,
 * `None` when it is not, never a failure.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { makeWorkerRuntime, resolveKvNamespace } from "@thomasfosterau/effect-web-cloudflare";

const Cache = Cloudflare.KV.Namespace("Cache");
const runtime = makeWorkerRuntime({ logicalId: "App" });

const resolve = (env: Readonly<Record<string, unknown>>) =>
  Effect.runPromise(
    resolveKvNamespace(Cache).pipe(
      Effect.provide(
        Layer.merge(
          runtime.requestLayer({ env }),
          runtime.bindAll(env, Cloudflare.KV.ReadWriteNamespaceBinding),
        ),
      ),
    ) as Effect.Effect<Option.Option<unknown>, never, never>,
  );

describe("resolveKvNamespace", () => {
  it("resolves the raw namespace object behind env[LogicalId]", async () => {
    const stub = { get: async () => null, put: async () => {}, delete: async () => {} };
    const got = await resolve({ Cache: stub });
    expect(Option.getOrUndefined(got)).toBe(stub);
  });

  it("degrades to None when the Worker never declared the binding", async () => {
    const got = await resolve({});
    expect(Option.isNone(got)).toBe(true);
  });
});
