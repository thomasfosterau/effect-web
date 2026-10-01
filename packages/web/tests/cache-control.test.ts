/**
 * Unit tests for the CACHE-AUTH-003 safety net — `ensureCacheControl`
 * applied to a Web `Response` through `updateWebHeaders` — ported from
 * website's `apps/web/tests/unit/cache-control.test.ts` (the safety net for
 * hooks.server.ts response paths that bypass the `cacheControl` handle),
 * plus the viewer-aware policy the handle itself applies.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Headers from "effect/http/Headers";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  cacheControlForViewer,
  ensureCacheControl,
  PRIVATE_NO_STORE,
  updateHeaders,
  updateWebHeaders,
} from "@thomasfosterau/effect-web";

const ensure = (response: Response): Response => updateWebHeaders(response, ensureCacheControl);

describe("ensureCacheControl (Web adapter)", () => {
  it("stamps private, no-store on a response with no Cache-Control", () => {
    const response = new Response("body", { status: 200 });
    expect(response.headers.has("Cache-Control")).toBe(false);

    const result = ensure(response);

    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("preserves an existing Cache-Control unchanged (route opted in deliberately)", () => {
    const response = new Response("body", {
      status: 200,
      headers: { "Cache-Control": "public, max-age=3600" },
    });

    const result = ensure(response);

    expect(result.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("returns the same response instance when a Cache-Control is already present", () => {
    // No clone should happen when nothing needs stamping — cheap no-op path.
    const response = new Response("body", {
      headers: { "Cache-Control": "no-store" },
    });

    const result = ensure(response);

    expect(result).toBe(response);
  });

  it("preserves the response body and status when stamping", async () => {
    const response = new Response("hello", { status: 201, statusText: "Created" });

    const result = ensure(response);

    expect(result.status).toBe(201);
    expect(await result.text()).toBe("hello");
  });
});

describe("ensureCacheControl (HttpServerResponse)", () => {
  it("stamps a response with no Cache-Control and keeps a declared one", () => {
    const bare = updateHeaders(HttpServerResponse.text("hi"), ensureCacheControl);
    expect(Headers.get(bare.headers, "cache-control")).toStrictEqual(Option.some(PRIVATE_NO_STORE));

    const declared = HttpServerResponse.text("hi", {
      headers: { "cache-control": "public, max-age=1" },
    });
    const result = updateHeaders(declared, ensureCacheControl);
    expect(result).toBe(declared);
    expect(Headers.get(result.headers, "cache-control")).toStrictEqual(
      Option.some("public, max-age=1"),
    );
  });
});

describe("cacheControlForViewer (CACHE-AUTH-003)", () => {
  const declared = Headers.fromInput({ "cache-control": "public, s-maxage=600" });

  it("forces private, no-store for a resolved viewer, overriding the route", () => {
    expect(
      Headers.get(cacheControlForViewer(declared, { viewerResolved: true }), "cache-control"),
    ).toStrictEqual(Option.some(PRIVATE_NO_STORE));
  });

  it("keeps a route-declared Cache-Control for an anonymous request", () => {
    expect(
      Headers.get(cacheControlForViewer(declared, { viewerResolved: false }), "cache-control"),
    ).toStrictEqual(Option.some("public, s-maxage=600"));
  });

  it("stamps an anonymous response that declared nothing", () => {
    expect(
      Headers.get(cacheControlForViewer(Headers.empty, { viewerResolved: false }), "cache-control"),
    ).toStrictEqual(Option.some(PRIVATE_NO_STORE));
  });
});

import * as Option from "effect/Option";
