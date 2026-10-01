# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-web/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected package and version.

## Supply-chain hardening

These packages are published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm [**OIDC Trusted Publishing**](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived, workflow-bound OIDC token. There is no `NPM_TOKEN` secret to steal from CI.
- **Provenance.** Once the source repository is public, every version the release workflow publishes carries [npm provenance](https://docs.npmjs.com/generating-provenance-statements), cryptographically linking the artifact to the exact source commit and workflow. Provenance is only attached when the source repository and the package are both public, so while this repository is private `pnpm publish` skips it with a warning.
- **Install scripts disabled in the release job.** The release workflow installs dependencies with `pnpm install --frozen-lockfile --ignore-scripts`, and turns off pnpm 11's `verify-deps-before-run` for that job (`pnpm_config_verify_deps_before_run: "false"`) so a later `pnpm run` cannot silently re-install with scripts; a compromised (transitive) dependency cannot execute install hooks in the privileged publish job. The publish itself runs as `pnpm -r publish --ignore-scripts`, so no package lifecycle script (`prepublishOnly`, `prepack`, …) runs there either. No unpinned tooling is installed there: pnpm (pinned by `packageManager`) performs the OIDC exchange itself, so npm is never upgraded in the job. CI runs the workspace's own `prepare` (the `@effect/tsgo` patch the type gate needs) but only ever holds read permissions.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject malicious workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked dependencies with a cooling-off period.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; `minimumReleaseAge` holds newly published third-party versions for a day before pnpm will install them; Dependabot proposes updates for review with the same cooldown.

## Invariant ids

Doc comments, tests and READMEs cite rules from the source applications' specs by id. The table restates the ones this repo cites, as they apply to these packages; "enforced by" names the export that carries the rule and the test that pins it. A rule enforced by review has no test. An id cited only by a package held private (cloudflare, posthog) is enforced there once it publishes (effect-web#33).

| ID | Rule | Enforced by |
| --- | --- | --- |
| `CACHE-AUTH-003` | A response that resolved a viewer is stamped `Cache-Control: private, no-store` before any shared cache sees it, and a response with no declared `Cache-Control` defaults to `private, no-store`, so heuristic freshness can't cache it. | `cacheControlForViewer`, `ensureCacheControl` (`effect-web`); `packages/web/tests/cache-control.test.ts` |
| `CACHE-AUTH-005` | The KV read-through cache serves a hit, and writes a miss, only when the resource passes the publication gate; anything else falls through to the database. | `makeResourceCache`, `isPubliclyServeable` (`effect-web-cloudflare/cache`); `packages/cloudflare/tests/cache.test.ts` |
| `CANON-001` | Canonical URLs (every sitemap `<loc>`, feed item `id` / `url`) are absolute on the production origin, never the request origin. | `renderSitemap`, `sitemapStream`, `buildJsonFeed` take `base` (`effect-web-sitemap`); `packages/sitemap/tests/sitemap.test.ts`, `feed.test.ts` |
| `CANON-003` | Every response from a non-indexable stage carries `X-Robots-Tag: noindex`. | `stageNoindex` (`effect-web`); `packages/web/tests/headers.test.ts` |
| `DISC-009` | Public pages may be served as Markdown from the same URL by content negotiation. | `negotiateRepresentation`, `makeMarkdownPathMatcher` (`effect-web/negotiate`); `packages/web/tests/negotiate.test.ts` |
| `DISC-010` | The change-discovery feed is bounded to the latest changes, not a corpus listing. | `FEED_ITEM_LIMIT` (`effect-web-sitemap`); `packages/sitemap/tests/feed.test.ts` |
| `DISC-011` | Detail-page URLs are stable; the sitemap and feed emit the canonical path the application gives them. | review (`effect-web-sitemap` takes paths as given) |
| `JSONAPI-NEG-001`, `-002` | The JSON:API surface is selected by its media type, and the §6 rules answer 406 / 415 for disallowed media-type parameters. | `negotiateRepresentation` over effect-jsonapi's `Middleware` (`effect-web/negotiate`); `packages/web/tests/negotiate.test.ts` |
| `OG-IMG-001` | Share images stay edge-cacheable: they are locale-invariant, so they carry no locale `Vary`. | `isOpenGraphCard`, `LOCALE_INVARIANT_ASSET_PATHS` (`effect-web`); `packages/web/tests/headers.test.ts` |
| `PERF-BUNDLE-001` | A heavy browser runtime (`posthog-js`) is reached only by dynamic import, never from an always-loaded chunk. | `makeAnalytics`'s `load` (`effect-web-posthog/browser`); review |
| `PERF-CACHE-001` | Locale- and cookie-invariant asset routes carry no `Vary: Cookie` / `Accept-Language`; an `Accept`-negotiated asset varies on `Accept` alone. | `responseVary`, `classifyRoute` (`effect-web`); `packages/web/tests/headers.test.ts` |
| `PERF-CACHE-002` | Low-churn public documents (`robots.txt`, `sitemap.xml`, `feed.json`) declare an explicit edge TTL and are purged by `Cache-Tag` on mutation. | `LOW_CHURN_CACHE_CONTROL` (`effect-web-robots`, `effect-web-sitemap`), `purgeCacheTags`; `packages/robots/tests/serving.test.ts` |
| `PERF-CACHE-003` | A request with no credential skips session resolution; the skip is reported as `skipped`. | `deriveAuthOutcome` (`effect-web/observability`); `packages/web/tests/observability.test.ts` |
| `PERF-CACHE-004` | The KV resource cache, if written, is read-through with a TTL backstop and write-time invalidation. | `makeResourceCache` (`effect-web-cloudflare/cache`); `packages/cloudflare/tests/cache.test.ts` |
| `PERF-CACHE-005` | A URL shared by HTML and Markdown is cached by a normalized representation token, never the raw `Accept` header. | `Negotiation.representation` (`effect-web/negotiate`), `responseVary`; `packages/web/tests/negotiate.test.ts` |
| `PERF-DB-003` | Database round-trips are counted per request so a serial chain shows up in the read-path log. | `withRequestMetrics`, `logDbQueryCount` (`effect-web-cloudflare`); `packages/cloudflare/tests/metrics.test.ts` |
| `PERF-PIPE-001` | Queue work batches instead of one call per item; `sendBatch` is chunked at Cloudflare's 100-message cap. | `sendBatchChunked`, `enqueueBatchBestEffort` (`effect-web-cloudflare/queues`); `packages/cloudflare/tests/queues.test.ts` |
| `ROBOTS-002` … `-004` | The production `robots.txt` opens the site to every crawler, disallows the non-content URL spaces the application lists, and declares an absolute sitemap URL. | `productionBody` (`effect-web-robots`); `packages/robots/tests/serving.test.ts` |
| `ROBOTS-005` | Every non-production stage serves a full-disallow `robots.txt`. | `robotsBody`, `NON_PRODUCTION_BODY` (`effect-web-robots`); `packages/robots/tests/serving.test.ts` |
| `SEC-CSRF-001` | A mutating request dispatched to the JSON:API surface is refused when its `Origin` is present and not the server's own. | `isCrossOriginRejected`, `crossOriginMutationRejection` (`effect-web`); `packages/web/tests/cross-origin.test.ts` |
| `SEC-HDR-001` | Every response carries the baseline security headers, each set only when the route didn't. | `securityHeaders` (`effect-web`), applied by the ingest proxy too (`effect-web-posthog/server`); `packages/web/tests/headers.test.ts` |
| `SEC-PRIV-001` | Telemetry is scrubbed before it leaves: cookies and auth headers become `"[Filtered]"`. | `scrubPostHogProperties`, `scrubPostHogEvent` (`effect-web-posthog`); `packages/posthog/tests/scrub.test.ts` |
| `SEC-SECRET-002` | Error and log messages never embed an unbounded upstream response body. | `PostHogApiError` (`effect-web-posthog/alchemy`); `packages/posthog/tests/alchemy.test.ts` |
| `SEC-SSRF-003` | An outbound fetch re-validates the host and scheme on every redirect hop and on the final URL. | `checkUrl`, `followRedirects`, `fetchFollowingRedirects` (`effect-web/net`); `packages/web/tests/net.test.ts` |
| `SEC-SSRF-005` | A client-supplied `x-forwarded-for` is never trusted as the client IP. | `resolveClientIp` (`effect-web`), the ingest proxy (`effect-web-posthog/server`); `packages/web/tests/client-ip.test.ts` |

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are documented in [PUBLISHING.md](./PUBLISHING.md).
