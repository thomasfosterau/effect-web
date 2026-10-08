# @thomasfosterau/effect-web-robots

RFC 9309 on Effect 4: the library (`parse` / `encode`, the data classes and schemas, `isAllowed` / `getCrawlDelay` / `getSitemaps`), whose API and behaviour are held fixed by its acceptance suite in `tests/library.test.ts`, plus the crawler side (`fetchRobots`, `RobotsCache`, `evaluateRobots`, `makeRobotsChecker`) and the serving side (`robotsBody`) built on it.

## Boundary

Peer: `effect` only. Imports nothing from this workspace (`.fallowrc.json` zone `robots`, no outbound rule).

## Invariants

- **`parse` never throws and `encode(parse(x))` is canonical**: unknown lines dropped, orphan rules dropped, `#` comments, CRLF. `productionBody` renders through `encode` so a served document always round-trips.
- **`isAllowed` strips the query string; `evaluateRobots` matches it.** `isAllowed` keeps the library's documented behaviour, which the acceptance suite pins; the crawler decision matches the query as RFC 9309 §2.2.2 does, so a site can disallow a `?tab=` path. Both strip the fragment.
- **Every non-production stage serves `NON_PRODUCTION_BODY`** whatever the policy says (ROBOTS-005); `robotsBody` takes `production: boolean`, never reads an environment.
- **The 500 KiB cap (RFC 9309 §2.5), the 24 h / 1 h TTLs (a directive change honoured within a day; an unavailable origin not probed on every check) and the 30 s crawl-delay cap (a hostile value cannot stall a batch) are this package's defaults**, exported as constants so a consumer's tests can pin them.
- **The checker takes the request header, the token and the cache** as parameters: no crawl-job shape, KV binding or stage name lives here.

## Terms

- **Product token** — the `User-agent:` name a group binds (`ExampleBot`), distinct from the **request header** (`ExampleBot/1.0 (+https://…)`). `makeRobotsChecker` takes both: `userAgentToken` selects the group, `userAgent` is sent.
- **Group selection** — RFC 9309 §2.2.1: the group whose token matches the crawler's exactly or as a prefix (case-insensitive), longest wins; `*` matches everything and loses to any named group. Never a substring match (`userAgent.includes(token)`): that would let `User-agent: bot` bind `Googlebot`. The README says so.
- **Failure posture** — RFC 9309 §2.3.1: 4xx / no file → no restrictions (`""`); 5xx, timeout, transport fault → unavailable (`ROBOTS_UNAVAILABLE_SENTINEL`, treated as disallow). `fetchRobots` never fails; it returns one of the three.
- **Cache seam** — `RobotsCache<R>`: per-origin `get` / `put` with a TTL, generic over its requirements. Persistent adapters (a Workers KV one, say) live in the consuming application, never here.
