---
"@thomasfosterau/effect-web-sitemap": minor
---

Initial release: the discovery documents the website, gardeneria and preferenceflow applications serve, generic over each application's route map.

- Sitemaps — `lastmodOf`, `renderUrl`, `renderSitemap` (preferenceflow's factoring), `sitemapStream` / `sitemapResponse` (website's streaming route), `chunkSitemap` / `renderSitemapIndex` for a set past `SITEMAP_MAX_URLS`.
- JSON Feed 1.1 — `buildJsonFeed`, `FEED_ITEM_LIMIT`, `jsonFeedResponse`.
- Cache-Tag purge — `FEED_CACHE_TAG`, `SITEMAP_CACHE_TAG`, `makePurgeTagsForResourceType`, `purgeCacheTags` / `purgeCacheTagsPromise`, `CachePurgeContext`, `LOW_CHURN_CACHE_CONTROL`.

Peer: `effect` >= 4.0.0-rc.115; depends on `@thomasfosterau/effect-web`.
