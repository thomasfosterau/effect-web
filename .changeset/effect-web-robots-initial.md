---
"@thomasfosterau/effect-robots": minor
---

Initial release: RFC 9309 on Effect 4.

- The library: `Rule` / `RobotGroup` / `RobotsTxt`, `RuleSchema` / `RobotGroupSchema` / `RobotsTxtSchema` / `RobotsTxtFromString`, `parse` / `encode`, `isAllowed` / `getCrawlDelay` / `getSitemaps`, with an acceptance suite that holds its API and behaviour fixed.
- The crawler side: `fetchRobots` with RFC 9309 §2.3.1's failure posture and the §2.5 size cap, the `RobotsCache` seam (`noRobotsCache`, `memoryRobotsCache`; a persistent adapter, such as a Workers KV one, lives in the consuming application), `evaluateRobots`, `makeRobotsChecker`, and the TTL / cap constants.
- The serving side, the stage-aware `robots.txt` a site serves: `robotsBody`, `productionBody`, `NON_PRODUCTION_BODY`, `LOW_CHURN_CACHE_CONTROL`.

Peer: `effect` >= 4.0.0-rc.118. Built and tested against `effect` 4.0.0; peer floor unchanged, because rc.118 is the first release whose entry points are `effect/*` (`effect/http`, `effect/http-api`; rc.118 removed `effect/unstable/*`).
