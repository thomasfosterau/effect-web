/**
 * `@thomasfosterau/effect-web-sitemap` — the discovery documents an
 * application serves and the cache they live behind: `sitemap.xml`
 * (rendered whole, or streamed), a sitemap index, `feed.json` (JSON Feed
 * 1.1), and the `Cache-Tag` purge that keeps the edge copies fresh.
 *
 * Ported from preferenceflow's `apps/web/src/lib/server/sitemap.ts` (the
 * `renderUrl` / `renderSitemap` / `lastmodOf` factoring), website's
 * streaming `routes/sitemap.xml/+server.ts`, `packages/models/src/feed.ts`
 * (`buildJsonFeed`) and `apps/web/src/lib/server/cache-purge.ts`. What is
 * application vocabulary — the `core.searchable` type → route-segment map,
 * `sitemapPath` / `feedPath` — stays in the application; everything here
 * takes a site-root-relative `path`.
 *
 * No XML escaping is applied to `<loc>`: every location is the canonical
 * origin plus a path an application derives from validated ids or a
 * hand-maintained list. If authored text (a title) is ever emitted it MUST
 * be escaped first; {@link escapeXml} is here for that.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { describeError, logErrorEvent } from "@thomasfosterau/effect-web/observability";

// ── Sitemaps ───────────────────────────────────────────────────────────

/**
 * One sitemap entry: a site-root-relative path and an optional
 * `YYYY-MM-DD` lastmod.
 *
 * @since 0.1.0
 * @category models
 */
export interface SitemapUrl {
  readonly path: string;
  readonly lastmod?: string | undefined;
}

/**
 * The sitemap protocol's cap on one file: 50,000 URLs (and 50 MB). Split
 * into an index past it ({@link chunkSitemap}, {@link renderSitemapIndex}).
 *
 * @since 0.1.0
 * @category constants
 */
export const SITEMAP_MAX_URLS = 50_000;

/**
 * The `Cache-Control` a low-churn generated document (`sitemap.xml`,
 * `feed.json`, `robots.txt`) is served with: the edge caches the whole
 * document, bounding any request-time enumeration behind it to at most one
 * per hour per edge (PERF-CACHE-002). A mutation that could change the
 * document purges its `Cache-Tag` ({@link purgeCacheTags}) rather than
 * relying on the TTL alone.
 *
 * @since 0.1.0
 * @category constants
 */
export const LOW_CHURN_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * What a served discovery document is cached under.
 *
 * @since 0.1.0
 * @category models
 */
export interface DocumentCacheOptions {
  /** The `Cache-Tag` a mutation purges ({@link purgeCacheTags}); absent means untagged. */
  readonly cacheTag?: string | undefined;
  /** Defaults to {@link LOW_CHURN_CACHE_CONTROL}. */
  readonly cacheControl?: string | undefined;
}

/**
 * The cache headers of a served document — a type alias rather than an
 * interface so it stays assignable to `Headers.Input`'s record shape.
 */
type DocumentHeaders = {
  readonly "cache-control": string;
  readonly "cache-tag"?: string | undefined;
};

/** The cache headers of a served document; the tag only when given. */
const documentHeaders = (options: DocumentCacheOptions): DocumentHeaders => {
  const control = options.cacheControl ?? LOW_CHURN_CACHE_CONTROL;
  return options.cacheTag === undefined
    ? { "cache-control": control }
    : { "cache-control": control, "cache-tag": options.cacheTag };
};

/**
 * The five XML-reserved characters escaped for element text.
 *
 * @example
 * ```ts
 * import { escapeXml } from "@thomasfosterau/effect-web-sitemap"
 *
 * escapeXml(`a & b < "c"`) // "a &amp; b &lt; &quot;c&quot;"
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/**
 * The `YYYY-MM-DD` day of a `Date` or an ISO timestamp string, or
 * `undefined` when unparsable — the value `renderUrl` reads as "omit
 * `<lastmod>`". A parse of an existing value, never a clock read.
 *
 * @example
 * ```ts
 * import { lastmodOf } from "@thomasfosterau/effect-web-sitemap"
 *
 * lastmodOf("2026-03-04T05:06:07.000Z") // "2026-03-04"
 * lastmodOf(new Date("2026-03-04T23:59:59Z")) // "2026-03-04"
 * lastmodOf("not a date") // undefined
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
// oxlint-disable-next-line effect/prefer-option-over-null -- XML render seam: the result is interpolated into an optional `<lastmod>` element, and `undefined` is what `renderUrl` reads as "omit the element" — the same shape `SitemapUrl.lastmod` carries.
export const lastmodOf = (value: unknown): string | undefined => {
  if (Predicate.isDate(value))
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (Predicate.isString(value) && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return undefined;
};

/**
 * One `<url>` element on `base` (the canonical origin, never the request
 * origin — CANON-001).
 *
 * @example
 * ```ts
 * import { renderUrl } from "@thomasfosterau/effect-web-sitemap"
 *
 * renderUrl("https://example.com", { path: "/posts/1", lastmod: "2026-03-04" })
 * // "<url><loc>https://example.com/posts/1</loc><lastmod>2026-03-04</lastmod></url>"
 * renderUrl("https://example.com", { path: "/" }) // "<url><loc>https://example.com/</loc></url>"
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderUrl = (base: string, entry: SitemapUrl): string => {
  const loc = new URL(entry.path, base).toString();
  const lastmod = entry.lastmod === undefined ? "" : `<lastmod>${entry.lastmod}</lastmod>`;
  return `<url><loc>${loc}</loc>${lastmod}</url>`;
};

/**
 * The XML declaration and `<urlset>` opening tag that begin every sitemap
 * ({@link renderSitemap}, and the first chunk of {@link sitemapStream}).
 *
 * @since 0.1.0
 * @category constants
 */
export const URLSET_OPEN = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

/**
 * The `<urlset>` closing tag that ends every sitemap ({@link renderSitemap},
 * and the last chunk of {@link sitemapStream}).
 *
 * @since 0.1.0
 * @category constants
 */
export const URLSET_CLOSE = `</urlset>`;

/**
 * The whole `sitemap.xml` on `base`, materialised. For a bounded set
 * (static shells plus a `LIMIT`ed enumeration); {@link sitemapStream} for a
 * large one.
 *
 * @example
 * ```ts
 * import { renderSitemap } from "@thomasfosterau/effect-web-sitemap"
 *
 * renderSitemap("https://example.com", [{ path: "/" }, { path: "/posts/1", lastmod: "2026-03-04" }])
 * // '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/posts/1</loc><lastmod>2026-03-04</lastmod></url></urlset>'
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderSitemap = (base: string, entries: Iterable<SitemapUrl>): string =>
  [
    URLSET_OPEN,
    ...Arr.map(Arr.fromIterable(entries), (entry) => renderUrl(base, entry)),
    URLSET_CLOSE,
  ].join("");

/**
 * The `sitemap.xml` as a `Stream` of text chunks — the opening, one chunk
 * per entry as the source yields it, the closing — so a large enumeration
 * is never materialised in the isolate before the first byte goes out
 * (website's `routes/sitemap.xml/+server.ts`). Run the enumeration before
 * the response is constructed when it needs a database: the body stream
 * must not touch a per-request runtime that is tearing down.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { sitemapStream } from "@thomasfosterau/effect-web-sitemap"
 *
 * const chunks = await Effect.runPromise(
 *   Stream.runCollect(sitemapStream("https://example.com", Stream.fromIterable([{ path: "/a" }, { path: "/b" }]))),
 * )
 * chunks.length // 4 — open, two entries, close
 * ```
 *
 * @since 0.1.0
 * @category streaming
 */
export const sitemapStream = <E, R>(
  base: string,
  entries: Stream.Stream<SitemapUrl, E, R>,
): Stream.Stream<string, E, R> =>
  Stream.concat(
    Stream.concat(
      Stream.succeed(URLSET_OPEN),
      Stream.map(entries, (entry) => renderUrl(base, entry)),
    ),
    Stream.succeed(URLSET_CLOSE),
  );

/**
 * The streamed `sitemap.xml` as an `HttpServerResponse` with the
 * `application/xml` type, {@link LOW_CHURN_CACHE_CONTROL} and, when given,
 * the `Cache-Tag` a mutation purges.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { SITEMAP_CACHE_TAG, sitemapResponse } from "@thomasfosterau/effect-web-sitemap"
 *
 * const response = sitemapResponse("https://example.com", Stream.fromIterable([{ path: "/" }]), { cacheTag: SITEMAP_CACHE_TAG })
 * response.headers["cache-tag"] // "sitemap"
 * await HttpServerResponse.toWeb(response).text() // the XML document
 * ```
 *
 * @since 0.1.0
 * @category streaming
 */
export const sitemapResponse = <E>(
  base: string,
  entries: Stream.Stream<SitemapUrl, E>,
  options: DocumentCacheOptions = {},
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.stream(Stream.encodeText(sitemapStream(base, entries)), {
    contentType: "application/xml",
    headers: documentHeaders(options),
  });

/**
 * Splits an enumeration into sitemap-sized files (at most `size` URLs each,
 * default {@link SITEMAP_MAX_URLS}) for a sitemap index.
 *
 * @example
 * ```ts
 * import { chunkSitemap } from "@thomasfosterau/effect-web-sitemap"
 *
 * chunkSitemap([{ path: "/a" }, { path: "/b" }, { path: "/c" }], 2).map((chunk) => chunk.length) // [2, 1]
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const chunkSitemap = (
  entries: ReadonlyArray<SitemapUrl>,
  size: number = SITEMAP_MAX_URLS,
): ReadonlyArray<ReadonlyArray<SitemapUrl>> =>
  Arr.isReadonlyArrayEmpty(entries) ? [] : Arr.chunksOf(entries, size);

/**
 * A `sitemap.xml` index over several sitemap files, each a site-root-relative
 * path (`/sitemaps/posts-1.xml`) with an optional lastmod.
 *
 * @example
 * ```ts
 * import { renderSitemapIndex } from "@thomasfosterau/effect-web-sitemap"
 *
 * renderSitemapIndex("https://example.com", [{ path: "/sitemap-1.xml", lastmod: "2026-03-04" }, { path: "/sitemap-2.xml" }])
 * // '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/sitemap-1.xml</loc><lastmod>2026-03-04</lastmod></sitemap><sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap></sitemapindex>'
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderSitemapIndex = (base: string, sitemaps: Iterable<SitemapUrl>): string =>
  [
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...Arr.map(Arr.fromIterable(sitemaps), (sitemap) => {
      const loc = new URL(sitemap.path, base).toString();
      const lastmod = sitemap.lastmod === undefined ? "" : `<lastmod>${sitemap.lastmod}</lastmod>`;
      return `<sitemap><loc>${loc}</loc>${lastmod}</sitemap>`;
    }),
    `</sitemapindex>`,
  ].join("");

// ── JSON Feed 1.1 ──────────────────────────────────────────────────────

/**
 * A JSON Feed 1.1 item (the subset emitted).
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedItem {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly summary?: string;
  readonly date_published: string;
  readonly date_modified: string;
}

/**
 * A JSON Feed 1.1 document (the subset emitted).
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeed {
  readonly version: "https://jsonfeed.org/version/1.1";
  readonly title: string;
  readonly home_page_url: string;
  readonly feed_url: string;
  readonly description: string;
  readonly items: ReadonlyArray<JsonFeedItem>;
}

/**
 * One feed entry: a site-root-relative path, its timestamps and its text.
 * `title` / `summary` are `null` when the row has none (the SQL wire shape
 * the applications' enumerations produce) and omitted from the item.
 *
 * @since 0.1.0
 * @category models
 */
export interface FeedEntry {
  readonly path: string;
  /** ISO 8601 datetime of the most recent version — the item's `date_modified`. */
  readonly updatedAt: string;
  /** ISO 8601 datetime of the earliest version — the item's `date_published`. */
  readonly publishedAt: string;
  // oxlint-disable-next-line effect/prefer-option-over-null -- a wire shape: the JSON Feed row as SQL produces it (an absent `MAX(text_high)` arrives as NULL) and as `buildJsonFeed` consumes it.
  readonly title?: string | null | undefined;
  // oxlint-disable-next-line effect/prefer-option-over-null -- same wire contract as `title`.
  readonly summary?: string | null | undefined;
}

/**
 * What names a feed.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedOptions {
  /** The canonical origin (`PUBLIC_SITE_URL`), never the request origin (CANON-001 / DISC-011). */
  readonly base: string;
  readonly title: string;
  readonly description: string;
  /** The feed's own path. Defaults to `/feed.json`. */
  readonly feedPath?: string | undefined;
  /** The home page's path. Defaults to `/`. */
  readonly homePath?: string | undefined;
}

/**
 * The bound the applications put on their change-discovery feeds: "latest
 * changes", not a complete listing (DISC-010).
 *
 * @since 0.1.0
 * @category constants
 */
export const FEED_ITEM_LIMIT = 50;

/**
 * Serialises feed entries into a JSON Feed 1.1 document. Pure. Item `id`
 * and `url` are the canonical absolute URL; `title` / `summary` are
 * omitted, never `null`-valued keys, when absent; entry order is preserved
 * (the caller is responsible for newest-first).
 *
 * @example
 * ```ts
 * import { buildJsonFeed } from "@thomasfosterau/effect-web-sitemap"
 *
 * const feed = buildJsonFeed(
 *   { base: "https://example.com", title: "Example — Latest changes", description: "The 50 most recent changes." },
 *   [{ path: "/posts/1", publishedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", title: "Hello", summary: null }],
 * )
 * feed.items[0]?.url // "https://example.com/posts/1"
 * "summary" in (feed.items[0] ?? {}) // false
 * ```
 *
 * @since 0.1.0
 * @category feed
 */
export const buildJsonFeed = (
  options: JsonFeedOptions,
  entries: ReadonlyArray<FeedEntry>,
): JsonFeed => ({
  version: "https://jsonfeed.org/version/1.1",
  title: options.title,
  home_page_url: new URL(options.homePath ?? "/", options.base).toString(),
  feed_url: new URL(options.feedPath ?? "/feed.json", options.base).toString(),
  description: options.description,
  items: Arr.map(entries, (entry) => feedItem(options.base, entry)),
});

/** A {@link JsonFeedItem} under construction. */
interface MutableJsonFeedItem {
  id: string;
  url: string;
  title?: string;
  summary?: string;
  date_published: string;
  date_modified: string;
}

/** One item; `title` / `summary` are added only when the entry has them. */
const feedItem = (base: string, entry: FeedEntry): JsonFeedItem => {
  const url = new URL(entry.path, base).toString();
  const item: MutableJsonFeedItem = {
    id: url,
    url,
    date_published: entry.publishedAt,
    date_modified: entry.updatedAt,
  };
  if (entry.title !== null && entry.title !== undefined) item.title = entry.title;
  if (entry.summary !== null && entry.summary !== undefined) item.summary = entry.summary;
  return item;
};

/**
 * The `Content-Type` a JSON Feed is served with.
 *
 * @since 0.1.0
 * @category constants
 */
export const JSON_FEED_CONTENT_TYPE = "application/feed+json";

/**
 * A JSON Feed as an `HttpServerResponse`: 2-space pretty-printed (a
 * hand-readable discovery document — the applications' bytes on the wire,
 * and in every cached copy), `application/feed+json`,
 * {@link LOW_CHURN_CACHE_CONTROL} and, when given, the `Cache-Tag`.
 *
 * @example
 * ```ts
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { buildJsonFeed, FEED_CACHE_TAG, jsonFeedResponse } from "@thomasfosterau/effect-web-sitemap"
 *
 * const feed = buildJsonFeed({ base: "https://example.com", title: "t", description: "d" }, [])
 * const response = jsonFeedResponse(feed, { cacheTag: FEED_CACHE_TAG })
 * response.headers["content-type"] // "application/feed+json"
 * const text = await HttpServerResponse.toWeb(response).text()
 * text.startsWith("{\n  \"version\"") // true
 * ```
 *
 * @since 0.1.0
 * @category feed
 */
export const jsonFeedResponse = (
  feed: JsonFeed,
  options: DocumentCacheOptions = {},
): HttpServerResponse.HttpServerResponse =>
  // oxlint-disable-next-line effect/avoid-direct-json -- the served document is deliberately 2-space pretty-printed; `Schema.fromJsonString` emits compact JSON with no indent option, so encoding through a schema would change the bytes on the wire and every cached copy of them.
  HttpServerResponse.text(JSON.stringify(feed, null, 2), {
    contentType: JSON_FEED_CONTENT_TYPE,
    headers: documentHeaders(options),
  });

// ── Cache-Tag purge on mutation ────────────────────────────────────────

/**
 * The `Cache-Tag` on every `feed.json` response.
 *
 * @since 0.1.0
 * @category constants
 */
export const FEED_CACHE_TAG = "feed";

/**
 * The `Cache-Tag` on every `sitemap.xml` response.
 *
 * @since 0.1.0
 * @category constants
 */
export const SITEMAP_CACHE_TAG = "sitemap";

/**
 * Builds the applications' `purgeTagsForResourceType`: the tags a mutation
 * to one resource of `type` may have staled — both aggregate documents when
 * the type can appear in them, nothing otherwise. Deliberately decided from
 * the type alone, with no per-request visibility check: a write to an
 * always-private resource of an eligible type still purges — a wasted
 * purge, not a missed one. `eligibleTypes` are the resource-type segments
 * the documents enumerate against (the values of the app's route-segment
 * map).
 *
 * @example
 * ```ts
 * import { FEED_CACHE_TAG, makePurgeTagsForResourceType, SITEMAP_CACHE_TAG } from "@thomasfosterau/effect-web-sitemap"
 *
 * const purgeTagsForResourceType = makePurgeTagsForResourceType(["posts", "people"])
 * purgeTagsForResourceType("posts") // [SITEMAP_CACHE_TAG, FEED_CACHE_TAG]
 * purgeTagsForResourceType("comments") // []
 * ```
 *
 * @since 0.1.0
 * @category purging
 */
export const makePurgeTagsForResourceType = (
  eligibleTypes: Iterable<string>,
  tags: ReadonlyArray<string> = [SITEMAP_CACHE_TAG, FEED_CACHE_TAG],
): ((type: string) => ReadonlyArray<string>) => {
  const eligible = HashSet.fromIterable(eligibleTypes);
  return (type) => (HashSet.has(eligible, type) ? tags : []);
};

/**
 * The subset of a Cloudflare `ExecutionContext` the purge needs — narrowed
 * so a test can pass a bare `{ cache: { purge } }` rather than a platform
 * `ExecutionContext`. `cache` is absent in local dev, where Workers Cache is
 * not emulated.
 *
 * @since 0.1.0
 * @category models
 */
export interface CachePurgeContext {
  readonly cache?:
    | {
        purge(options: { readonly tags: Array<string> }): Promise<{
          readonly success: boolean;
          readonly errors: ReadonlyArray<unknown>;
        }>;
      }
    | undefined;
}

/**
 * Purges the given `Cache-Tag`s from THIS Worker's Workers Cache (a
 * `purge({ tags })` purges only the calling Worker's own cache). A no-op
 * for an empty tag list or an absent `ctx.cache`; a logged, never failing,
 * outcome otherwise — the purge call rejecting, or *resolving* with
 * `success: false` (a Cloudflare-side failure resolves rather than rejects).
 * A dropped purge must never surface on the mutation that triggered it: the
 * surface serves stale content until its own `s-maxage` elapses, the
 * accepted failure mode.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { purgeCacheTags } from "@thomasfosterau/effect-web-sitemap"
 *
 * const purged: Array<ReadonlyArray<string>> = []
 * const ctx = { cache: { purge: async ({ tags }: { tags: Array<string> }) => { purged.push(tags); return { success: true, errors: [] } } } }
 * await Effect.runPromise(purgeCacheTags(ctx, ["sitemap", "feed"]))
 * await Effect.runPromise(purgeCacheTags(undefined, ["sitemap"])) // no cache: no-op
 * purged // [["sitemap", "feed"]]
 * ```
 *
 * @since 0.1.0
 * @category purging
 */
export const purgeCacheTags = (
  ctx: CachePurgeContext | undefined,
  tags: ReadonlyArray<string>,
): Effect.Effect<void> => {
  if (Arr.isReadonlyArrayEmpty(tags)) return Effect.void;
  const cache = ctx?.cache;
  if (cache === undefined) return Effect.void;
  return Effect.tryPromise({
    try: () => cache.purge({ tags: [...tags] }),
    catch: (cause) => describeError(cause),
  }).pipe(
    Effect.flatMap((result) =>
      result.success
        ? Effect.void
        : logErrorEvent("cache-purge.rejected", { tags, errors: result.errors }),
    ),
    Effect.catch((cause) => logErrorEvent("cache-purge.failed", { tags, cause })),
  );
};

/**
 * {@link purgeCacheTags} as a `Promise`, for the plain-JS seam a front
 * door hands to `ctx.waitUntil` after the response has gone out.
 *
 * @example
 * ```ts
 * import { purgeCacheTagsPromise } from "@thomasfosterau/effect-web-sitemap"
 *
 * await purgeCacheTagsPromise(undefined, ["sitemap"]) // resolves; nothing to purge against
 * ```
 *
 * @since 0.1.0
 * @category purging
 */
export const purgeCacheTagsPromise = (
  ctx: CachePurgeContext | undefined,
  tags: ReadonlyArray<string>,
): Promise<void> =>
  // oxlint-disable-next-line effect/effect-run-in-body -- boundary: `ctx.waitUntil` takes a `Promise`, and the front door calling this is plain JS with no runtime to run it inside.
  Effect.runPromise(purgeCacheTags(ctx, tags));
