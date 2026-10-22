/**
 * The JSON Feed 1.1 builder, over the path-taking entry shape, and the feed
 * response: an adapter over effect-json-feed, so the document validates.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  buildJsonFeed,
  FEED_CACHE_TAG,
  FEED_ITEM_LIMIT,
  type FeedEntry,
  JSON_FEED_CONTENT_TYPE,
  jsonFeedResponse,
  LOW_CHURN_CACHE_CONTROL,
} from "@thomasfosterau/effect-sitemap";
import * as JsonFeedDocument from "@thomasfosterau/effect-json-feed";

const NODE_ID = "0b54f5a1-6f2d-4f4e-9a0f-2f63c1f6a111";
const BASE = "https://thomasfoster.au";
const FIXED_DATE_PUBLISHED = "2024-01-01T00:00:00.000Z";
const FIXED_DATE_MODIFIED = "2024-06-01T12:00:00.000Z";
const options = {
  base: BASE,
  title: "Thomas Foster — Latest changes",
  description: `The ${FEED_ITEM_LIMIT} most recently published or updated pieces of public content on thomasfoster.au.`,
};

const makeEntry = (overrides: Partial<FeedEntry> = {}): FeedEntry => ({
  path: `/posts/${NODE_ID}`,
  publishedAt: FIXED_DATE_PUBLISHED,
  updatedAt: FIXED_DATE_MODIFIED,
  title: "A test post",
  summary: "A summary.",
  ...overrides,
});

describe("FEED_ITEM_LIMIT", () => {
  it("pins the documented budget (50 items — scoped discovery, not full corpus)", () => {
    expect(FEED_ITEM_LIMIT).toBe(50);
  });
});

describe("buildJsonFeed", () => {
  it("returns a valid JSON Feed 1.1 version string, home_page_url and feed_url on the base", () => {
    const feed = buildJsonFeed(options, []);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.home_page_url).toBe(`${BASE}/`);
    expect(feed.feed_url).toBe(`${BASE}/feed.json`);
    expect(feed.items).toHaveLength(0);
    expect(feed.title).toBe(options.title);
    expect(feed.description).toContain(String(FEED_ITEM_LIMIT));
  });

  it("takes custom feed and home paths", () => {
    const feed = buildJsonFeed({ ...options, feedPath: "/changes.json", homePath: "/home" }, []);
    expect(feed.feed_url).toBe(`${BASE}/changes.json`);
    expect(feed.home_page_url).toBe(`${BASE}/home`);
  });

  it("maps each entry to an item with the canonical url as id and url, timestamps through", () => {
    const item = buildJsonFeed(options, [makeEntry()]).items[0];
    expect(item?.id).toBe(`${BASE}/posts/${NODE_ID}`);
    expect(item?.url).toBe(`${BASE}/posts/${NODE_ID}`);
    expect(item?.date_published).toBe(FIXED_DATE_PUBLISHED);
    expect(item?.date_modified).toBe(FIXED_DATE_MODIFIED);
    expect(item?.title).toBe("A test post");
    expect(item?.summary).toBe("A summary.");
  });

  it("omits title and summary when null or absent (not null-valued keys)", () => {
    Arr.forEach(
      [
        makeEntry({ title: null, summary: null }),
        makeEntry({ title: undefined, summary: undefined }),
      ],
      (entry) => {
        const item = buildJsonFeed(options, [entry]).items[0] ?? {};
        expect(Object.hasOwn(item, "title")).toBe(false);
        expect(Object.hasOwn(item, "summary")).toBe(false);
      },
    );
  });

  it("gives every item the content_text JSON Feed 1.1 requires: summary, else title, else empty", () => {
    const items = buildJsonFeed(options, [
      makeEntry(),
      makeEntry({ summary: null }),
      makeEntry({ title: null, summary: undefined }),
    ]).items;
    expect(Arr.map(items, (item) => item.content_text)).toStrictEqual([
      "A summary.",
      "A test post",
      "",
    ]);
    expect(Object.hasOwn(items[2] ?? {}, "title")).toBe(false);
  });

  it("emits the timestamps RFC 3339 in UTC, a zoneless one read as UTC", () => {
    const item = buildJsonFeed(options, [
      makeEntry({ publishedAt: "2024-01-01T10:00:00+10:00", updatedAt: "2024-06-01T12:00:00" }),
    ]).items[0];
    expect(item?.date_published).toBe(FIXED_DATE_PUBLISHED);
    expect(item?.date_modified).toBe(FIXED_DATE_MODIFIED);
  });

  it("omits a timestamp that does not parse rather than emitting it invalid", () => {
    const item = buildJsonFeed(options, [makeEntry({ publishedAt: "not a date" })]).items[0] ?? {};
    expect(Object.hasOwn(item, "date_published")).toBe(false);
    expect(item).toHaveProperty("date_modified", FIXED_DATE_MODIFIED);
  });

  it("is effect-json-feed's document for the mapped entries", () => {
    const entry = makeEntry();
    expect(buildJsonFeed(options, [entry])).toStrictEqual(
      JsonFeedDocument.buildJsonFeed(options, [
        {
          path: entry.path,
          title: "A test post",
          summary: "A summary.",
          contentText: "A summary.",
          publishedAt: DateTime.makeUnsafe(FIXED_DATE_PUBLISHED),
          updatedAt: DateTime.makeUnsafe(FIXED_DATE_MODIFIED),
        },
      ]),
    );
  });

  it("preserves entry order (caller is responsible for newest-first)", () => {
    const feed = buildJsonFeed(options, [
      makeEntry({ path: "/posts/aaaaaaaa-0000-0000-0000-000000000001" }),
      makeEntry({ path: "/notes/aaaaaaaa-0000-0000-0000-000000000002" }),
    ]);
    expect(feed.items[0]?.url).toContain("000000000001");
    expect(feed.items[1]?.url).toContain("000000000002");
  });

  it("builds absolute URLs even when base has a trailing slash", () => {
    expect(buildJsonFeed({ ...options, base: `${BASE}/` }, [makeEntry()]).items[0]?.url).toBe(
      `${BASE}/posts/${NODE_ID}`,
    );
  });
});

describe("jsonFeedResponse", () => {
  it("serves the pretty-printed document as application/feed+json with the cache policy and tag", async () => {
    const feed = buildJsonFeed(options, [makeEntry()]);
    const response = jsonFeedResponse(feed, { cacheTag: FEED_CACHE_TAG });
    expect(response.headers["content-type"]).toContain(JSON_FEED_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe(LOW_CHURN_CACHE_CONTROL);
    expect(response.headers["cache-tag"]).toBe("feed");
    expect(jsonFeedResponse(feed, { cacheControl: "no-store" }).headers["cache-control"]).toBe(
      "no-store",
    );
    expect(Object.hasOwn(jsonFeedResponse(feed).headers, "cache-tag")).toBe(false);
    const text = await HttpServerResponse.toWeb(response).text();
    // oxlint-disable-next-line effect/avoid-direct-json -- the expected bytes ARE `JSON.stringify(feed, null, 2)`: the deliberate 2-space pretty-print the source documents, which `Schema.fromJsonString` cannot express (it has no indent option).
    expect(text).toBe(JSON.stringify(feed, null, 2));
  });
});
