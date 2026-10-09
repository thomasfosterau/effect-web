# @thomasfosterau/effect-web-sitemap

`sitemap.xml` (whole or streamed), the sitemap index, `feed.json` (JSON Feed 1.1) and the `Cache-Tag` purge a mutation issues.

## Boundary

Peer: `effect`. Depends on `@thomasfosterau/effect-web` and may import from it (`.fallowrc.json` zone `sitemap` → `web`): `logErrorEvent` / `describeError` for the purge outcome. Nothing else in the workspace imports this package.

## Invariants

- **The rendered bytes are a stable contract.** `renderSitemap` joins with `""` after the XML declaration; `jsonFeedResponse` pretty-prints with two spaces; an absent `title` / `summary` is an omitted key, never `null`. The cached copies at the edge are those bytes, so a change here is a visible change in every consumer.
- **No XML escaping on `<loc>`**: every location is the canonical origin plus a path derived from validated ids or a hand-written list. `escapeXml` exists for authored text a consumer emits; nothing here emits any.
- **`lastmodOf` is a parse, never a clock read**; `undefined` means omit the element.
- **`purgeCacheTags` never fails**: a rejection or a `success: false` is one error-level event (`cache-purge.failed` / `cache-purge.rejected`), and the mutation that triggered it completes.
- **The stream form never materialises the enumeration**: `sitemapStream` maps the source stream one entry per chunk; the caller runs any database enumeration before the response is built, never inside the body stream.

## Terms

- **Entry** — a `SitemapUrl` / `FeedEntry`: a site-root-relative `path` plus what the document needs of the row. The map from a resource type to its route segment is the application's; nothing here knows a `posts` from a `people`.
- **Canonical origin** — the `base` every URL is resolved on: `PUBLIC_SITE_URL`, never the request origin (CANON-001 / DISC-011).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag`, rather than one regenerated per request.
- **Eligible type** — a resource type the documents enumerate; a write to one purges both tags whatever the row's visibility (a wasted purge over a missed one).
