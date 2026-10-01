# @thomasfosterau/effect-web-sitemap

The discovery documents the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications serve, and the cache they live behind: `sitemap.xml` (rendered whole, or streamed), a sitemap index, `feed.json` (JSON Feed 1.1), and the `Cache-Tag` purge a mutation issues so the edge copies stay fresh.

Every export's doc comment names the application behaviour it carries and the invariant id it honours (`CANON-001`, `DISC-010`, `DISC-011`, `PERF-CACHE-002`); those ids and the `#NNN` issue citations point at the applications' specs.

## Install

```sh
pnpm add @thomasfosterau/effect-web-sitemap @thomasfosterau/effect-web effect
```

Peer: `effect` (>= 4.0.0-rc.118). `@thomasfosterau/effect-web` is a dependency (the purge logs through its event logger). One entry, `sideEffects: false`, no top-level statements in `dist/`.

Everything takes a **site-root-relative path** and the **canonical origin** (`PUBLIC_SITE_URL`, never the request origin — CANON-001). The map from an application's resource types to its route segments (`sitemapPath`, `feedPath`) is application vocabulary and stays in the application.

## Sitemaps

```ts
import {
  lastmodOf,
  renderSitemap,
  SITEMAP_CACHE_TAG,
  sitemapResponse,
} from "@thomasfosterau/effect-web-sitemap";

// Whole, for a bounded set:
renderSitemap(base, [
  ...STATIC_PAGES,
  ...rows.map((row) => ({ path: `/people/${row.id}`, lastmod: lastmodOf(row.updatedAt) })),
]);

// Streamed, one chunk per entry, for a large one (run the enumeration before building the response):
sitemapResponse(base, Stream.fromIterable(entries), { cacheTag: SITEMAP_CACHE_TAG });
```

| Export | What it is |
| --- | --- |
| `SitemapUrl` | `{ path, lastmod?: "YYYY-MM-DD" }`. |
| `lastmodOf(value)` | The day of a `Date` or an ISO string; `undefined` (omit `<lastmod>`) otherwise. A parse, never a clock read. |
| `renderUrl(base, entry)`, `renderSitemap(base, entries)` | One `<url>`; the whole `<urlset>` with the XML declaration. Byte-identical to the applications' output. |
| `sitemapStream(base, Stream<SitemapUrl>)` | The document as a `Stream<string>`: opening, one chunk per entry, closing — never materialised in the isolate. |
| `sitemapResponse(base, stream, { cacheTag?, cacheControl? })` | The stream as an `HttpServerResponse`: `application/xml`, `LOW_CHURN_CACHE_CONTROL`, the `Cache-Tag`. |
| `chunkSitemap(entries, size = SITEMAP_MAX_URLS)`, `renderSitemapIndex(base, sitemaps)` | Past 50,000 URLs: split into files and index them. |
| `URLSET_OPEN`, `URLSET_CLOSE`, `escapeXml` | The pieces, and the escaper for any authored text a consumer decides to emit (nothing here emits any). |

## JSON Feed 1.1

```ts
import {
  buildJsonFeed,
  FEED_CACHE_TAG,
  FEED_ITEM_LIMIT,
  jsonFeedResponse,
} from "@thomasfosterau/effect-web-sitemap";

const feed = buildJsonFeed(
  {
    base,
    title: "Thomas Foster — Latest changes",
    description: `The ${FEED_ITEM_LIMIT} most recent changes.`,
  },
  rows.map((row) => ({
    path: `/posts/${row.id}`,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    title: row.title,
    summary: row.summary,
  })),
);
return jsonFeedResponse(feed, { cacheTag: FEED_CACHE_TAG });
```

| Export | What it is |
| --- | --- |
| `FeedEntry` | `{ path, publishedAt, updatedAt, title?: string \| null, summary?: string \| null }` — the SQL wire shape, `null` for an absent text. |
| `buildJsonFeed({ base, title, description, feedPath? = "/feed.json", homePath? = "/" }, entries)` | The document. Item `id` and `url` are the canonical URL; `title` / `summary` are omitted, never `null`-valued; order is the caller's (newest-first). |
| `FEED_ITEM_LIMIT` (50) | The applications' bound: a change-discovery feed, not a corpus listing (DISC-010). |
| `jsonFeedResponse(feed, { cacheTag?, cacheControl? })` | 2-space pretty-printed `application/feed+json` with the cache headers — the applications' bytes on the wire and in every cached copy. |
| `JsonFeed`, `JsonFeedItem`, `JSON_FEED_CONTENT_TYPE` | The shapes and the media type. |

## Cache-Tag purge on mutation

```ts
import { makePurgeTagsForResourceType, purgeCacheTags } from "@thomasfosterau/effect-web-sitemap";

const purgeTagsForResourceType = makePurgeTagsForResourceType(Object.values(SITEMAP_SEGMENTS));

// After a mutation to a resource of `type` (and after the response has gone out):
yield * purgeCacheTags(executionContext, purgeTagsForResourceType(type));
```

| Export | What it is |
| --- | --- |
| `FEED_CACHE_TAG` (`feed`), `SITEMAP_CACHE_TAG` (`sitemap`) | The tags the responses carry and the purge names. |
| `makePurgeTagsForResourceType(eligibleTypes, tags?)` | `(type) => tags`: both tags for a type the documents enumerate, none otherwise — decided from the type alone, no visibility check (a wasted purge over a missed one). |
| `CachePurgeContext` | The `{ cache?: { purge({ tags }) } }` subset of a Workers `ExecutionContext`; `cache` is absent in local dev. |
| `purgeCacheTags(ctx, tags)` | `Effect<void>`: a no-op for no tags or no `cache`; a logged `cache-purge.rejected` (`success: false`) or `cache-purge.failed` (rejection), never a failure — the mutation never sees a dropped purge. |
| `purgeCacheTagsPromise(ctx, tags)` | The same as a `Promise`, for `ctx.waitUntil`. |
| `LOW_CHURN_CACHE_CONTROL` | The document `Cache-Control` (an hour at the edge, a day stale-while-revalidate). |

## Superseded application files

| Application file | Here |
| --- | --- |
| `apps/web/src/lib/server/sitemap.ts` (preferenceflow, the reference) + `apps/web/src/routes/sitemap.xml/+server.ts` (all three) + `tests/unit/sitemap.test.ts` (website) | `lastmodOf`, `renderUrl`, `renderSitemap`, `sitemapStream`, `sitemapResponse`. `STATIC_PAGES` and the resource → segment map stay in the application. |
| `packages/models/src/feed.ts` + `tests/feed.test.ts` (website); `apps/web/src/routes/feed.json/+server.ts` (website, gardeneria) | `buildJsonFeed`, `FEED_ITEM_LIMIT`, `jsonFeedResponse`. |
| `apps/web/src/lib/server/cache-purge.ts` + `tests/unit/cache-purge.test.ts` (website, gardeneria) | `makePurgeTagsForResourceType`, `purgeCacheTags`, `CachePurgeContext`, the tags. |
