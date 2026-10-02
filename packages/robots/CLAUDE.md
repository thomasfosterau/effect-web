# @thomasfosterau/effect-web-robots

RFC 9309 on Effect 4: the `effect-robots.txt` library ported with its API kept (`tests/library.test.ts` is its suite, verbatim), plus the crawler side (`fetchRobots`, `RobotsCache`, `evaluateRobots`, `makeRobotsChecker`) and the serving side (`robotsBody`) the applications built on it.

## Boundary

Peer: `effect` only. Imports nothing from this workspace (`.fallowrc.json` zone `robots`, no outbound rule).

## Invariants

- **`parse` never throws and `encode(parse(x))` is canonical**: unknown lines dropped, orphan rules dropped, `#` comments, CRLF. `productionBody` renders through `encode` so a served document always round-trips.
- **`isAllowed` strips the query string; `evaluateRobots` matches it.** The library's `isAllowed` keeps effect-robots.txt's behaviour; the crawler decision follows the applications, where `?tab=` paths were disallowable. Both strip the fragment.
- **Every non-production stage serves `NON_PRODUCTION_BODY`** whatever the policy says (ROBOTS-005); `robotsBody` takes `production: boolean`, never reads an environment.
- **The 500 KiB cap, the 24 h / 1 h TTLs and the 30 s crawl-delay cap are the applications' numbers**, exported as constants so a consumer's tests can pin them.
- **The checker takes the request header, the token and the cache** as parameters: no crawl-job shape, KV binding or stage name lives here.

## Terms

- **Product token** — the `User-agent:` name a group binds (`PreferenceFlowBot`), distinct from the **request header** (`PreferenceFlowBot/1.0 (+https://…)`). `makeRobotsChecker` takes both: `userAgentToken` selects the group, `userAgent` is sent.
- **Group selection** — RFC 9309 §2.2.1: the group whose token matches the crawler's exactly or as a prefix (case-insensitive), longest wins; `*` matches everything and loses to any named group. The applications matched by substring; the library's rule is the one shipped, and the README says so.
- **Failure posture** — RFC 9309 §2.3.1: 4xx / no file → no restrictions (`""`); 5xx, timeout, transport fault → unavailable (`ROBOTS_UNAVAILABLE_SENTINEL`, treated as disallow). `fetchRobots` never fails; it returns one of the three.
- **Cache seam** — `RobotsCache<R>`: per-origin `get` / `put` with a TTL, generic over its requirements. Persistent adapters (a Workers KV one, say) live in the consuming application, never here.
