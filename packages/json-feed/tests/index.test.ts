/**
 * The JSON Feed 1.1 builder, over the path-taking entry shape, and the feed
 * response.
 */

import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  buildJsonFeed,
  buildJsonFeedItem,
  JSON_FEED_CONTENT_TYPE,
  JSON_FEED_VERSION,
  jsonFeedResponse,
  LOW_CHURN_CACHE_CONTROL,
  type JsonFeedOptions,
} from "@thomasfosterau/effect-json-feed";

const BASE = "https://example.com";
const PUBLISHED = DateTime.makeUnsafe("2026-01-02T03:04:05Z");
const UPDATED = DateTime.makeUnsafe("2026-03-04T05:06:07Z");
const options: JsonFeedOptions = { base: BASE, title: "Example" };

describe("buildJsonFeed", () => {
  it("builds a minimal feed with only the present members", () => {
    expect(buildJsonFeed(options, [])).toStrictEqual({
      version: JSON_FEED_VERSION,
      title: "Example",
      home_page_url: "https://example.com/",
      feed_url: "https://example.com/feed.json",
      items: [],
    });
  });

  it("emits every optional feed member, URLs absolute on the base", () => {
    expect(
      buildJsonFeed(
        {
          ...options,
          description: "Latest changes",
          homePath: "/blog",
          feedPath: "/blog/feed.json",
          nextPath: "/blog/feed.json?page=2",
          userComment: "Subscribe in a feed reader.",
          icon: "/icon.png",
          favicon: "https://cdn.example.net/favicon.png",
          authors: [{ name: "Ada", url: "/people/ada", avatar: "/ada.png" }, { url: "/bob" }],
          language: "en-AU",
          expired: false,
        },
        [],
      ),
    ).toStrictEqual({
      version: JSON_FEED_VERSION,
      title: "Example",
      home_page_url: "https://example.com/blog",
      feed_url: "https://example.com/blog/feed.json",
      description: "Latest changes",
      user_comment: "Subscribe in a feed reader.",
      next_url: "https://example.com/blog/feed.json?page=2",
      icon: "https://example.com/icon.png",
      favicon: "https://cdn.example.net/favicon.png",
      authors: [
        {
          name: "Ada",
          url: "https://example.com/people/ada",
          avatar: "https://example.com/ada.png",
        },
        { url: "https://example.com/bob" },
      ],
      language: "en-AU",
      expired: false,
      items: [],
    });
  });

  it("keeps entry order and accepts any iterable", () => {
    const entries = new Set([
      { path: "/b", contentText: "B" },
      { path: "/a", contentText: "A" },
    ]);
    expect(buildJsonFeed(options, entries).items.map((item) => item.id)).toStrictEqual([
      "https://example.com/b",
      "https://example.com/a",
    ]);
  });

  it("resolves item URLs on the canonical base", () => {
    const feed = buildJsonFeed({ ...options, base: "https://canonical.example" }, [
      { path: "/posts/1", contentText: "x" },
    ]);
    expect(feed.items[0]?.url).toBe("https://canonical.example/posts/1");
  });
});

describe("buildJsonFeedItem", () => {
  it("builds a minimal item: id and url are the absolute URL", () => {
    expect(buildJsonFeedItem(BASE, { path: "/p", contentHtml: "<p>x</p>" })).toStrictEqual({
      id: "https://example.com/p",
      url: "https://example.com/p",
      content_html: "<p>x</p>",
    });
  });

  it("maps every entry member to its JSON Feed name", () => {
    expect(
      buildJsonFeedItem(BASE, {
        path: "/posts/1",
        id: "urn:uuid:1",
        externalUrl: "https://elsewhere.example/a",
        title: "Hello",
        contentHtml: "<p>Hello</p>",
        contentText: "Hello",
        summary: "A summary.",
        image: "/img.png",
        bannerImage: "/banner.png",
        publishedAt: PUBLISHED,
        updatedAt: UPDATED,
        authors: [{ avatar: "/ada.png" }],
        tags: ["one"],
        language: "en",
      }),
    ).toStrictEqual({
      id: "urn:uuid:1",
      url: "https://example.com/posts/1",
      external_url: "https://elsewhere.example/a",
      title: "Hello",
      content_html: "<p>Hello</p>",
      content_text: "Hello",
      summary: "A summary.",
      image: "https://example.com/img.png",
      banner_image: "https://example.com/banner.png",
      date_published: "2026-01-02T03:04:05.000Z",
      date_modified: "2026-03-04T05:06:07.000Z",
      authors: [{ avatar: "https://example.com/ada.png" }],
      tags: ["one"],
      language: "en",
    });
  });

  it("omits explicitly undefined members rather than carrying the key", () => {
    const item = buildJsonFeedItem(BASE, { path: "/p", contentText: "x", title: undefined });
    expect("title" in item).toBe(false);
  });
});

describe("jsonFeedResponse", () => {
  it("serves the 2-space pretty-printed document with the feed type and the low-churn cache policy", async () => {
    const feed = buildJsonFeed(options, [{ path: "/p", contentText: "x" }]);
    const response = jsonFeedResponse(feed);
    expect(response.headers["content-type"]).toBe(JSON_FEED_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe(LOW_CHURN_CACHE_CONTROL);
    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(await HttpServerResponse.toWeb(response).text()).toBe(JSON.stringify(feed, null, 2));
  });

  it("carries a Cache-Tag and an overridden Cache-Control when given", () => {
    const response = jsonFeedResponse(buildJsonFeed(options, []), {
      cacheTag: "feed",
      cacheControl: "no-store",
    });
    expect(response.headers["cache-tag"]).toBe("feed");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
