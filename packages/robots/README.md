# @thomasfosterau/effect-web-robots

The Robots Exclusion Protocol (RFC 9309) for Effect: parse, encode and match robots.txt, evaluate a crawl decision with the §2.3.1 failure posture over a pluggable cache, and build the robots.txt a site serves. The parser is the `effect-robots.txt` library ported to `effect@4` with its API kept; the **crawler side** and the **serving side** are the ones the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications built on it.

Invariant ids in doc comments (`ROBOTS-005`, `PERF-CACHE-002`, …) name rules from the source applications' specs; `#NNN` citations are issues in those applications.

## Install

```sh
pnpm add @thomasfosterau/effect-web-robots effect
```

Peer: `effect` (>= 4.0.0-rc.118). One entry, `sideEffects: false`, no top-level statements in `dist/`.

## Usage

### The library (effect-robots.txt, ported)

```ts
import {
  encode,
  getCrawlDelay,
  getSitemaps,
  isAllowed,
  parse,
} from "@thomasfosterau/effect-web-robots";

const robotsTxt = parse(`
  User-agent: *
  Disallow: /admin
  Allow: /admin/public
  Crawl-delay: 10

  Sitemap: https://example.com/sitemap.xml
`);

isAllowed(robotsTxt, "MyBot", "/admin"); // false
isAllowed(robotsTxt, "MyBot", "/admin/public"); // true
getCrawlDelay(robotsTxt, "MyBot"); // 10
getSitemaps(robotsTxt); // ["https://example.com/sitemap.xml"]
encode(robotsTxt); // the canonical text
```

| Export | What it is |
| --- | --- |
| `Rule`, `RobotGroup`, `RobotsTxt` | `Data.Class` values with structural equality. `RobotGroup.crawlDelay` is `number \| undefined`. |
| `RuleSchema`, `RobotGroupSchema`, `RobotsTxtSchema` | `Schema.instanceOf` of each class. |
| `RobotsTxtFromString` | `Schema.String` → `RobotsTxt`: the parser is the decode, the encoder the encode. `Schema.decodeUnknownEffect(RobotsTxtFromString)(text)` for the Effect form. |
| `parse(text)`, `encode(robotsTxt)` | The synchronous forms. `parse` never throws: unknown lines are ignored, rules before any `User-agent` are dropped, `#` starts a comment, CRLF is accepted. |
| `isAllowed(robotsTxt, userAgent, path)` | Group selection by the longest matching product token (exact or prefix, case-insensitive; `*` matches everything, last); rule selection by the longest matching pattern, `Allow` winning a tie; `*` wildcards and `$` anchors; a query string or fragment on `path` is stripped. No group or no matching rule means allowed. |
| `getCrawlDelay`, `getSitemaps` | The selected group's `Crawl-delay` as an `Option`; every `Sitemap:` line. |

Matching is the library's, not the applications': the apps selected a group by **substring** (`userAgent.includes(token)`); the library, following RFC 9309 §2.2.1, matches the **product token** exactly or as a prefix. A `User-agent: Google` group binds `Googlebot`; a `User-agent: bot` group does not bind `Googlebot`.

### The crawler side

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeRobotsChecker, memoryRobotsCache } from "@thomasfosterau/effect-web-robots";

class CrawlSkipped extends Schema.TaggedError<CrawlSkipped>()("CrawlSkipped", {
  reason: Schema.String,
}) {}

const check = makeRobotsChecker({
  userAgent: "PreferenceFlowBot/1.0 (+https://preferenceflow.com/bot)", // the request header
  userAgentToken: "PreferenceFlowBot", // the product token robots.txt names
  cache: memoryRobotsCache(), // or your own KV-backed adapter
});

// Effect<void, CrawlSkipped, HttpClient>
const crawl = (url: string) =>
  Effect.gen(function* () {
    const decision = yield* check(url);
    if (!decision.allowed) return yield* new CrawlSkipped({ reason: decision.reason });
    // … fetch the page, honouring decision.crawlDelaySeconds
  });
```

| Export | What it is |
| --- | --- |
| `fetchRobots(origin, { userAgent, timeout?, maxBytes? })` | `GET <origin>/robots.txt` through `HttpClient`, with RFC 9309 §2.3.1's failure posture: a 2xx body (capped at `MAX_ROBOTS_BYTES`, §2.5), an empty string for 4xx / no file (`ROBOTS_NO_RESTRICTIONS` — crawl freely), and `ROBOTS_UNAVAILABLE_SENTINEL` for 5xx, a timeout or a transport error (treat as disallow). Never fails. |
| `RobotsCache<R>` | The per-origin cache seam: `get(origin): Effect<Option<string>, never, R>`, `put(origin, value, ttlSeconds)`. `noRobotsCache` fetches every time; `memoryRobotsCache()` is a `Map` for tests; a persistent adapter (for example Workers KV) lives in the consuming application. |
| `ROBOTS_CACHE_TTL_SECONDS` (24 h), `ROBOTS_UNAVAILABLE_TTL_SECONDS` (1 h) | Cache lifetimes: a body or "no restrictions" lives a day; an unavailable verdict is retried after an hour. |
| `evaluateRobots(robotsTxt, token, path, { maxCrawlDelaySeconds? })` | The crawl decision with the reasons: `{ allowed, matchedPattern: Option<string>, crawlDelaySeconds: Option<number> }`. The path is matched **with** its query string (a `?tab=` can be disallowed) and without its fragment; the crawl delay is capped at `MAX_CRAWL_DELAY_SECONDS` (30) and dropped when not positive. |
| `makeRobotsChecker(options)` | `(url) => Effect<RobotsDecision, never, HttpClient \| R>`: cache lookup → fetch on a miss → cache the body / the sentinel with the right TTL → evaluate. `RobotsDecision` is `{ allowed: true, crawlDelaySeconds }` or `{ allowed: false, reason }` (`ROBOTS_UNAVAILABLE_REASON`, or `disallowed by robots.txt rule '<pattern>'`). |

The checker runs one `HttpClient` request per origin per cache lifetime; that `HttpClient` should be the SSRF-guarded one (`@thomasfosterau/effect-web/net`) in an application that crawls user-supplied URLs.

### The serving side

```ts
// routes/robots.txt/+server.ts
import { LOW_CHURN_CACHE_CONTROL, robotsBody } from "@thomasfosterau/effect-web-robots";
import { PUBLIC_SITE_URL, PUBLIC_STAGE } from "$env/static/public";

export const GET = () =>
  new Response(
    robotsBody(PUBLIC_STAGE === "production", {
      disallow: ["/api/", "/auth/"],
      sitemapUrl: `${PUBLIC_SITE_URL}/sitemap.xml`,
    }),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": LOW_CHURN_CACHE_CONTROL,
      },
    },
  );
```

| Export | What it is |
| --- | --- |
| `NON_PRODUCTION_BODY` | `User-agent: *` / `Disallow: /` — every non-production stage is invisible to crawlers, whatever the policy says (ROBOTS-005). |
| `productionBody({ disallow, sitemapUrl, comments? })` | The production document: the comment lines, a `User-agent: *` group with each `disallow` prefix, the `Sitemap:` line. Rendered through `encode`, so it round-trips through `parse`. |
| `robotsBody(production, policy)` | The stage switch. |
| `LOW_CHURN_CACHE_CONTROL` | `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400` — the edge caches the document an hour (PERF-CACHE-002). |
| `isRobotsBody(value)` | A refinement for a test or a handler. |

## License

MIT — see [LICENSE](LICENSE).
