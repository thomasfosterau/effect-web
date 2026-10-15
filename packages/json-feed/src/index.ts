/**
 * `@thomasfosterau/effect-json-feed` — a JSON Feed 1.1 document
 * (`feed.json`) built from a feed description and its entries, and served
 * as an `HttpServerResponse` behind the low-churn edge cache.
 *
 * Everything takes a site-root-relative `path` and resolves it on the
 * canonical origin; mapping a resource to its route stays in the
 * application. An absent member is an omitted key, never `null` or
 * `undefined`, so the document a consumer holds is the document it serves.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

// ── The document ───────────────────────────────────────────────────────

/**
 * The `version` every JSON Feed 1.1 document declares.
 *
 * @since 0.1.0
 * @category constants
 */
export const JSON_FEED_VERSION = "https://jsonfeed.org/version/1.1";

/**
 * A JSON Feed author object. JSON Feed requires at least one of `name`,
 * `url` and `avatar`; the type rejects an author with none. On input,
 * `url` and `avatar` may be site-root-relative paths; the built document
 * carries them absolute.
 *
 * @since 0.1.0
 * @category models
 */
export type JsonFeedAuthor =
  | {
      readonly name: string;
      readonly url?: string | undefined;
      readonly avatar?: string | undefined;
    }
  | {
      readonly name?: string | undefined;
      readonly url: string;
      readonly avatar?: string | undefined;
    }
  | {
      readonly name?: string | undefined;
      readonly url?: string | undefined;
      readonly avatar: string;
    };

/**
 * A JSON Feed 1.1 item, as {@link buildJsonFeed} emits it: member names are
 * the spec's, every URL is absolute, every date RFC 3339 in UTC.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedItem {
  readonly id: string;
  readonly url?: string | undefined;
  readonly external_url?: string | undefined;
  readonly title?: string | undefined;
  readonly content_html?: string | undefined;
  readonly content_text?: string | undefined;
  readonly summary?: string | undefined;
  readonly image?: string | undefined;
  readonly banner_image?: string | undefined;
  readonly date_published?: string | undefined;
  readonly date_modified?: string | undefined;
  readonly authors?: ReadonlyArray<JsonFeedAuthor> | undefined;
  readonly tags?: ReadonlyArray<string> | undefined;
  readonly language?: string | undefined;
}

/**
 * A JSON Feed 1.1 document, as {@link buildJsonFeed} emits it.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeed {
  readonly version: typeof JSON_FEED_VERSION;
  readonly title: string;
  readonly home_page_url?: string | undefined;
  readonly feed_url?: string | undefined;
  readonly description?: string | undefined;
  readonly user_comment?: string | undefined;
  readonly next_url?: string | undefined;
  readonly icon?: string | undefined;
  readonly favicon?: string | undefined;
  readonly authors?: ReadonlyArray<JsonFeedAuthor> | undefined;
  readonly language?: string | undefined;
  readonly expired?: boolean | undefined;
  readonly items: ReadonlyArray<JsonFeedItem>;
}

// ── Input ──────────────────────────────────────────────────────────────

/**
 * What describes the feed as a whole. Every path-valued member takes a
 * site-root-relative path or an absolute URL and is emitted absolute on
 * `base`.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedOptions {
  /** The canonical origin every URL is resolved on, never the request origin. */
  readonly base: string;
  readonly title: string;
  readonly description?: string | undefined;
  /** The page the feed describes, `home_page_url`. Defaults to `/`. */
  readonly homePath?: string | undefined;
  /** The feed's own path, `feed_url`. Defaults to `/feed.json`. */
  readonly feedPath?: string | undefined;
  /** The next page of a paginated feed, `next_url`. */
  readonly nextPath?: string | undefined;
  /** A note to a human who opens the document, `user_comment`. */
  readonly userComment?: string | undefined;
  /** A 512 × 512 image. */
  readonly icon?: string | undefined;
  /** A 64 × 64 image. */
  readonly favicon?: string | undefined;
  readonly authors?: ReadonlyArray<JsonFeedAuthor> | undefined;
  /** A language tag (`en-AU`). */
  readonly language?: string | undefined;
  /** `true` when the feed will never update again. */
  readonly expired?: boolean | undefined;
}

/**
 * One feed entry: a site-root-relative `path` and what the feed shows of
 * it. JSON Feed requires `content_html` or `content_text` on every item;
 * the type rejects an entry with neither.
 *
 * @since 0.1.0
 * @category models
 */
export type JsonFeedEntry = {
  readonly path: string;
  /** The item's permanent `id`. Defaults to its absolute URL. */
  readonly id?: string | undefined;
  /** The URL of the page the item is about, when that is elsewhere. */
  readonly externalUrl?: string | undefined;
  readonly title?: string | undefined;
  /** Plain text. */
  readonly summary?: string | undefined;
  /** The item's main image: a site-root-relative path or an absolute URL. */
  readonly image?: string | undefined;
  /** A banner image: a site-root-relative path or an absolute URL. */
  readonly bannerImage?: string | undefined;
  /** When the item was first available, `date_published`. */
  readonly publishedAt?: DateTime.DateTime | undefined;
  /** When the item last changed, `date_modified`. */
  readonly updatedAt?: DateTime.DateTime | undefined;
  /** The item's own authors; absent, it inherits the feed's. */
  readonly authors?: ReadonlyArray<JsonFeedAuthor> | undefined;
  readonly tags?: ReadonlyArray<string> | undefined;
  readonly language?: string | undefined;
} & (
  | { readonly contentHtml: string; readonly contentText?: string | undefined }
  | { readonly contentHtml?: string | undefined; readonly contentText: string }
);

// ── Building ───────────────────────────────────────────────────────────

/**
 * An `A` built from every one of its members, absent ones as `undefined`,
 * with those keys dropped: the caller lists each member once (the mapped
 * parameter type makes a forgotten one a compile error), and the result
 * carries only the present ones.
 */
const compact = <A>(record: { readonly [K in keyof A]-?: A[K] | undefined }): A =>
  // SAFETY: `Record.filter` only removes keys, and only `undefined`-valued ones; every member that can be `undefined` is optional in `A`, so what remains is an `A`. The assertion restores the key set `filter` widens to `string`.
  Record.filter(record, Predicate.isNotUndefined) as A;

const absolute = (base: string, path: string): string => new URL(path, base).toString();

const optionalUrl = (base: string, path: string | undefined): string | undefined =>
  path === undefined ? undefined : absolute(base, path);

const optionalDate = (date: DateTime.DateTime | undefined): string | undefined =>
  date === undefined ? undefined : DateTime.formatIso(date);

const authors = (
  base: string,
  people: ReadonlyArray<JsonFeedAuthor> | undefined,
): ReadonlyArray<JsonFeedAuthor> | undefined =>
  people === undefined
    ? undefined
    : Arr.map(people, (person) =>
        compact<JsonFeedAuthor>({
          name: person.name,
          url: optionalUrl(base, person.url),
          avatar: optionalUrl(base, person.avatar),
        }),
      );

/**
 * One item on `base` (the canonical origin, never the request origin): its
 * `url` is the absolute URL of `path` (CANON-001), which is also its `id`
 * unless the entry names its own. Dates are RFC 3339 in UTC; absent members
 * are omitted.
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import { buildJsonFeedItem } from "@thomasfosterau/effect-json-feed"
 *
 * buildJsonFeedItem("https://example.com", {
 *   path: "/posts/1",
 *   title: "Hello",
 *   contentText: "Hello, world.",
 *   publishedAt: DateTime.makeUnsafe("2026-03-04T05:06:07Z"),
 * })
 * // { id: "https://example.com/posts/1", url: "https://example.com/posts/1", title: "Hello", content_text: "Hello, world.", date_published: "2026-03-04T05:06:07.000Z" }
 * ```
 *
 * @since 0.1.0
 * @category building
 */
export const buildJsonFeedItem = (base: string, entry: JsonFeedEntry): JsonFeedItem => {
  const url = absolute(base, entry.path);
  return compact<JsonFeedItem>({
    id: entry.id ?? url,
    url,
    external_url: optionalUrl(base, entry.externalUrl),
    title: entry.title,
    content_html: entry.contentHtml,
    content_text: entry.contentText,
    summary: entry.summary,
    image: optionalUrl(base, entry.image),
    banner_image: optionalUrl(base, entry.bannerImage),
    date_published: optionalDate(entry.publishedAt),
    date_modified: optionalDate(entry.updatedAt),
    authors: authors(base, entry.authors),
    tags: entry.tags,
    language: entry.language,
  });
};

/**
 * The whole JSON Feed 1.1 document: the feed's members and one item per
 * entry in the order given (the caller sorts newest first and bounds the
 * count). Pure. Every URL is absolute on `options.base`, the canonical
 * origin (CANON-001); absent members are omitted.
 *
 * @example
 * ```ts
 * import { buildJsonFeed } from "@thomasfosterau/effect-json-feed"
 *
 * const feed = buildJsonFeed(
 *   { base: "https://example.com", title: "Example" },
 *   [{ path: "/posts/1", contentHtml: "<p>Hello</p>" }],
 * )
 * feed.feed_url // "https://example.com/feed.json"
 * feed.items[0]?.id // "https://example.com/posts/1"
 * "description" in feed // false
 * ```
 *
 * @since 0.1.0
 * @category building
 */
export const buildJsonFeed = (
  options: JsonFeedOptions,
  entries: Iterable<JsonFeedEntry>,
): JsonFeed => {
  const { base } = options;
  return compact<JsonFeed>({
    version: JSON_FEED_VERSION,
    title: options.title,
    home_page_url: absolute(base, options.homePath ?? "/"),
    feed_url: absolute(base, options.feedPath ?? "/feed.json"),
    description: options.description,
    user_comment: options.userComment,
    next_url: optionalUrl(base, options.nextPath),
    icon: optionalUrl(base, options.icon),
    favicon: optionalUrl(base, options.favicon),
    authors: authors(base, options.authors),
    language: options.language,
    expired: options.expired,
    items: Arr.map(Arr.fromIterable(entries), (entry) => buildJsonFeedItem(base, entry)),
  });
};

// ── Serving ────────────────────────────────────────────────────────────

/**
 * The `Content-Type` a JSON Feed is served with.
 *
 * @since 0.1.0
 * @category constants
 */
export const JSON_FEED_CONTENT_TYPE = "application/feed+json";

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
export interface JsonFeedResponseOptions {
  /** The `Cache-Tag` a mutation purges; absent means untagged. */
  readonly cacheTag?: string | undefined;
  /** Defaults to {@link LOW_CHURN_CACHE_CONTROL}. */
  readonly cacheControl?: string | undefined;
}

/**
 * A JSON Feed as an `HttpServerResponse`: 2-space pretty-printed (a
 * hand-readable discovery document; changing the indent changes the bytes
 * on the wire and in every cached copy), {@link JSON_FEED_CONTENT_TYPE},
 * {@link LOW_CHURN_CACHE_CONTROL} unless overridden and, when given, the
 * `Cache-Tag`.
 *
 * @example
 * ```ts
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { buildJsonFeed, jsonFeedResponse } from "@thomasfosterau/effect-json-feed"
 *
 * const feed = buildJsonFeed({ base: "https://example.com", title: "Example" }, [])
 * const response = jsonFeedResponse(feed, { cacheTag: "feed" })
 * response.headers["cache-tag"] // "feed"
 * const text = await HttpServerResponse.toWeb(response).text()
 * text.startsWith('{\n  "version": "https://jsonfeed.org/version/1.1"') // true
 * ```
 *
 * @since 0.1.0
 * @category serving
 */
export const jsonFeedResponse = (
  feed: JsonFeed,
  options: JsonFeedResponseOptions = {},
): HttpServerResponse.HttpServerResponse => {
  const cacheControl = options.cacheControl ?? LOW_CHURN_CACHE_CONTROL;
  // oxlint-disable-next-line effect/avoid-direct-json -- the served document is deliberately 2-space pretty-printed; `Schema.fromJsonString` emits compact JSON with no indent option.
  return HttpServerResponse.text(JSON.stringify(feed, null, 2), {
    contentType: JSON_FEED_CONTENT_TYPE,
    headers:
      options.cacheTag === undefined
        ? { "cache-control": cacheControl }
        : { "cache-control": cacheControl, "cache-tag": options.cacheTag },
  });
};
