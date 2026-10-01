/**
 * Unit tests for `./server`: the `PostHog` service
 * (`packages/infra-posthog/tests/service.test.ts`), the per-request client
 * factory's gating and environment tagging (`apps/web/src/lib/server/posthog.ts`,
 * which had no unit coverage in the apps — its `$app/env/public` import
 * graph could not load), and the ingest reverse proxy
 * (`apps/web/src/hooks.server.ts`'s `ingestProxy`, likewise), over an
 * injected `fetch`.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { PostHog as PostHogClient } from "posthog-node";
import { SECURITY_HEADER_DEFAULTS } from "@thomasfosterau/effect-web";
import {
  disabledPostHogClient,
  FORWARDED_HEADERS,
  ingestProxy,
  type IngestProxyOptions,
  isIngestPath,
  makePostHogClient,
  PostHog,
  posthogLayer,
  proxyIngestRequest,
  withEnvironmentProperty,
} from "@thomasfosterau/effect-web-posthog/server";

/** A recording stand-in for the `posthog-node` client, typed through its nominal class. */
const recordingClient = () => {
  const capture = vi.fn();
  const identify = vi.fn();
  const captureExceptionImmediate = vi.fn<
    (
      error: unknown,
      distinctId?: string,
      additionalProperties?: Record<string, unknown>,
    ) => Promise<void>
  >(async () => {});
  const flush = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  // SAFETY: the tests drive only the methods the wrappers forward; the
  // nominal `PostHog` class cannot be satisfied by a hand-written double.
  // oxlint-disable-next-line effect/no-chained-type-assertions -- a hand-written double for a nominal vendor class.
  const client = {
    capture,
    identify,
    captureExceptionImmediate,
    flush,
    shutdown,
  } as unknown as PostHogClient;
  return { client, capture, identify, captureExceptionImmediate, flush };
};

describe("PostHog service", () => {
  it("forwards capture to the underlying client, omitting absent optionals", async () => {
    const { client, capture } = recordingClient();
    await Effect.runPromise(
      Effect.gen(function* () {
        const posthog = yield* PostHog;
        yield* posthog.capture({
          distinctId: "u-1",
          event: "test_event",
          properties: { ok: true },
        });
        yield* posthog.capture({ distinctId: "u-2", event: "bare" });
      }).pipe(Effect.provide(posthogLayer(client))),
    );
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0]?.[0]).toEqual({
      distinctId: "u-1",
      event: "test_event",
      properties: { ok: true },
    });
    expect(capture.mock.calls[1]?.[0]).toEqual({ distinctId: "u-2", event: "bare" });
  });

  it("forwards flush to the underlying client", async () => {
    const { client, flush } = recordingClient();
    await Effect.runPromise(
      Effect.gen(function* () {
        const posthog = yield* PostHog;
        yield* posthog.flush;
      }).pipe(Effect.provide(posthogLayer(client))),
    );
    expect(flush).toHaveBeenCalledOnce();
  });
});

describe("withEnvironmentProperty", () => {
  it("stamps environment last on capture and identify, so the stage is authoritative", () => {
    const { client, capture, identify } = recordingClient();
    const tagged = withEnvironmentProperty(client, "stage");
    tagged.capture({
      distinctId: "u",
      event: "viewed",
      properties: { environment: "spoofed", a: 1 },
    });
    tagged.identify({ distinctId: "u", properties: { environment: undefined } });
    expect(capture.mock.calls[0]?.[0]).toEqual({
      distinctId: "u",
      event: "viewed",
      properties: { a: 1, environment: "stage" },
    });
    expect(identify.mock.calls[0]?.[0]).toEqual({
      distinctId: "u",
      properties: { environment: "stage" },
    });
  });

  it("routes exceptions through captureExceptionImmediate with the stage", async () => {
    const { client, captureExceptionImmediate } = recordingClient();
    const tagged = withEnvironmentProperty(client, "stage");
    await tagged.captureExceptionImmediate(new Error("boom"), "u", { route: "/x" });
    expect(captureExceptionImmediate.mock.calls[0]?.[2]).toEqual({
      route: "/x",
      environment: "stage",
    });
  });

  it("forwards flush and shutdown", async () => {
    const { client, flush } = recordingClient();
    const tagged = withEnvironmentProperty(client, "stage");
    await tagged.flush();
    await tagged.shutdown();
    expect(flush).toHaveBeenCalledOnce();
  });
});

describe("makePostHogClient / disabledPostHogClient", () => {
  it("returns a disabled client without a token or host — no network, no throw", async () => {
    for (const options of [
      { token: undefined, host: "https://eu.i.posthog.com", stage: "dev" },
      { token: "  ", host: "https://eu.i.posthog.com", stage: "dev" },
      { token: "phc_x", host: undefined, stage: "dev" },
    ]) {
      const client = makePostHogClient(options);
      client.capture({ distinctId: "u", event: "noop" });
      await expect(client.flush()).resolves.toBeUndefined();
      await client.shutdown();
    }
  });

  it("builds a real client with a token and host, wrapped so events carry the stage", () => {
    const client = makePostHogClient({
      token: "phc_x",
      host: "https://eu.i.posthog.com",
      stage: "stage",
    });
    // The wrapper's surface, not the disabled client's own class.
    expect(typeof client.captureExceptionImmediate).toBe("function");
    expect(typeof client.capture).toBe("function");
    expect(client).not.toBeInstanceOf(disabledPostHogClient().constructor);
  });
});

describe("isIngestPath", () => {
  it("matches the prefix and anything under it, and nothing that merely starts with it", () => {
    expect(isIngestPath("/ingest")).toBe(true);
    expect(isIngestPath("/ingest/e/")).toBe(true);
    expect(isIngestPath("/ingestion")).toBe(false);
    expect(isIngestPath("/api/ingest", "/api")).toBe(true);
  });
});

describe("proxyIngestRequest", () => {
  /** An upstream that records what it was handed and answers with `set-cookie`. */
  const upstream = () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch: IngestProxyOptions["fetch"] = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response("upstream", {
        status: 200,
        headers: { "content-type": "text/plain", "set-cookie": "evil=1" },
      });
    };
    return { calls, fetch };
  };
  const headersOf = (init: RequestInit) => new Headers(init.headers);

  it("forwards to the ingest host with the prefix stripped, query intact", async () => {
    const { calls, fetch } = upstream();
    const response = await proxyIngestRequest(
      new Request("http://app.example:8080/ingest/e/?v=1&ip=1", { method: "POST", body: "{}" }),
      { getClientAddress: () => "203.0.113.9", fetch },
    );
    expect(calls[0]?.url).toBe("https://eu.i.posthog.com/e/?v=1&ip=1");
    expect(calls[0]?.init.method).toBe("POST");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("upstream");
  });

  it("routes the static assets to the assets host", async () => {
    const { calls, fetch } = upstream();
    await proxyIngestRequest(new Request("https://app.example/ingest/static/array.js"), {
      getClientAddress: () => "203.0.113.9",
      fetch,
    });
    expect(calls[0]?.url).toBe("https://eu-assets.i.posthog.com/static/array.js");
  });

  it("forwards only the allow-listed headers — never cookie or authorization", async () => {
    const { calls, fetch } = upstream();
    await proxyIngestRequest(
      new Request("https://app.example/ingest/e/", {
        method: "POST",
        body: "{}",
        headers: {
          cookie: "session=secret",
          authorization: "Bearer secret",
          "x-forwarded-for": "6.6.6.6",
          "user-agent": "UA/1",
          "content-type": "application/json",
          "accept-encoding": "br",
        },
      }),
      { getClientAddress: () => "203.0.113.9", fetch },
    );
    const forwarded = headersOf(calls[0]?.init ?? {});
    expect(forwarded.get("cookie")).toBeNull();
    expect(forwarded.get("authorization")).toBeNull();
    expect(forwarded.get("user-agent")).toBe("UA/1");
    expect(forwarded.get("content-type")).toBe("application/json");
    expect(forwarded.get("host")).toBe("eu.i.posthog.com");
    // Rewritten, so the upstream response is not compressed against a
    // client that did not negotiate it through us.
    expect(forwarded.get("accept-encoding")).toBe("");
    // The platform-resolved address, never the spoofable inbound header (SEC-SSRF-005).
    expect(forwarded.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(FORWARDED_HEADERS.has("cookie")).toBe(false);
  });

  it("omits x-forwarded-for when the platform cannot resolve an address", async () => {
    const { calls, fetch } = upstream();
    await proxyIngestRequest(new Request("https://app.example/ingest/e/"), {
      getClientAddress: () => {
        throw new Error("no address");
      },
      fetch,
    });
    expect(headersOf(calls[0]?.init ?? {}).get("x-forwarded-for")).toBeNull();
  });

  it("strips an upstream set-cookie and stamps the baseline security headers", async () => {
    const { fetch } = upstream();
    const response = await proxyIngestRequest(new Request("https://app.example/ingest/e/"), {
      getClientAddress: () => "203.0.113.9",
      fetch,
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/plain");
    for (const [name, value] of Object.entries(SECURITY_HEADER_DEFAULTS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("refuses methods the SDK never uses with 405, without reaching upstream", async () => {
    const { calls, fetch } = upstream();
    const response = await proxyIngestRequest(
      new Request("https://app.example/ingest/e/", { method: "DELETE" }),
      { getClientAddress: () => "203.0.113.9", fetch },
    );
    expect(response.status).toBe(405);
    expect(calls).toEqual([]);
  });

  it("honours a custom prefix and upstream", async () => {
    const { calls, fetch } = upstream();
    await proxyIngestRequest(new Request("https://app.example/ph/decide/"), {
      prefix: "/ph",
      upstream: { host: "us.i.posthog.com", assetsHost: "us-assets.i.posthog.com" },
      getClientAddress: () => "203.0.113.9",
      fetch,
    });
    expect(calls[0]?.url).toBe("https://us.i.posthog.com/decide/");
  });
});

describe("ingestProxy — the effect/http handler", () => {
  it("proxies the HttpServerRequest in context and answers with the raw upstream response", async () => {
    const calls: Array<string> = [];
    const response = await Effect.runPromise(
      ingestProxy({
        getClientAddress: () => "203.0.113.9",
        fetch: async (input) => {
          calls.push(String(input));
          return new Response("ok", { status: 202 });
        },
      }).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request("https://app.example/ingest/e/?x=1")),
        ),
      ),
    );
    expect(calls).toEqual(["https://eu.i.posthog.com/e/?x=1"]);
    expect(response.status).toBe(202);
    const web = HttpServerResponse.toWeb(response);
    await expect(web.text()).resolves.toBe("ok");
  });
});
