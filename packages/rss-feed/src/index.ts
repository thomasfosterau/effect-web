/**
 * `@thomasfosterau/effect-rss-feed` — an RSS 2.0 feed (`rss.xml`) built
 * from a channel description and its items, and served as an
 * `HttpServerResponse` behind the low-churn edge cache.
 *
 * Everything takes a site-root-relative `path` and resolves it on the
 * canonical origin; mapping a resource to its route stays in the
 * application. Every piece of authored text and every URL is XML-escaped, and
 * characters XML 1.0 forbids are dropped, so a stray control character in a
 * title cannot make the feed unparseable.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { element, escapeXml, optionalElement, XML_DECLARATION } from "./internal/xml.ts";

// ── Models ─────────────────────────────────────────────────────────────

/**
 * The feed as a whole: the RSS `<channel>`.
 *
 * @since 0.1.0
 * @category models
 */
export interface RssChannel {
  /** The canonical origin every URL is resolved on, never the request origin. */
  readonly base: string;
  readonly title: string;
  /** The channel's `<description>`; RSS 2.0 requires one. */
  readonly description: string;
  /** The page the feed describes, the channel `<link>`. Defaults to `/`. */
  readonly homePath?: string | undefined;
  /** The feed's own path, emitted as the `atom:link rel="self"`. Defaults to `/rss.xml`. */
  readonly feedPath?: string | undefined;
  /** A language tag (`en-AU`). */
  readonly language?: string | undefined;
  readonly copyright?: string | undefined;
  /** When the feed's content last changed. A value the caller supplies, never a clock read. */
  readonly lastBuildDate?: DateTime.DateTime | undefined;
  /** How long, in minutes, a reader may cache the feed before refreshing. */
  readonly ttl?: number | undefined;
}

/**
 * One `<item>`: a site-root-relative `path` and what the feed shows of it.
 * RSS 2.0 requires at least one of `title` and `description`; the type
 * rejects an item with neither.
 *
 * @since 0.1.0
 * @category models
 */
export type RssItem = {
  readonly path: string;
  /** Full HTML content, emitted escaped as `content:encoded`. */
  readonly content?: string | undefined;
  /** The author's email address, optionally followed by `(Name)`, as RSS 2.0 specifies. */
  readonly author?: string | undefined;
  readonly categories?: ReadonlyArray<string> | undefined;
  /**
   * A stable identifier that is not the item's URL, emitted with
   * `isPermaLink="false"`. Absent, the item's absolute URL is the permalink
   * `<guid>`.
   */
  readonly guid?: string | undefined;
  /** The item's `<pubDate>`. */
  readonly publishedAt?: DateTime.DateTime | undefined;
} & (
  | {
      readonly title: string;
      /** A summary or the item's HTML, emitted escaped. */
      readonly description?: string | undefined;
    }
  | { readonly title?: string | undefined; readonly description: string }
);

// ── Rendering ──────────────────────────────────────────────────────────

/**
 * The `Content-Type` an RSS feed is served with.
 *
 * @since 0.1.0
 * @category constants
 */
export const RSS_CONTENT_TYPE = "application/rss+xml";

/** The RFC 822 date RSS 2.0 requires (`Wed, 04 Mar 2026 05:06:07 GMT`). */
const rfc822 = (date: DateTime.DateTime): string => DateTime.toDateUtc(date).toUTCString();

const optionalDate = (name: string, date: DateTime.DateTime | undefined): string =>
  date === undefined ? "" : element(name, rfc822(date));

const guid = (url: string, item: RssItem): string =>
  item.guid === undefined
    ? `<guid isPermaLink="true">${escapeXml(url)}</guid>`
    : `<guid isPermaLink="false">${escapeXml(item.guid)}</guid>`;

/**
 * One `<item>` on `base` (the canonical origin, never the request origin):
 * its `<link>` is the absolute URL of `path` (CANON-001), which is also its
 * permalink `<guid>` unless the item names its own.
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import { renderRssItem } from "@thomasfosterau/effect-rss-feed"
 *
 * renderRssItem("https://example.com", {
 *   path: "/posts/1",
 *   title: "Fish & chips",
 *   publishedAt: DateTime.makeUnsafe("2026-03-04T05:06:07Z"),
 * })
 * // '<item><title>Fish &amp; chips</title><link>https://example.com/posts/1</link><guid isPermaLink="true">https://example.com/posts/1</guid><pubDate>Wed, 04 Mar 2026 05:06:07 GMT</pubDate></item>'
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderRssItem = (base: string, item: RssItem): string => {
  const url = new URL(item.path, base).toString();
  return [
    "<item>",
    optionalElement("title", item.title),
    element("link", url),
    optionalElement("description", item.description),
    optionalElement("content:encoded", item.content),
    optionalElement("author", item.author),
    ...Arr.map(item.categories ?? [], (category) => element("category", category)),
    guid(url, item),
    optionalDate("pubDate", item.publishedAt),
    "</item>",
  ].join("");
};

/**
 * The whole RSS 2.0 document: the XML declaration, the `<channel>` and one
 * `<item>` per entry in the order given (the caller sorts newest first and
 * bounds the count). Every URL is absolute on `channel.base`, the canonical
 * origin (CANON-001). The `atom` and `content` namespaces are always
 * declared, so the opening bytes do not depend on the items.
 *
 * @example
 * ```ts
 * import { renderRss } from "@thomasfosterau/effect-rss-feed"
 *
 * const xml = renderRss(
 *   { base: "https://example.com", title: "Example", description: "Latest changes" },
 *   [{ path: "/posts/1", title: "Hello" }],
 * )
 * xml.includes('<atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/>') // true
 * xml.endsWith("</item></channel></rss>") // true
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderRss = (channel: RssChannel, items: Iterable<RssItem>): string => {
  const feedUrl = new URL(channel.feedPath ?? "/rss.xml", channel.base).toString();
  return [
    XML_DECLARATION,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>`,
    element("title", channel.title),
    element("link", new URL(channel.homePath ?? "/", channel.base).toString()),
    element("description", channel.description),
    `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="${RSS_CONTENT_TYPE}"/>`,
    optionalElement("language", channel.language),
    optionalElement("copyright", channel.copyright),
    optionalDate("lastBuildDate", channel.lastBuildDate),
    optionalElement("ttl", channel.ttl === undefined ? undefined : String(channel.ttl)),
    ...Arr.map(Arr.fromIterable(items), (item) => renderRssItem(channel.base, item)),
    "</channel></rss>",
  ].join("");
};

// ── Serving ────────────────────────────────────────────────────────────

/**
 * The `Cache-Control` the feed is served with by default: the edge caches
 * the whole document for an hour, so any enumeration behind it runs at most
 * once per hour per edge, and a mutation purges its `Cache-Tag` rather than
 * waiting out the TTL (PERF-CACHE-002). The same value as
 * `@thomasfosterau/effect-sitemap`'s.
 *
 * @since 0.1.0
 * @category constants
 */
export const LOW_CHURN_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * What the served feed is cached under.
 *
 * @since 0.1.0
 * @category models
 */
export interface RssResponseOptions {
  /** The `Cache-Tag` a mutation purges; absent means untagged. */
  readonly cacheTag?: string | undefined;
  /** Defaults to {@link LOW_CHURN_CACHE_CONTROL}. */
  readonly cacheControl?: string | undefined;
}

/**
 * The feed as an `HttpServerResponse`: {@link renderRss}'s document,
 * {@link RSS_CONTENT_TYPE}, {@link LOW_CHURN_CACHE_CONTROL} unless
 * overridden and, when given, the `Cache-Tag`.
 *
 * @example
 * ```ts
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { rssResponse } from "@thomasfosterau/effect-rss-feed"
 *
 * const response = rssResponse(
 *   { base: "https://example.com", title: "Example", description: "Latest changes" },
 *   [],
 *   { cacheTag: "feed" },
 * )
 * response.headers["cache-tag"] // "feed"
 * const body = await HttpServerResponse.toWeb(response).text()
 * body.startsWith('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"') // true
 * ```
 *
 * @since 0.1.0
 * @category serving
 */
export const rssResponse = (
  channel: RssChannel,
  items: Iterable<RssItem>,
  options: RssResponseOptions = {},
): HttpServerResponse.HttpServerResponse => {
  const cacheControl = options.cacheControl ?? LOW_CHURN_CACHE_CONTROL;
  return HttpServerResponse.text(renderRss(channel, items), {
    contentType: RSS_CONTENT_TYPE,
    headers:
      options.cacheTag === undefined
        ? { "cache-control": cacheControl }
        : { "cache-control": cacheControl, "cache-tag": options.cacheTag },
  });
};
