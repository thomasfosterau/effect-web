# @thomasfosterau/effect-sitemap

Sitemap, sitemap index and JSON Feed 1.1 builders for Effect web applications (rendered or streamed), the low-churn edge cache policy they share, and the `Cache-Tag` purge-on-mutation seam.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-web/blob/main/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

## Install

```sh
pnpm add @thomasfosterau/effect-sitemap @thomasfosterau/effect-web effect
```

Peer: `effect` (>= 4.0.0-rc.118). `@thomasfosterau/effect-web` is a dependency (the purge logs through its event logger). One entry, `sideEffects: false`, no top-level statements in `dist/`.

Everything takes a **site-root-relative path** and the **canonical origin** (the configured production origin, never the request origin). `renderSitemap`, `sitemapStream` and `buildJsonFeed` resolve every URL they emit against it (CANON-001). The map from an application's resource types to its route segments (`sitemapPath`, `feedPath`) is application vocabulary and stays in the application.

## Usage

### Sitemaps

```ts
import * as Stream from "effect/Stream";
import {
  lastmodOf,
  renderSitemap,
  SITEMAP_CACHE_TAG,
  sitemapResponse,
  type SitemapUrl,
} from "@thomasfosterau/effect-sitemap";

// `base` is the canonical origin (the configured production origin); the rows are the application's.
const STATIC_PAGES: ReadonlyArray<SitemapUrl> = [{ path: "/" }, { path: "/about" }];

// Whole, for a bounded set:
const wholeSitemap = (base: string, rows: ReadonlyArray<{ id: string; updatedAt: Date }>) =>
  renderSitemap(base, [
    ...STATIC_PAGES,
    ...rows.map((row) => ({ path: `/people/${row.id}`, lastmod: lastmodOf(row.updatedAt) })),
  ]);

// Streamed, one chunk per entry, for a large one (run the enumeration before building the response):
const streamedSitemap = (base: string, entries: ReadonlyArray<SitemapUrl>) =>
  sitemapResponse(base, Stream.fromIterable(entries), { cacheTag: SITEMAP_CACHE_TAG });
```

| Export | What it is |
| --- | --- |
| `SitemapUrl` | `{ path, lastmod?: "YYYY-MM-DD" }`. |
| `lastmodOf(value)` | The day of a `Date` or an ISO string; `undefined` (omit `<lastmod>`) otherwise. A parse, never a clock read. |
| `renderUrl(base, entry)` | One `<url>`, its `<loc>` absolute on `base`. |
| `renderSitemap(base, entries)` | The whole `<urlset>` with the XML declaration, every `<loc>` absolute on `base` (CANON-001). |
| `sitemapStream(base, Stream<SitemapUrl>)` | The document as a `Stream<string>`: opening, one chunk per entry, closing — never materialised in the isolate. Every `<loc>` is absolute on `base` (CANON-001). |
| `sitemapResponse(base, stream, { cacheTag?, cacheControl? })` | The stream as an `HttpServerResponse`: `application/xml`, `LOW_CHURN_CACHE_CONTROL`, the `Cache-Tag`. |
| `chunkSitemap(entries, size = SITEMAP_MAX_URLS)`, `renderSitemapIndex(base, sitemaps)` | Past 50,000 URLs: split into files and index them. |
| `URLSET_OPEN`, `URLSET_CLOSE`, `escapeXml` | The pieces, and the escaper for any authored text a consumer decides to emit. Nothing here emits any: `<loc>` is not escaped, because every location is the canonical origin plus a path built from validated ids or a hand-written list. |

### JSON Feed 1.1

```ts
import {
  buildJsonFeed,
  FEED_CACHE_TAG,
  FEED_ITEM_LIMIT,
  jsonFeedResponse,
  type FeedEntry,
} from "@thomasfosterau/effect-sitemap";

// `rows` are the newest FEED_ITEM_LIMIT changes, newest first.
const feedResponse = (base: string, rows: ReadonlyArray<FeedEntry>) =>
  jsonFeedResponse(
    buildJsonFeed(
      {
        base,
        title: "Example — Latest changes",
        description: `The ${FEED_ITEM_LIMIT} most recent changes.`,
      },
      rows,
    ),
    { cacheTag: FEED_CACHE_TAG },
  );
```

| Export | What it is |
| --- | --- |
| `FeedEntry` | `{ path, publishedAt, updatedAt, title?: string \| null, summary?: string \| null }` — the SQL wire shape, `null` for an absent text. |
| `buildJsonFeed({ base, title, description, feedPath? = "/feed.json", homePath? = "/" }, entries)` | The document. Item `id` and `url` are the canonical URL on `base`, never the request origin (CANON-001); `title` / `summary` are omitted, never `null`-valued; order is the caller's (newest-first). |
| `FEED_ITEM_LIMIT` (50) | The item bound: a change-discovery feed, not a corpus listing (DISC-010). |
| `jsonFeedResponse(feed, { cacheTag?, cacheControl? })` | 2-space pretty-printed `application/feed+json` with the cache headers. The indent is part of the bytes on the wire and in every cached copy. |
| `JsonFeed`, `JsonFeedItem`, `JSON_FEED_CONTENT_TYPE` | The shapes and the media type. |

### Cache-Tag purge on mutation

```ts
import {
  makePurgeTagsForResourceType,
  purgeCacheTags,
  type CachePurgeContext,
} from "@thomasfosterau/effect-sitemap";

// The resource types the sitemap and feed enumerate.
const purgeTagsForResourceType = makePurgeTagsForResourceType(["posts", "people"]);

// After a mutation to a resource of `type` (and after the response has gone out):
const purgeAfterMutation = (ctx: CachePurgeContext, type: string) =>
  purgeCacheTags(ctx, purgeTagsForResourceType(type));
```

| Export | What it is |
| --- | --- |
| `FEED_CACHE_TAG` (`feed`), `SITEMAP_CACHE_TAG` (`sitemap`) | The tags the responses carry and the purge names. |
| `makePurgeTagsForResourceType(eligibleTypes, tags?)` | `(type) => tags`: both tags for a type the documents enumerate, none otherwise — decided from the type alone, no visibility check (a wasted purge over a missed one). |
| `CachePurgeContext` | The `{ cache?: { purge({ tags }) } }` subset of a Workers `ExecutionContext`; `cache` is absent in local dev. |
| `purgeCacheTags(ctx, tags)` | `Effect<void>`: a no-op for no tags or no `cache`; a logged `cache-purge.rejected` (`success: false`) or `cache-purge.failed` (rejection), never a failure — the mutation never sees a dropped purge. The purge half of PERF-CACHE-002. |
| `purgeCacheTagsPromise(ctx, tags)` | The same as a `Promise`, for `ctx.waitUntil`. |
| `LOW_CHURN_CACHE_CONTROL` | The document `Cache-Control` (an hour at the edge, a day stale-while-revalidate): the explicit edge TTL of PERF-CACHE-002. |

## License

MIT — see [LICENSE](LICENSE).
