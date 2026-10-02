# effect-web

The `@thomasfosterau/effect-web` package family: web-facing utilities on Effect 4, extracted from the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications.

| Package | What it is | Peers |
| --- | --- | --- |
| [`@thomasfosterau/effect-web`](packages/web/README.md) | Framework-neutral request/response utilities on `effect/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging, an allow-listed span tracer, the content-negotiation dispatch verdict. | `effect`; optional `@thomasfosterau/effect-jsonapi` (`./negotiate` only) |
| [`@thomasfosterau/effect-web-robots`](packages/robots/README.md) | RFC 9309: the `effect-robots.txt` library ported to Effect 4 with its API kept, the crawler side (`fetchRobots`, the cache seam, `makeRobotsChecker`) and the served `robots.txt` body. | `effect` |
| [`@thomasfosterau/effect-web-sitemap`](packages/sitemap/README.md) | `sitemap.xml` whole or streamed, the sitemap index, the JSON Feed 1.1 builder and the `Cache-Tag` purge helper. | `effect`; depends on `@thomasfosterau/effect-web` |

Every package requires `effect@>=4.0.0-rc.118` (rc.118 moved every `effect/unstable/*` path to `effect/*`), publishes ESM with declarations, and declares `sideEffects: false`.

**Disclaimer:** this repository and its packages have been created using Claude Code. The API is in flux; expect churn and breaking changes.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Repository conventions are in [AGENTS.md](AGENTS.md), the release pipeline in [PUBLISHING.md](PUBLISHING.md) and the vulnerability-reporting policy in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
