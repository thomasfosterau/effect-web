# @thomasfosterau/effect-web-sitemap

## 0.1.0

### Minor Changes

- [#11](https://github.com/thomasfosterau/effect-web/pull/11) [`2c55f4d`](https://github.com/thomasfosterau/effect-web/commit/2c55f4d9e658b1637035968b179b8bc06a3d6183) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Initial release: the discovery documents a site serves (`sitemap.xml`, `feed.json`) and the cache they live behind, generic over each application's route map.

  - Sitemaps — `lastmodOf`, `renderUrl`, `renderSitemap`, `sitemapStream` / `sitemapResponse` (streamed, never materialised in the isolate), `chunkSitemap` / `renderSitemapIndex` for a set past `SITEMAP_MAX_URLS`.
  - JSON Feed 1.1 — `buildJsonFeed`, `FEED_ITEM_LIMIT`, `jsonFeedResponse`.
  - Cache-Tag purge — `FEED_CACHE_TAG`, `SITEMAP_CACHE_TAG`, `makePurgeTagsForResourceType`, `purgeCacheTags` / `purgeCacheTagsPromise`, `CachePurgeContext`, `LOW_CHURN_CACHE_CONTROL`.

  Peer: `effect` >= 4.0.0-rc.118; depends on `@thomasfosterau/effect-web`. Built and tested against `effect` 4.0.0; peer floor unchanged, because rc.118 is the first release whose entry points are `effect/*` (`effect/http`, `effect/http-api`; rc.118 removed `effect/unstable/*`).

### Patch Changes

- [#65](https://github.com/thomasfosterau/effect-web/pull/65) [`1602c62`](https://github.com/thomasfosterau/effect-web/commit/1602c626f3ed0883d151a6bbc388ab0d49270b13) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: hovers no longer name the application files an export was ported from, and cite an invariant id only on the export that enforces it. `stageNoindex`, `LOCALE_INVARIANT_ASSET_PATHS`, `PRIVATE_NO_STORE`, `RouteVaryClass`, `CROSS_ORIGIN_REJECTED`, `MARKDOWN_MEDIA_TYPE`, `Negotiation.markdown`, `RobotsPolicy` and `JsonFeedOptions.base` drop ids they don't enforce; `responseVary` and `productionBody` now name the rules they enforce. No code changes.

- [#38](https://github.com/thomasfosterau/effect-web/pull/38) [`18f2ba1`](https://github.com/thomasfosterau/effect-web/commit/18f2ba1ef5582cea8c8e5c40d85218afa076d4fe) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: hover summaries say what `RuleSchema`, `RobotGroupSchema`, `RobotsTxtSchema`, `URLSET_OPEN` and `URLSET_CLOSE` are for; `noRobotsCache` and `isRobotsBody` carry runnable examples; `checkUrl` cites the right SSRF invariant (`SEC-SSRF-003`), `securityHeaders` and `negotiateRepresentation` name the rules they enforce, and `isOpenGraphCard` no longer cites one it doesn't.

- [#68](https://github.com/thomasfosterau/effect-web/pull/68) [`7a21a86`](https://github.com/thomasfosterau/effect-web/commit/7a21a86acf0634bf4e4402bb778e790535edae14) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: invariant ids in doc comments now sit on the exports that enforce them. CANON-001 moves from `renderUrl` and the `JsonFeedOptions.base` field to `renderSitemap`, `sitemapStream` and `buildJsonFeed`, and `purgeCacheTags` cites PERF-CACHE-002. No code changes.

- [#38](https://github.com/thomasfosterau/effect-web/pull/38) [`573d88a`](https://github.com/thomasfosterau/effect-web/commit/573d88a9cef1e5a2c215b7b84398b42ee45e5318) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tarballs ship `dist`, `README.md` and `LICENSE` only; the maintainer `CLAUDE.md` is no longer published. Everything a consumer needs is in each package's README.
- Updated dependencies [[`1602c62`](https://github.com/thomasfosterau/effect-web/commit/1602c626f3ed0883d151a6bbc388ab0d49270b13), [`18f2ba1`](https://github.com/thomasfosterau/effect-web/commit/18f2ba1ef5582cea8c8e5c40d85218afa076d4fe), [`3eda2e9`](https://github.com/thomasfosterau/effect-web/commit/3eda2e9502b4249ff932089ca44190c675ed0ff4), [`c710b95`](https://github.com/thomasfosterau/effect-web/commit/c710b95415b9554d657acba27f3b5f77f374244f), [`7a21a86`](https://github.com/thomasfosterau/effect-web/commit/7a21a86acf0634bf4e4402bb778e790535edae14), [`6abd6e2`](https://github.com/thomasfosterau/effect-web/commit/6abd6e21ac50c1a6a20514f6459593205dbc3b36), [`75c2d07`](https://github.com/thomasfosterau/effect-web/commit/75c2d07074190f777828398e141c98818a98460e), [`573d88a`](https://github.com/thomasfosterau/effect-web/commit/573d88a9cef1e5a2c215b7b84398b42ee45e5318)]:
  - @thomasfosterau/effect-web@0.1.0
