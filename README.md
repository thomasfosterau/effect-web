# Effect Web

A collection of (experimental) utility libraries for using Effect with a variety of web platform standards and related technologies.

**Disclaimer:** this repository and its packages have been created using Claude Code. The API is in flux; expect churn and breaking changes.

| Package | What it is | Peers |
| --- | --- | --- |
| [`@thomasfosterau/effect-web`](packages/web/README.md) | Framework-neutral request/response utilities on `effect/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging, an allow-listed span tracer, the content-negotiation dispatch verdict, Service Worker caching strategies and listeners; browser platform APIs as Effect services (Web Locks, `navigator`, visibility, media queries, wake lock, `BroadcastChannel`, permission state) with in-memory test doubles. | `effect`; optional `@thomasfosterau/effect-jsonapi` (`./negotiate` only), optional `@effect/platform-browser` (`./browser`, `./testing` only) |
| [`@thomasfosterau/effect-robots`](packages/robots/README.md) | RFC 9309: parse, encode and match robots.txt (an API held stable by its acceptance suite), the crawler side (`fetchRobots`, the cache seam, `makeRobotsChecker`) and the served `robots.txt` body. | `effect`, `@thomasfosterau/effect-parse` |
| [`@thomasfosterau/effect-sitemap`](packages/sitemap/README.md) | `sitemap.xml` whole or streamed, the sitemap index, the JSON Feed 1.1 builder and the `Cache-Tag` purge helper. | `effect`; depends on `@thomasfosterau/effect-web` |
| [`@thomasfosterau/effect-rss-feed`](packages/rss-feed/README.md) | RSS 2.0: render the channel and its items (authored text escaped, URLs absolute on the canonical origin) and serve it behind the low-churn edge cache. | `effect` |
| [`@thomasfosterau/effect-atom-feed`](packages/atom-feed/README.md) | Atom (RFC 4287): render the feed and its entries (authored text escaped, URLs absolute on the canonical origin) and serve it behind the low-churn edge cache. | `effect` |
| [`@thomasfosterau/effect-json-feed`](packages/json-feed/README.md) | JSON Feed 1.1: build the typed document (absent members omitted, URLs absolute on the canonical origin) and serve it behind the low-churn edge cache. | `effect` |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Repository conventions are in [AGENTS.md](AGENTS.md), the release pipeline in [PUBLISHING.md](PUBLISHING.md) and the vulnerability-reporting policy in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
