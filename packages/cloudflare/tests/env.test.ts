/**
 * Unit tests for the env helpers: the `WorkerEnvironment` narrowing, the
 * string-entry projection and the `ConfigProvider` over it (website's
 * `packages/bindings/tests/runtime.test.ts`, the Config case).
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import {
  envStringEntries,
  workerEnv,
  workerEnvConfigProviderLayer,
} from "@thomasfosterau/effect-web-cloudflare";

interface PipelineEnv {
  readonly FEED_QUEUE: { readonly send: () => Promise<void> };
  readonly PUBLIC_SITE_URL: string;
}

const env = {
  FEED_QUEUE: { send: async () => {} },
  PUBLIC_SITE_URL: "https://stage.example",
  Cache: { get: async () => null },
  ALCHEMY_STAGE: "test",
};

describe("workerEnv", () => {
  it("returns the WorkerEnvironment value itself, narrowed to the caller's type", async () => {
    const got = await Effect.runPromise(
      workerEnv<PipelineEnv>().pipe(Effect.provideService(Cloudflare.WorkerEnvironment, env)),
    );
    expect(got).toBe(env);
    expect(got.PUBLIC_SITE_URL).toBe("https://stage.example");
  });
});

describe("envStringEntries", () => {
  it("keeps the string entries and drops the binding objects", () => {
    expect(envStringEntries(env)).toEqual({
      PUBLIC_SITE_URL: "https://stage.example",
      ALCHEMY_STAGE: "test",
    });
  });

  it("tolerates a missing env", () => {
    expect(envStringEntries(undefined)).toEqual({});
  });
});

describe("workerEnvConfigProviderLayer", () => {
  it("resolves Config reads from the env's string entries", async () => {
    const got = await Effect.runPromise(
      Config.String("PUBLIC_SITE_URL").pipe(Effect.provide(workerEnvConfigProviderLayer(env))),
    );
    expect(got).toBe("https://stage.example");
  });

  it("lets a missing value fall through to its withDefault", async () => {
    const got = await Effect.runPromise(
      Config.String("MISSING").pipe(
        Config.withDefault("fallback"),
        Effect.provide(workerEnvConfigProviderLayer(env)),
      ),
    );
    expect(got).toBe("fallback");
  });

  it("does not expose a binding object as a string", async () => {
    const exit = await Effect.runPromiseExit(
      Config.String("Cache").pipe(Effect.provide(workerEnvConfigProviderLayer(env))),
    );
    expect(exit._tag).toBe("Failure");
  });
});
