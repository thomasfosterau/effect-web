/**
 * Unit tests for the response-header policies (`securityHeaders`,
 * `stageNoindex`, `appendVary`, `responseVary`) and the route predicates
 * (`isLocaleInvariantAsset`, `classifyRoute`). Each is a pure function, so it
 * is tested directly, without a request handler's import graph.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Headers from "effect/http/Headers";
import {
  appendVary,
  applyToWebHeaders,
  classifyRoute,
  isLocaleInvariantAsset,
  isOpenGraphCard,
  LOCALE_INVARIANT_ASSET_PATHS,
  makeLocaleInvariantAssetMatcher,
  responseVary,
  SECURITY_HEADER_DEFAULTS,
  securityHeaders,
  stageNoindex,
  updateWebHeaders,
  VARY_BY_ROUTE_CLASS,
} from "@thomasfosterau/effect-web";

const vary = (headers: Headers.Headers): Option.Option<string> => Headers.get(headers, "vary");

describe("securityHeaders", () => {
  it("adds every baseline header to a bare response", () => {
    const headers = securityHeaders(Headers.empty);
    for (const [name, value] of Object.entries(SECURITY_HEADER_DEFAULTS)) {
      expect(Headers.get(headers, name)).toStrictEqual(Option.some(value));
    }
  });

  it("never overrides a header the route already set", () => {
    const headers = securityHeaders(Headers.fromInput({ "x-frame-options": "SAMEORIGIN" }));
    expect(Headers.get(headers, "x-frame-options")).toStrictEqual(Option.some("SAMEORIGIN"));
    expect(Headers.get(headers, "referrer-policy")).toStrictEqual(
      Option.some("strict-origin-when-cross-origin"),
    );
  });
});

describe("stageNoindex (CANON-003)", () => {
  it("marks a non-indexable stage noindex and leaves production alone", () => {
    expect(
      Headers.get(stageNoindex(Headers.empty, { indexable: false }), "x-robots-tag"),
    ).toStrictEqual(Option.some("noindex"));
    expect(Headers.has(stageNoindex(Headers.empty, { indexable: true }), "x-robots-tag")).toBe(
      false,
    );
  });

  it("keeps a route's own X-Robots-Tag", () => {
    const declared = Headers.fromInput({ "x-robots-tag": "noindex, nofollow" });
    expect(Headers.get(stageNoindex(declared, { indexable: false }), "x-robots-tag")).toStrictEqual(
      Option.some("noindex, nofollow"),
    );
  });
});

describe("appendVary", () => {
  it("creates Vary when absent", () => {
    expect(vary(appendVary(Headers.empty, ["Accept"]))).toStrictEqual(Option.some("Accept"));
  });

  it("appends only the names not already present, case-insensitively", () => {
    const headers = appendVary(Headers.fromInput({ vary: "accept, Cookie" }), [
      "Accept",
      "COOKIE",
      "Accept-Language",
    ]);
    expect(vary(headers)).toStrictEqual(Option.some("accept, Cookie, Accept-Language"));
  });

  it("returns the same headers when nothing is added", () => {
    const headers = Headers.fromInput({ vary: "Accept" });
    expect(appendVary(headers, ["accept"])).toBe(headers);
  });
});

describe("responseVary / classifyRoute (PERF-CACHE-001)", () => {
  it("gives locale-invariant assets no Vary at all", () => {
    expect(Headers.has(responseVary(Headers.empty, "locale-invariant"), "vary")).toBe(false);
    expect(VARY_BY_ROUTE_CLASS["locale-invariant"]).toStrictEqual([]);
  });

  it("gives format-negotiated assets Accept alone", () => {
    expect(vary(responseVary(Headers.empty, "format-negotiated"))).toStrictEqual(
      Option.some("Accept"),
    );
  });

  it("gives the negotiated surface the full set", () => {
    expect(vary(responseVary(Headers.empty, "negotiated"))).toStrictEqual(
      Option.some("Cookie, Accept-Language, Accept"),
    );
  });

  it("classifies narrowest first", () => {
    expect(classifyRoute("/robots.txt")).toBe("locale-invariant");
    expect(classifyRoute("/og/card.png")).toBe("locale-invariant");
    expect(classifyRoute("/posts/1")).toBe("negotiated");
    const classifier = {
      isFormatNegotiatedAsset: (pathname: string) => pathname.startsWith("/images/"),
    };
    expect(classifyRoute("/images/1", classifier)).toBe("format-negotiated");
    expect(classifyRoute("/favicon.ico", classifier)).toBe("locale-invariant");
  });
});

describe("isLocaleInvariantAsset", () => {
  it("matches every path in the set and the Open Graph card family", () => {
    for (const path of LOCALE_INVARIANT_ASSET_PATHS)
      expect(isLocaleInvariantAsset(path)).toBe(true);
    expect(isLocaleInvariantAsset("/og/abc.png")).toBe(true);
    expect(isOpenGraphCard("/og/abc.png")).toBe(true);
  });

  it("does not match pages, near-misses or non-PNG share-card paths", () => {
    expect(isLocaleInvariantAsset("/posts")).toBe(false);
    expect(isLocaleInvariantAsset("/sitemap.xml/")).toBe(false);
    expect(isLocaleInvariantAsset("/og/abc.svg")).toBe(false);
    expect(isOpenGraphCard("/og-default.png")).toBe(false);
  });

  it("builds an application-specific matcher from a path set plus predicates", () => {
    const matcher = makeLocaleInvariantAssetMatcher(["/manifest.webmanifest"], (p) =>
      p.startsWith("/static/"),
    );
    expect(matcher("/manifest.webmanifest")).toBe(true);
    expect(matcher("/static/app.css")).toBe(true);
    expect(matcher("/favicon.ico")).toBe(false);
  });
});

describe("the Fetch adapter", () => {
  it("updateWebHeaders clones only when the policy changed something", () => {
    const untouched = new Response("x", { headers: { "x-frame-options": "DENY" } });
    expect(updateWebHeaders(untouched, (h) => stageNoindex(h, { indexable: true }))).toBe(
      untouched,
    );

    const stamped = updateWebHeaders(untouched, securityHeaders);
    expect(stamped).not.toBe(untouched);
    expect(stamped.headers.get("x-frame-options")).toBe("DENY");
    expect(stamped.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("applyToWebHeaders mutates a mutable Headers in place", () => {
    const headers = new globalThis.Headers({ vary: "Accept" });
    applyToWebHeaders(headers, (h) => responseVary(securityHeaders(h), "negotiated"));
    expect(headers.get("vary")).toBe("Accept, Cookie, Accept-Language");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
