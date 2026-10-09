# @thomasfosterau/effect-web-robots

## 0.1.0

### Minor Changes

- [#11](https://github.com/thomasfosterau/effect-web/pull/11) [`2c55f4d`](https://github.com/thomasfosterau/effect-web/commit/2c55f4d9e658b1637035968b179b8bc06a3d6183) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Initial release: RFC 9309 on Effect 4.

  - The library: `Rule` / `RobotGroup` / `RobotsTxt`, `RuleSchema` / `RobotGroupSchema` / `RobotsTxtSchema` / `RobotsTxtFromString`, `parse` / `encode`, `isAllowed` / `getCrawlDelay` / `getSitemaps`, with an acceptance suite that holds its API and behaviour fixed.
  - The crawler side: `fetchRobots` with RFC 9309 §2.3.1's failure posture and the §2.5 size cap, the `RobotsCache` seam (`noRobotsCache`, `memoryRobotsCache`; a persistent adapter, such as a Workers KV one, lives in the consuming application), `evaluateRobots`, `makeRobotsChecker`, and the TTL / cap constants.
  - The serving side, the stage-aware `robots.txt` a site serves: `robotsBody`, `productionBody`, `NON_PRODUCTION_BODY`, `LOW_CHURN_CACHE_CONTROL`.

  Peer: `effect` >= 4.0.0-rc.118. Built and tested against `effect` 4.0.0; peer floor unchanged, because rc.118 is the first release whose entry points are `effect/*` (`effect/http`, `effect/http-api`; rc.118 removed `effect/unstable/*`).

### Patch Changes

- [#65](https://github.com/thomasfosterau/effect-web/pull/65) [`1602c62`](https://github.com/thomasfosterau/effect-web/commit/1602c626f3ed0883d151a6bbc388ab0d49270b13) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: hovers no longer name the application files an export was ported from, and cite an invariant id only on the export that enforces it. `stageNoindex`, `LOCALE_INVARIANT_ASSET_PATHS`, `PRIVATE_NO_STORE`, `RouteVaryClass`, `CROSS_ORIGIN_REJECTED`, `MARKDOWN_MEDIA_TYPE`, `Negotiation.markdown`, `RobotsPolicy` and `JsonFeedOptions.base` drop ids they don't enforce; `responseVary` and `productionBody` now name the rules they enforce. No code changes.

- [#38](https://github.com/thomasfosterau/effect-web/pull/38) [`18f2ba1`](https://github.com/thomasfosterau/effect-web/commit/18f2ba1ef5582cea8c8e5c40d85218afa076d4fe) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: hover summaries say what `RuleSchema`, `RobotGroupSchema`, `RobotsTxtSchema`, `URLSET_OPEN` and `URLSET_CLOSE` are for; `noRobotsCache` and `isRobotsBody` carry runnable examples; `checkUrl` cites the right SSRF invariant (`SEC-SSRF-003`), `securityHeaders` and `negotiateRepresentation` name the rules they enforce, and `isOpenGraphCard` no longer cites one it doesn't.

- [#68](https://github.com/thomasfosterau/effect-web/pull/68) [`7a21a86`](https://github.com/thomasfosterau/effect-web/commit/7a21a86acf0634bf4e4402bb778e790535edae14) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: `robotsBody` now cites ROBOTS-005, the full-disallow body it serves on every non-production stage, and gives `PUBLIC_STAGE === "production"` as an example of the caller's stage decision rather than a name this package reads. No code changes.

- [#38](https://github.com/thomasfosterau/effect-web/pull/38) [`573d88a`](https://github.com/thomasfosterau/effect-web/commit/573d88a9cef1e5a2c215b7b84398b42ee45e5318) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tarballs ship `dist`, `README.md` and `LICENSE` only; the maintainer `CLAUDE.md` is no longer published. Everything a consumer needs is in each package's README.
