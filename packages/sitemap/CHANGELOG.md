# @thomasfosterau/effect-sitemap

## 0.2.0

### Minor Changes

- [#147](https://github.com/thomasfosterau/effect-web/pull/147) [`39fe1bc`](https://github.com/thomasfosterau/effect-web/commit/39fe1bc9b0485938bcdf4cd295cad6c69a8c3fb3) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `buildJsonFeed` / `jsonFeedResponse` are now an adapter over `@thomasfosterau/effect-json-feed` (a new dependency), and the feed they build validates as JSON Feed 1.1. `FeedEntry`, `JsonFeedOptions` and both signatures are unchanged.

  The served bytes change:

  - Every item now carries `content_text`, which JSON Feed 1.1 requires: the entry's `summary`, else its `title`, else `""`.
  - `date_published` / `date_modified` are emitted RFC 3339 in UTC. A timestamp with an offset is normalised to UTC, one without a zone reads as UTC, and one that does not parse is omitted rather than emitted invalid.

  `JsonFeed` / `JsonFeedItem` are now effect-json-feed's types, so an item's `date_published` / `date_modified` are typed optional. `JSON_FEED_CONTENT_TYPE` is effect-json-feed's constant (the same value).

### Patch Changes

- Updated dependencies [[`228bb6f`](https://github.com/thomasfosterau/effect-web/commit/228bb6fdc4540743e46368b58de4e926e1468b39), [`a28b97e`](https://github.com/thomasfosterau/effect-web/commit/a28b97efd10c938fed8610d9b6b6570c65c02c77), [`32e044f`](https://github.com/thomasfosterau/effect-web/commit/32e044f86ac5da943714d19d12828d5190cdd2b1), [`18e1967`](https://github.com/thomasfosterau/effect-web/commit/18e1967b77231fe7b930b9e2839efb0cfa9730b6), [`f0e215d`](https://github.com/thomasfosterau/effect-web/commit/f0e215de8884f7c0a1fb4701fe3ba6e8473ad1cb), [`d977b7e`](https://github.com/thomasfosterau/effect-web/commit/d977b7e6d2b123b27be4d50aac0f2c573e02b6ef), [`40d7c49`](https://github.com/thomasfosterau/effect-web/commit/40d7c49fda6f0ceab661fda246387396a4443722), [`7ec3d9c`](https://github.com/thomasfosterau/effect-web/commit/7ec3d9cceadb8d206b7119cc8e61b26eb10c9202), [`dd839f8`](https://github.com/thomasfosterau/effect-web/commit/dd839f8de55d5fdf2bc85702693f0847ef168d59), [`50889de`](https://github.com/thomasfosterau/effect-web/commit/50889dec7af207bff86954810a41706db86ab038), [`e1d84ba`](https://github.com/thomasfosterau/effect-web/commit/e1d84babe462edb9079d43ca19b464f7a7265a8a), [`aba1812`](https://github.com/thomasfosterau/effect-web/commit/aba1812caec8e7cf3fd450f2d09c0c570d5c21ed), [`448f52b`](https://github.com/thomasfosterau/effect-web/commit/448f52ba9872f48e215607883fa9884acce9dfe6), [`cd8ea52`](https://github.com/thomasfosterau/effect-web/commit/cd8ea52e03e628ae2ef6725015fc2432909510a1), [`789086c`](https://github.com/thomasfosterau/effect-web/commit/789086c8b8544bbb1cd55154003c6df18474bd02), [`f86aba6`](https://github.com/thomasfosterau/effect-web/commit/f86aba6d9e8e994c63f096f65663eed7e4e47b3f), [`9cc5a27`](https://github.com/thomasfosterau/effect-web/commit/9cc5a27e1cb2132f10fbbdd914a999df25d4d407), [`d224d12`](https://github.com/thomasfosterau/effect-web/commit/d224d1241b806e224b0d53b30b23c0eccfb5860d), [`3e32583`](https://github.com/thomasfosterau/effect-web/commit/3e32583b94d1cf0ac43813beeff3b42a28fa0faf)]:
  - @thomasfosterau/effect-web@0.2.0
  - @thomasfosterau/effect-json-feed@0.1.0

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
