# effect-web

The `@thomasfosterau/effect-web` package family: web-facing utilities on Effect 4, extracted from the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications.

| Package | What it is | Peers |
| --- | --- | --- |
| [`@thomasfosterau/effect-web`](packages/web/README.md) | Framework-neutral request/response utilities on `effect/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging, an allow-listed span tracer, the content-negotiation dispatch verdict. | `effect`; optional `@thomasfosterau/effect-jsonapi` (`./negotiate` only) |
| [`@thomasfosterau/effect-web-robots`](packages/robots/README.md) | RFC 9309: the `effect-robots.txt` library ported to Effect 4 with its API kept, the crawler side (`fetchRobots`, the cache seam, `makeRobotsChecker`) and the served `robots.txt` body. | `effect` |
| [`@thomasfosterau/effect-web-sitemap`](packages/sitemap/README.md) | `sitemap.xml` whole or streamed, the sitemap index, the JSON Feed 1.1 builder and the `Cache-Tag` purge helper. | `effect`; depends on `@thomasfosterau/effect-web` |
| [`@thomasfosterau/effect-web-cloudflare`](packages/cloudflare/README.md) | **Not yet published: held private until alchemy ships an Effect rc.118 build (#33).** The Cloudflare Workers / Alchemy runtime scaffold, the Hyperdrive `Database` seam, queue glue, the KV read-through resource cache, the robots.txt KV cache adapter and the in-memory binding stubs. | `effect`, `alchemy` (exact beta), optional `@cloudflare/workers-types`; depends on `@thomasfosterau/effect-web`, `@thomasfosterau/effect-web-robots` |
| [`@thomasfosterau/effect-web-posthog`](packages/posthog/README.md) | **Prototype, not yet published: held private until alchemy ships an Effect rc.118 build (#33).** PostHog: the Alchemy providers, the server-side service and `/ingest` proxy, the browser client, the event scrubber. | `effect`; optional `alchemy` + `@distilled.cloud/posthog`, `posthog-node`, `posthog-js`; depends on `@thomasfosterau/effect-web` |

Every package requires `effect@>=4.0.0-rc.118` (rc.118 moved every `effect/unstable/*` path to `effect/*`), publishes ESM with declarations, and declares `sideEffects: false`.

**Disclaimer:** this repository and its packages have been created using Claude Code. The API is in flux; expect churn and breaking changes.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Repository conventions are in [AGENTS.md](AGENTS.md), the release pipeline in [PUBLISHING.md](PUBLISHING.md) and the vulnerability-reporting policy in [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
