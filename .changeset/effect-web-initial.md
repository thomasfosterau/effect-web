---
"@thomasfosterau/effect-web": minor
---

Initial release: the framework-neutral web request/response utilities extracted from the website, gardeneria and preferenceflow applications, on `effect/http`.

- `.` — response-header policies (`securityHeaders`, `stageNoindex`, `appendVary`, `responseVary` / `classifyRoute`, `ensureCacheControl`, `cacheControlForViewer`), the cross-origin mutation guard (`isCrossOriginRejected`, `crossOriginMutationRejection`), `resolveClientIp`, `describeSessionDegraded`, the JSON:API seam errors (`jsonApiErrorResponse`, `CROSS_ORIGIN_REJECTED`, `SERVICE_UNAVAILABLE`), and the Fetch adapters (`updateWebHeaders`, `applyToWebHeaders`, the `*Web` forms).
- `./net` — `isBlockedHost`, `checkUrl` / `assertAllowedUrl`, `followRedirects` / `fetchFollowingRedirects` (SEC-SSRF-003) with tagged failures.
- `./observability` — `logStructured`, `spanTracer(trackedSpanNames)`, `logEvent` / `logWarningEvent` / `logErrorEvent`, `describeError`, `deriveAuthOutcome` / `logAuthOutcome`.
- `./negotiate` — `negotiateRepresentation` / `negotiateWebRequest`, `makeApiPathMatcher` / `endpointPaths`, `makeMarkdownPathMatcher`, `requestForRouter`, `chooseNegotiatedResponse`, over `@thomasfosterau/effect-jsonapi`'s `Middleware` (optional peer).
