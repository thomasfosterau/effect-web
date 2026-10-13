---
"@thomasfosterau/effect-sitemap": minor
---

Initial release: the discovery documents a site serves (`sitemap.xml`, `feed.json`) and the cache they live behind, generic over each application's route map.

- Sitemaps — `lastmodOf`, `renderUrl`, `renderSitemap`, `sitemapStream` / `sitemapResponse` (streamed, never materialised in the isolate), `chunkSitemap` / `renderSitemapIndex` for a set past `SITEMAP_MAX_URLS`.
- JSON Feed 1.1 — `buildJsonFeed`, `FEED_ITEM_LIMIT`, `jsonFeedResponse`.
- Cache-Tag purge — `FEED_CACHE_TAG`, `SITEMAP_CACHE_TAG`, `makePurgeTagsForResourceType`, `purgeCacheTags` / `purgeCacheTagsPromise`, `CachePurgeContext`, `LOW_CHURN_CACHE_CONTROL`.

Peer: `effect` >= 4.0.0-rc.118; depends on `@thomasfosterau/effect-web`. Built and tested against `effect` 4.0.0; peer floor unchanged, because rc.118 is the first release whose entry points are `effect/*` (`effect/http`, `effect/http-api`; rc.118 removed `effect/unstable/*`).
