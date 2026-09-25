/**
 * Unit tests for `./alchemy`: the settings layer, the API client's
 * not-configured guard and error mapping over an injected `fetch`, the
 * not-found predicates, and — the acceptance criterion — that `providers()`
 * builds a `Providers` collection registering all four PostHog resource
 * types without a credential (no PostHog call is made at layer build).
 */

/* oxlint-disable effect/effect-run-in-body */

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  createPostHogApi,
  Dashboard,
  Environment,
  FeatureFlag,
  fromEnvironment,
  isNotFoundError,
  MAX_ERROR_BODY_CHARS,
  PostHogApiError,
  PostHogApiNotConfiguredError,
  PostHogConfig,
  PostHogUnexpectedError,
  providers,
  Providers,
  Survey,
  withMissingAsUndefined,
} from "@thomasfosterau/effect-web-posthog/alchemy";

const configured = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fromEnvironment", () => {
  it("reads POSTHOG_HOST and POSTHOG_API_KEY, folding a blank key to None", async () => {
    const settings = await Effect.runPromise(
      PostHogConfig.pipe(
        Effect.provide(fromEnvironment),
        Effect.provide(configured({ POSTHOG_HOST: "https://eu.posthog.com", POSTHOG_API_KEY: "" })),
      ),
    );
    expect(settings).toEqual({ baseUrl: "https://eu.posthog.com", apiKey: Option.none() });
  });

  it("defaults the host to the SDK's base URL and carries a present key", async () => {
    const settings = await Effect.runPromise(
      PostHogConfig.pipe(
        Effect.provide(fromEnvironment),
        Effect.provide(configured({ POSTHOG_API_KEY: "phx_key" })),
      ),
    );
    expect(settings.baseUrl).toBe("https://us.posthog.com");
    expect(settings.apiKey).toEqual(Option.some("phx_key"));
  });
});

describe("createPostHogApi", () => {
  it("fails every operation with PostHogApiNotConfiguredError when no key is set, without a request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const api = createPostHogApi({ baseUrl: "https://eu.posthog.com", apiKey: Option.none() });
    const exits = await Promise.all([
      Effect.runPromiseExit(api.getEnvironment({ projectId: "1", environmentId: 2 })),
      Effect.runPromiseExit(api.getDashboard({ projectId: "1", id: 2 })),
      Effect.runPromiseExit(api.getFeatureFlag({ projectId: "1", id: 2 })),
      Effect.runPromiseExit(api.getSurvey({ projectId: "1", id: "s" })),
    ]);
    for (const exit of exits) {
      expect(exit._tag).toBe("Failure");
      expect(String(exit)).toContain("PostHogApiNotConfiguredError");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("GETs the environment with a bearer token and parses the record", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 2, project_id: 1, name: "prod", api_token: "phc" }), {
          status: 200,
        }),
    );
    const api = createPostHogApi({ baseUrl: "https://eu.posthog.com", apiKey: Option.some("phx") });
    const record = await Effect.runPromise(
      api.getEnvironment({ projectId: "1", environmentId: 2 }),
    );
    expect(record).toMatchObject({ id: 2, name: "prod", api_token: "phc" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://eu.posthog.com/api/projects/1/environments/2/");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer phx");
  });

  it("maps a non-2xx response to PostHogApiError with a truncated body (SEC-SECRET-002)", async () => {
    // A fresh `Response` per call: a body can be read once.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("x".repeat(MAX_ERROR_BODY_CHARS + 50), { status: 404 }),
    );
    const api = createPostHogApi({ baseUrl: "https://eu.posthog.com", apiKey: Option.some("phx") });
    const exit = await Effect.runPromiseExit(
      api.getEnvironment({ projectId: "1", environmentId: 2 }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit) ? exit.cause : undefined;
    expect(String(error)).toContain(
      "PostHog API GET /api/projects/1/environments/2/ failed with 404",
    );
    // And the read path treats that 404 as absent.
    const absent = await Effect.runPromise(
      withMissingAsUndefined(api.getEnvironment({ projectId: "1", environmentId: 2 })),
    );
    expect(absent).toBeUndefined();
  });

  it("wraps a network failure as PostHogUnexpectedError, preserving the cause", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const api = createPostHogApi({ baseUrl: "https://eu.posthog.com", apiKey: Option.some("phx") });
    const exit = await Effect.runPromiseExit(
      api.getEnvironment({ projectId: "1", environmentId: 2 }),
    );
    expect(String(exit)).toContain("PostHogUnexpectedError");
    expect(String(exit)).toContain("fetch failed");
  });
});

describe("the errors", () => {
  it("are tagged, carry their fields, and isNotFoundError keys on the 404 status", () => {
    const notFound = new PostHogApiError({ status: 404, method: "GET", path: "/x", body: "" });
    expect(notFound._tag).toBe("PostHogApiError");
    expect(notFound.message).toBe("PostHog API GET /x failed with 404");
    expect(isNotFoundError(notFound)).toBe(true);
    expect(
      isNotFoundError(new PostHogApiError({ status: 500, method: "GET", path: "/x", body: "" })),
    ).toBe(false);
    expect(isNotFoundError(new Error("404"))).toBe(false);
    expect(new PostHogApiNotConfiguredError().message).toContain("POSTHOG_API_KEY");
    expect(new PostHogUnexpectedError({ cause: "why" }).message).toContain("why");
  });
});

describe("providers()", () => {
  it("builds the PostHog collection registering all four resource types, without a credential", async () => {
    const collection = await Effect.runPromise(
      Providers.pipe(Effect.provide(providers()), Effect.provide(configured({}))),
    );
    for (const type of [Environment.Type, Dashboard.Type, FeatureFlag.Type, Survey.Type]) {
      expect(collection.get(type)).toBeDefined();
    }
    expect([Environment.Type, Dashboard.Type, FeatureFlag.Type, Survey.Type]).toEqual([
      "PostHog.Environment",
      "PostHog.Dashboard",
      "PostHog.FeatureFlag",
      "PostHog.Survey",
    ]);
  });

  it("is a thunk returning a Layer, like every alchemy provider package", () => {
    expect(Layer.isLayer(providers())).toBe(true);
  });
});
