# effect-web

The `@thomasfosterau/effect-web` package family: web-facing utilities on Effect 4, extracted from the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications.

| Package | What it is |
| --- | --- |
| [`@thomasfosterau/effect-web`](packages/web/README.md) | Framework-neutral request/response utilities on `effect/unstable/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging, an allow-listed span tracer, the content-negotiation dispatch verdict. Peer: `effect`. |

Planned in the same workspace (one issue each): `@thomasfosterau/effect-web-cloudflare` (the Workers / Alchemy runtime scaffold, Hyperdrive, queues, the KV read-through cache, test stubs), `@thomasfosterau/effect-web-posthog` (prototype), `@thomasfosterau/effect-web-robots` and `@thomasfosterau/effect-web-sitemap`.

Every package is built against `effect@4.0.0-rc`, publishes ESM with declarations, and declares `sideEffects: false`.

**Disclaimer:** this repository and its packages have been created using Claude Code. The API is in flux; expect churn and breaking changes.

## Documentation

Each package's `README.md` is its API reference; [AGENTS.md](AGENTS.md) carries repository conventions, [CONTRIBUTING.md](CONTRIBUTING.md) the pre-PR checklist, [PUBLISHING.md](PUBLISHING.md) the release pipeline and [SECURITY.md](SECURITY.md) the vulnerability-reporting policy.
