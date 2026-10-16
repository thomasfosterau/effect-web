# @thomasfosterau/effect-web

## 0.2.0

### Minor Changes

- [#107](https://github.com/thomasfosterau/effect-web/pull/107) [`f0e215d`](https://github.com/thomasfosterau/effect-web/commit/f0e215de8884f7c0a1fb4701fe3ba6e8473ad1cb) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Add the `./browser` and `./testing` entries.

  `./browser` wraps browser platform APIs as Effect services, each with a `make` over a structural slice of the platform object, a live `layer` that degrades where the API is missing, a tagged error and accessors: `Locks` (Web Locks — a lock held for a `Scope`, `withLock` / `withLockIfAvailable`, steal detection), `Navigator` (connectivity, languages, network information, user activation, Web Share, `sendBeacon`, vibration, storage persistence), `PageVisibility` (`whileVisible`), `MediaQuery` (preference streams), `WakeLock` (`keepAwake`, `keepAwakeWhileVisible`), `Broadcast` (schema-typed `BroadcastChannel`) and `PermissionStatus` (permission state as a stream over `@effect/platform-browser`'s `Permissions`), plus one `layer` with every live service.

  `./testing` provides an in-memory double for every `./browser` service and for `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions` — each the real adapter over an in-memory platform object, with a `Control` service to drive it — a combined `layer`, and `observe` for race-free stream assertions.

  `@effect/platform-browser` (>= 4.0.0) is a new optional peer, needed only by these two entries.

- [#105](https://github.com/thomasfosterau/effect-web/pull/105) [`789086c`](https://github.com/thomasfosterau/effect-web/commit/789086c8b8544bbb1cd55154003c6df18474bd02) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Add the `./service-worker` entry: Cache Storage as typed effects (`openCache`, `deleteCachesExcept`, `CacheError`), the five caching strategies (`cacheFirst`, `networkFirst` with an optional timeout, `staleWhileRevalidate`, `cacheOnly`, `networkOnly`) with the `isCacheable` write-back filter, `precache`, and listeners for `fetch` (a synchronous route table), `install` / `activate` and `message` (Schema-decoded) whose work runs inside `respondWith` / `waitUntil`. `caches` and `fetch` are context references with global defaults (`Caches`, `FetchHttpClient.Fetch`); `memoryCacheStorage` is an in-memory `CacheStorage` for tests.

## 0.1.0

### Minor Changes

- [#11](https://github.com/thomasfosterau/effect-web/pull/11) [`c710b95`](https://github.com/thomasfosterau/effect-web/commit/c710b95415b9554d657acba27f3b5f77f374244f) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Initial release: the framework-neutral web request/response utilities extracted from the website, gardeneria and preferenceflow applications, on `effect/http`.

  Built and tested against `effect` 4.0.0; peer floor unchanged at `>=4.0.0-rc.118`, the first release whose entry points are `effect/*` (`effect/http`, `effect/http-api`; rc.118 removed `effect/unstable/*`). The optional `@thomasfosterau/effect-jsonapi` peer (the `./negotiate` entry) is `>=0.16.1`, the first release built on rc.118.

  - `.` — response-header policies (`securityHeaders`, `stageNoindex`, `appendVary`, `responseVary` / `classifyRoute`, `ensureCacheControl`, `cacheControlForViewer`), the cross-origin mutation guard (`isCrossOriginRejected`, `crossOriginMutationRejection`), `resolveClientIp`, `describeSessionDegraded`, the JSON:API seam errors (`jsonApiErrorResponse`, `CROSS_ORIGIN_REJECTED`, `SERVICE_UNAVAILABLE`), and the Fetch adapters (`updateWebHeaders`, `applyToWebHeaders`, the `*Web` forms).
  - `./net` — `isBlockedHost`, `checkUrl` / `assertAllowedUrl`, `followRedirects` / `fetchFollowingRedirects` (SEC-SSRF-003) with tagged failures.
  - `./observability` — `logStructured`, `spanTracer(trackedSpanNames)`, `logEvent` / `logWarningEvent` / `logErrorEvent`, `describeError`, `deriveAuthOutcome` / `logAuthOutcome`.
  - `./negotiate` — `negotiateRepresentation` / `negotiateWebRequest`, `makeApiPathMatcher` / `endpointPaths`, `makeMarkdownPathMatcher`, `requestForRouter`, `chooseNegotiatedResponse`, over `@thomasfosterau/effect-jsonapi`'s `Middleware` (optional peer).

### Patch Changes

- [#65](https://github.com/thomasfosterau/effect-web/pull/65) [`1602c62`](https://github.com/thomasfosterau/effect-web/commit/1602c626f3ed0883d151a6bbc388ab0d49270b13) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: hovers no longer name the application files an export was ported from, and cite an invariant id only on the export that enforces it. `stageNoindex`, `LOCALE_INVARIANT_ASSET_PATHS`, `PRIVATE_NO_STORE`, `RouteVaryClass`, `CROSS_ORIGIN_REJECTED`, `MARKDOWN_MEDIA_TYPE`, `Negotiation.markdown`, `RobotsPolicy` and `JsonFeedOptions.base` drop ids they don't enforce; `responseVary` and `productionBody` now name the rules they enforce. No code changes.

- [#38](https://github.com/thomasfosterau/effect-web/pull/38) [`18f2ba1`](https://github.com/thomasfosterau/effect-web/commit/18f2ba1ef5582cea8c8e5c40d85218afa076d4fe) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: hover summaries say what `RuleSchema`, `RobotGroupSchema`, `RobotsTxtSchema`, `URLSET_OPEN` and `URLSET_CLOSE` are for; `noRobotsCache` and `isRobotsBody` carry runnable examples; `checkUrl` cites the right SSRF invariant (`SEC-SSRF-003`), `securityHeaders` and `negotiateRepresentation` name the rules they enforce, and `isOpenGraphCard` no longer cites one it doesn't.

- [#88](https://github.com/thomasfosterau/effect-web/pull/88) [`3eda2e9`](https://github.com/thomasfosterau/effect-web/commit/3eda2e9502b4249ff932089ca44190c675ed0ff4) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: the type declarations no longer name the application a module was ported from. No code changes.

- [#68](https://github.com/thomasfosterau/effect-web/pull/68) [`7a21a86`](https://github.com/thomasfosterau/effect-web/commit/7a21a86acf0634bf4e4402bb778e790535edae14) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Documentation: doc comments now cite each invariant id on the export that enforces it, and the `effect-web/net` description states that the plain `Promise` / `Error` adapters throw or reject with a plain `Error` carrying the failure's message, or with a `fetch` failure's original cause. No code changes.

- [#91](https://github.com/thomasfosterau/effect-web/pull/91) [`6abd6e2`](https://github.com/thomasfosterau/effect-web/commit/6abd6e21ac50c1a6a20514f6459593205dbc3b36) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The `fetchFollowingRedirects` docs now say that the structured `cause` on a rejection can be read in the same realm only, because across `structuredClone`, `postMessage` or Workers RPC it arrives as a plain `Error` that keeps only its message.

- [#87](https://github.com/thomasfosterau/effect-web/pull/87) [`75c2d07`](https://github.com/thomasfosterau/effect-web/commit/75c2d07074190f777828398e141c98818a98460e) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `effect-web/net`: the plain adapters now attach the tagged failure as the `cause` of the plain `Error` they throw or reject with. `assertAllowedUrl` throws `new Error(message, { cause: unsafeUrl })`, and `fetchFollowingRedirects` rejects with `new Error(message, { cause })` for an `UnsafeUrl` or `RedirectRejected`, so a plain caller can read `reason` and `url` without running Effect. The message wording and the plain-`Error` prototype are unchanged, and a `fetch` failure still rejects with the original `fetch` cause.

- [#38](https://github.com/thomasfosterau/effect-web/pull/38) [`573d88a`](https://github.com/thomasfosterau/effect-web/commit/573d88a9cef1e5a2c215b7b84398b42ee45e5318) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tarballs ship `dist`, `README.md` and `LICENSE` only; the maintainer `CLAUDE.md` is no longer published. Everything a consumer needs is in each package's README.
