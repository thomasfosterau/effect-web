---
"@thomasfosterau/effect-web": minor
---

Initial release: the framework-neutral web request/response utilities extracted from the website, gardeneria and preferenceflow applications, on `effect/http`.

Built against `effect` 4.0.0-rc.118, whose entry points are `effect/*` (`effect/http`, `effect/http-api`; rc.118 removed `effect/unstable/*`), so the `effect` peer floor is `>=4.0.0-rc.118`. The optional `@thomasfosterau/effect-jsonapi` peer (the `./negotiate` entry) is `>=0.16.1`, the first release built on rc.118.

- `.` — response-header policies (`securityHeaders`, `stageNoindex`, `appendVary`, `responseVary` / `classifyRoute`, `ensureCacheControl`, `cacheControlForViewer`), the cross-origin mutation guard (`isCrossOriginRejected`, `crossOriginMutationRejection`), `resolveClientIp`, `describeSessionDegraded`, the JSON:API seam errors (`jsonApiErrorResponse`, `CROSS_ORIGIN_REJECTED`, `SERVICE_UNAVAILABLE`), and the Fetch adapters (`updateWebHeaders`, `applyToWebHeaders`, the `*Web` forms).
- `./net` — `isBlockedHost`, `checkUrl` / `assertAllowedUrl`, `followRedirects` / `fetchFollowingRedirects` (SEC-SSRF-003) with tagged failures.
- `./observability` — `logStructured`, `spanTracer(trackedSpanNames)`, `logEvent` / `logWarningEvent` / `logErrorEvent`, `describeError`, `deriveAuthOutcome` / `logAuthOutcome`.
- `./negotiate` — `negotiateRepresentation` / `negotiateWebRequest`, `makeApiPathMatcher` / `endpointPaths`, `makeMarkdownPathMatcher`, `requestForRouter`, `chooseNegotiatedResponse`, over `@thomasfosterau/effect-jsonapi`'s `Middleware` (optional peer).
