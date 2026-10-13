/**
 * The sitemap renderers (a static-shell page list is the fixture), the
 * stream form, the index, and `lastmodOf`.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  chunkSitemap,
  escapeXml,
  lastmodOf,
  LOW_CHURN_CACHE_CONTROL,
  renderSitemap,
  renderSitemapIndex,
  renderUrl,
  SITEMAP_CACHE_TAG,
  SITEMAP_MAX_URLS,
  type SitemapUrl,
  sitemapResponse,
  sitemapStream,
  URLSET_CLOSE,
  URLSET_OPEN,
} from "@thomasfosterau/effect-sitemap";

const BASE = "https://example.com";
const STATIC_PAGES: ReadonlyArray<SitemapUrl> = [
  { path: "/" },
  { path: "/election-events" },
  { path: "/people" },
];

describe("lastmodOf", () => {
  it("takes the day of a Date or an ISO string, and nothing from anything else", () => {
    expect(lastmodOf("2026-03-04T05:06:07.000Z")).toBe("2026-03-04");
    expect(lastmodOf("2026-03-04")).toBe("2026-03-04");
    expect(lastmodOf(new Date("2026-03-04T23:59:59Z"))).toBe("2026-03-04");
    expect(lastmodOf(new Date("nope"))).toBeUndefined();
    expect(lastmodOf("not a date")).toBeUndefined();
    expect(lastmodOf(12345)).toBeUndefined();
    expect(lastmodOf(undefined)).toBeUndefined();
  });
});

describe("renderUrl", () => {
  it("renders the loc on the base, with lastmod only when present", () => {
    expect(renderUrl(BASE, { path: "/people/abc", lastmod: "2026-03-04" })).toBe(
      `<url><loc>${BASE}/people/abc</loc><lastmod>2026-03-04</lastmod></url>`,
    );
    expect(renderUrl(BASE, { path: "/" })).toBe(`<url><loc>${BASE}/</loc></url>`);
  });

  it("resolves against the base even with a trailing slash on it", () => {
    expect(renderUrl(`${BASE}/`, { path: "/people/abc" })).toContain(`${BASE}/people/abc`);
  });
});

describe("renderSitemap", () => {
  it("emits the declaration, the urlset and every entry in order", () => {
    const xml = renderSitemap(BASE, [
      ...STATIC_PAGES,
      { path: "/people/abc", lastmod: "2026-03-04" },
    ]);
    expect(xml.startsWith(URLSET_OPEN)).toBe(true);
    expect(xml.endsWith(URLSET_CLOSE)).toBe(true);
    expect(xml).toBe(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        ...STATIC_PAGES.map((entry) => renderUrl(BASE, entry)),
        renderUrl(BASE, { path: "/people/abc", lastmod: "2026-03-04" }),
        `</urlset>`,
      ].join(""),
    );
  });

  it("renders an empty urlset for no entries", () => {
    expect(renderSitemap(BASE, [])).toBe(`${URLSET_OPEN}${URLSET_CLOSE}`);
  });
});

describe("sitemapStream / sitemapResponse", () => {
  it("streams the same document one entry per chunk", async () => {
    const entries = [...STATIC_PAGES, { path: "/people/abc", lastmod: "2026-03-04" }];
    const chunks = await Effect.runPromise(
      Stream.runCollect(sitemapStream(BASE, Stream.fromIterable(entries))),
    );
    expect(chunks).toHaveLength(entries.length + 2);
    expect(chunks.join("")).toBe(renderSitemap(BASE, entries));
  });

  it("answers with application/xml, the low-churn cache policy and the cache tag", async () => {
    const response = sitemapResponse(BASE, Stream.fromIterable(STATIC_PAGES), {
      cacheTag: SITEMAP_CACHE_TAG,
    });
    expect(response.headers["content-type"]).toContain("application/xml");
    expect(response.headers["cache-control"]).toBe(LOW_CHURN_CACHE_CONTROL);
    expect(response.headers["cache-tag"]).toBe("sitemap");
    await expect(HttpServerResponse.toWeb(response).text()).resolves.toBe(
      renderSitemap(BASE, STATIC_PAGES),
    );
  });

  it("omits the cache tag when none is given and takes a custom cache-control", () => {
    const response = sitemapResponse(BASE, Stream.empty, { cacheControl: "no-store" });
    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("chunkSitemap / renderSitemapIndex", () => {
  it("splits at the protocol cap by default and renders the index", () => {
    expect(SITEMAP_MAX_URLS).toBe(50_000);
    const entries = Array.from({ length: 5 }, (_, i) => ({ path: `/p/${i}` }));
    expect(chunkSitemap(entries, 2).map((chunk) => chunk.length)).toEqual([2, 2, 1]);
    expect(chunkSitemap([])).toEqual([]);
    expect(chunkSitemap(entries)).toHaveLength(1);
    expect(
      renderSitemapIndex(BASE, [
        { path: "/sitemap-1.xml", lastmod: "2026-03-04" },
        { path: "/sitemap-2.xml" },
      ]),
    ).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${BASE}/sitemap-1.xml</loc><lastmod>2026-03-04</lastmod></sitemap><sitemap><loc>${BASE}/sitemap-2.xml</loc></sitemap></sitemapindex>`,
    );
  });
});

describe("escapeXml", () => {
  it("escapes the five reserved characters", () => {
    expect(escapeXml(`a & b < c > "d" 'e'`)).toBe(
      "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;",
    );
  });
});
