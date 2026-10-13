---
"@thomasfosterau/effect-sitemap": patch
---

Documentation: invariant ids in doc comments now sit on the exports that enforce them. CANON-001 moves from `renderUrl` and the `JsonFeedOptions.base` field to `renderSitemap`, `sitemapStream` and `buildJsonFeed`, and `purgeCacheTags` cites PERF-CACHE-002. No code changes.
