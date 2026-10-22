/**
 * The RSS 2.0 renderer, over the path-taking item shape, and the feed
 * response.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Chunk from "effect/Chunk";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  LOW_CHURN_CACHE_CONTROL,
  RSS_CONTENT_TYPE,
  renderRss,
  renderRssItem,
  rssResponse,
  type RssChannel,
} from "@thomasfosterau/effect-rss-feed";

const BASE = "https://example.com";
const PUBLISHED = DateTime.makeUnsafe("2026-03-04T05:06:07Z");
const channel: RssChannel = { base: BASE, title: "Example", description: "Latest changes" };

const OPEN = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>`;

describe("renderRss", () => {
  it("pins the bytes of a minimal channel with no items", () => {
    expect(renderRss(channel, [])).toBe(
      `${OPEN}<title>Example</title><link>https://example.com/</link><description>Latest changes</description><atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/></channel></rss>`,
    );
  });

  it("emits every optional channel element, in order, with custom paths", () => {
    const xml = renderRss(
      {
        ...channel,
        homePath: "/blog",
        feedPath: "/blog/rss.xml",
        language: "en-AU",
        copyright: "© Example",
        lastBuildDate: PUBLISHED,
        ttl: 60,
      },
      [],
    );
    expect(xml).toContain(
      `<link>https://example.com/blog</link><description>Latest changes</description><atom:link href="https://example.com/blog/rss.xml" rel="self" type="application/rss+xml"/><language>en-AU</language><copyright>© Example</copyright><lastBuildDate>Wed, 04 Mar 2026 05:06:07 GMT</lastBuildDate><ttl>60</ttl></channel>`,
    );
  });

  it("resolves every URL on the canonical base, never echoing another origin in a path", () => {
    const xml = renderRss({ ...channel, base: "https://canonical.example" }, [
      { path: "/posts/1", title: "a" },
    ]);
    expect(xml).toContain("<link>https://canonical.example/posts/1</link>");
    expect(xml).not.toContain("example.com/");
  });

  it("keeps item order and accepts any iterable", () => {
    const items = Chunk.make({ path: "/b", title: "B" }, { path: "/a", title: "A" });
    const xml = renderRss(channel, items);
    expect(xml.indexOf("<title>B</title>")).toBeLessThan(xml.indexOf("<title>A</title>"));
  });
});

describe("renderRssItem", () => {
  it("pins the bytes of a full item", () => {
    expect(
      renderRssItem(BASE, {
        path: "/posts/1",
        title: "Hello",
        description: "A summary.",
        content: "<p>Hello</p>",
        author: "ada@example.com (Ada)",
        categories: ["one", "two"],
        publishedAt: PUBLISHED,
      }),
    ).toBe(
      `<item><title>Hello</title><link>https://example.com/posts/1</link><description>A summary.</description><content:encoded>&lt;p&gt;Hello&lt;/p&gt;</content:encoded><author>ada@example.com (Ada)</author><category>one</category><category>two</category><guid isPermaLink="true">https://example.com/posts/1</guid><pubDate>Wed, 04 Mar 2026 05:06:07 GMT</pubDate></item>`,
    );
  });

  it("takes a description-only item", () => {
    expect(renderRssItem(BASE, { path: "/n", description: "Just a note" })).toBe(
      `<item><link>https://example.com/n</link><description>Just a note</description><guid isPermaLink="true">https://example.com/n</guid></item>`,
    );
  });

  it("emits a caller-supplied guid as not a permalink", () => {
    expect(renderRssItem(BASE, { path: "/p", title: "t", guid: "urn:uuid:1 & 2" })).toContain(
      `<guid isPermaLink="false">urn:uuid:1 &amp; 2</guid>`,
    );
  });

  it("escapes authored text and URLs", () => {
    const xml = renderRssItem(BASE, { path: "/search?q=a&b=<c>", title: `"Fish" & 'chips' <3` });
    expect(xml).toContain("<title>&quot;Fish&quot; &amp; &apos;chips&apos; &lt;3</title>");
    expect(xml).toContain("<link>https://example.com/search?q=a&amp;b=%3Cc%3E</link>");
  });

  it("drops characters XML 1.0 forbids, keeping tab, LF and CR", () => {
    expect(
      renderRssItem(BASE, { path: "/p", title: "a\u0000b\u0008c\u000Bd￾e\uD800f\tg\nh\ri" }),
    ).toContain("<title>abcdef\tg\nh\ri</title>");
  });
});

describe("rssResponse", () => {
  it("serves the document with the RSS type and the low-churn cache policy", async () => {
    const response = rssResponse(channel, [{ path: "/p", title: "t" }]);
    expect(response.headers["content-type"]).toBe(RSS_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe(LOW_CHURN_CACHE_CONTROL);
    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(await HttpServerResponse.toWeb(response).text()).toBe(
      renderRss(channel, [{ path: "/p", title: "t" }]),
    );
  });

  it("carries a Cache-Tag and an overridden Cache-Control when given", () => {
    const response = rssResponse(channel, [], { cacheTag: "feed", cacheControl: "no-store" });
    expect(response.headers["cache-tag"]).toBe("feed");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("pins the low-churn policy (PERF-CACHE-002)", () => {
    expect(LOW_CHURN_CACHE_CONTROL).toBe(
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
  });
});
