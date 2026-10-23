---
"@thomasfosterau/effect-robots": minor
---

Add a refusal outcome the checker does not cache. `fetchRobots` (and so `makeRobotsChecker`) takes an optional `isRefusal: (error: HttpClientError) => boolean`; a failed request it identifies as the caller's own client refusing it (an SSRF guard, or a DNS failure inside one) gives the new `ROBOTS_REFUSED_SENTINEL` rather than `ROBOTS_UNAVAILABLE_SENTINEL`. `makeRobotsChecker` disallows that check with `ROBOTS_REFUSED_REASON` and does not cache it, while a 5xx or network failure is still cached as unavailable. Without the option, behaviour is unchanged.
