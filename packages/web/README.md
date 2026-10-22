# @thomasfosterau/effect-web

Framework-neutral web request/response utilities on `effect/http`: cache-control and security headers, Vary, the cross-origin guard, client IP, an SSRF-guarded fetch, structured logging and an allow-listed span tracer, with no SvelteKit, Alchemy or Cloudflare dependency, so it serves a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally. On the client side, browser platform APIs (Web Locks, `navigator`, page visibility, media queries, the screen wake lock, `BroadcastChannel`, permission state) as Effect services, alongside `@effect/platform-browser`, with in-memory test doubles for every one.

Invariant ids in doc comments and below (`CACHE-AUTH-003`, `SEC-SSRF-003`, …) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-web/blob/trunk/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

## Install

```sh
pnpm add @thomasfosterau/effect-web effect
```

`effect` (>= 4.0.0-rc.118) is a peer dependency. `@thomasfosterau/effect-jsonapi` (>= 0.16.1, the first release built on rc.118) is an **optional** peer, needed only by the `./negotiate` entry. `@effect/platform-browser` (>= 4.0.0) is an **optional** peer, needed only by the `./browser` and `./testing` entries:

```sh
pnpm add @effect/platform-browser
```

| Entry | What it is | Peers |
| --- | --- | --- |
| `.` | Response-header policies (security baseline, stage `noindex`, `Vary` discipline, the `Cache-Control` safety net and the viewer-aware policy), the cross-origin mutation guard, the trusted client address, the degraded-session report, the canonical site base, the JSON:API guard responses a front door emits at its seam, and the Fetch adapters. | `effect` |
| `./net` | The SSRF host block list, the URL safety check (as a `Result`, as a throw) and the redirect-revalidating fetch (as an `Effect` with tagged failures, as a `Promise`). | `effect` |
| `./observability` | The structured JSON-line sink on `effect/Logger`, the allow-listed span tracer on `effect/Tracer`, the `logEvent` trio, `describeError`, the `read-path.auth` signal, and the per-request metric scope with its counting client proxy. | `effect` |
| `./negotiate` | The content-negotiation dispatch verdict (HTML / JSON:API / Markdown) for a URL space shared between pages and a JSON:API, over effect-jsonapi's §5/§6 rules. | `effect`, `@thomasfosterau/effect-jsonapi` |
| `./service-worker` | Service Worker primitives: Cache Storage as typed effects, the five caching strategies, a route table that becomes a `fetch` listener, and `install` / `activate` / `message` listeners whose work runs inside `waitUntil`. | `effect` |
| `./browser` | Browser platform APIs as Effect services: `Locks` (Web Locks), `Navigator`, `PageVisibility`, `MediaQuery`, `WakeLock`, `IdleDetection`, `Battery`, `Fullscreen`, `ScreenOrientation`, `Notifications`, `Broadcast` (`BroadcastChannel`), `PermissionStatus`, and one `layer` with every live service. | `effect`, `@effect/platform-browser` |
| `./testing` | In-memory doubles for every `./browser` service and for `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions`, each with a `Control` that drives the platform; `observe` for race-free stream assertions. Runs under Node with no DOM. | `effect`, `@effect/platform-browser` |

Every entry is `sideEffects: false`: no top-level statements in `dist/`.

## Usage

### A SvelteKit hook

The helpers are written over `effect/http`'s `Headers`, `HttpServerRequest` and `HttpServerResponse`. Three adapters bridge to the Fetch types a SvelteKit `Handle` deals in: `HttpServerRequest.fromWeb` (Effect's own) for a request, `HttpServerResponse.toWeb` (Effect's own) for a whole response, and this package's `updateWebHeaders` / `applyToWebHeaders` for a header policy on a Fetch `Response`. The `*Web` functions (`crossOriginMutationRejectionWeb`, `jsonApiErrorResponseWeb`, `negotiateWebRequest`, `requestForRouterWeb`) are those adapters pre-applied.

```ts
// hooks.server.ts
import type { Handle, RequestEvent } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as Option from "effect/Option";
import {
  applyToWebHeaders,
  cacheControlForViewer,
  classifyRoute,
  crossOriginMutationRejectionWeb,
  ensureCacheControl,
  responseVary,
  securityHeaders,
  stageNoindex,
  updateWebHeaders,
} from "@thomasfosterau/effect-web";
import {
  chooseNegotiatedResponse,
  endpointPaths,
  makeApiPathMatcher,
  makeMarkdownPathMatcher,
  negotiateWebRequest,
} from "@thomasfosterau/effect-web/negotiate";

/** What the application supplies. */
interface App {
  readonly apiGroups: Parameters<typeof endpointPaths>[0]; // the served HttpApi groups
  readonly markdownSegments: ReadonlyArray<string>; // e.g. ["posts", "people"]
  readonly indexable: boolean; // true on the production stage only
  readonly authentication: Handle; // resolves `event.locals.user`
  readonly forwardJsonApi: (request: Request) => Promise<Response>;
  readonly renderMarkdown: (event: RequestEvent) => Promise<Option.Option<Response>>;
}

export const makeHandle = (app: App): Handle => {
  const isApiPath = makeApiPathMatcher(endpointPaths(app.apiGroups));
  const isMarkdownPath = makeMarkdownPathMatcher(app.markdownSegments);

  // Outermost: the post-`resolve` header stamp lands on the final response.
  const applyHeaders: Handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    applyToWebHeaders(response.headers, (headers) =>
      responseVary(
        stageNoindex(securityHeaders(headers), { indexable: app.indexable }),
        classifyRoute(event.url.pathname),
      ),
    );
    return response;
  };

  // The JSON:API forward, outside the render middleware: a cross-origin
  // mutation is refused (already `private, no-store`); anything else gets the
  // CACHE-AUTH-003 safety net, since `cacheControl` below never sees it.
  const forward: Handle = async ({ event, resolve }) => {
    if (!negotiateWebRequest(event.request, { isApiPath }).dispatch) return resolve(event);
    const rejected = crossOriginMutationRejectionWeb(event.request);
    if (Option.isSome(rejected)) return rejected.value;
    return updateWebHeaders(await app.forwardJsonApi(event.request), ensureCacheControl);
  };

  // After `authentication` (reads the resolved viewer), before `negotiate`
  // (stamps whichever representation is returned): CACHE-AUTH-003.
  const cacheControl: Handle = async ({ event, resolve }) =>
    updateWebHeaders(await resolve(event), (headers) =>
      cacheControlForViewer(headers, { viewerResolved: event.locals.user !== null }),
    );

  // Innermost: the Markdown representation, or SvelteKit's own render.
  const negotiate: Handle = async ({ event, resolve }) => {
    const verdict = negotiateWebRequest(event.request, { isApiPath, isMarkdownPath });
    if (verdict.markdown === true) {
      return chooseNegotiatedResponse(await app.renderMarkdown(event), () => resolve(event));
    }
    return resolve(event);
  };

  return sequence(applyHeaders, forward, app.authentication, cacheControl, negotiate);
};
```

A response that bypasses the middleware (an auth short-circuit) still gets the safety net: `updateWebHeaders(response, ensureCacheControl)`. A verdict with an `error` (406 / 415) is answered with `jsonApiErrorResponseWeb(verdict.error)`.

### In a browser

Every `./browser` module has the same shape: a `Context.Service` tag, a `make` over a structural `*Like` slice of the platform object, a live `layer` that reads the ambient global when it is built (never at import), a tagged error whose `reason` maps the platform's `DOMException` names, and accessors. A live layer builds in any context — a missing API degrades (`supported: false`, an `Unsupported` failure, `Option.none()`) rather than failing the layer — so one layer serves every browser, a worker and a server render.

```ts
import * as Effect from "effect/Effect";
import { Locks, Navigator, PageVisibility, layer } from "@thomasfosterau/effect-web/browser";

// One tab refreshes the session on behalf of every tab of the origin.
const refresh = Effect.gen(function* () {
  yield* Navigator.awaitOnLine;
  return yield* fetchFreshToken; // your effect
}).pipe(Locks.withLock("auth-refresh"));

// Poll only while somebody can see the page.
const poll = PageVisibility.whileVisible(syncInbox.pipe(Effect.repeat(everyMinute)));

Effect.runFork(Effect.provide(Effect.all([refresh, poll], { concurrency: 2 }), layer));
```

### Testing browser code

`./testing`'s doubles run the **real** `./browser` adapter over an in-memory platform object, so a test exercises the code that runs in the browser. Each module's `layer` provides the service and its `Control`; drive the platform through the `Control` (the double fires the events the browser would), and read back what the code under test asked of it.

```ts
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Navigator } from "@thomasfosterau/effect-web/browser";
import { TestNavigator, observe } from "@thomasfosterau/effect-web/testing";

const program = Effect.gen(function* () {
  const control = yield* TestNavigator.Control;
  // Subscribe first: `observe` returns once the stream has emitted its current value.
  const seen = yield* observe(Navigator.onLineChanges, 2);
  yield* control.setOnLine(false);
  return yield* Fiber.join(seen); // [true, false]
});

Effect.runPromise(Effect.provide(program, TestNavigator.layer()));
```

Fork-then-sleep is a race (the child may not have subscribed yet); `observe` is the sync point. `TestLocks.makeLockManager()` is one origin: build several `Locks` services over it (`Locks.make(manager.forClient("tab-b"))`) to test contention between tabs.

## API

### `.` — headers, guards, adapters

#### Header policies

Pure `(headers: Headers.Headers) => Headers.Headers` functions; compose them and apply once with `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only when something changed) or `applyToWebHeaders` (a mutable Fetch `Headers`, in place).

- `securityHeaders(headers)` — the baseline (`SECURITY_HEADER_DEFAULTS`: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`), each only when the route did not set it (SEC-HDR-001).
- `stageNoindex(headers, { indexable })` — `X-Robots-Tag: noindex` on a non-indexable stage (CANON-003). The stage decision is yours; this package reads no environment.
- `appendVary(headers, names)` — idempotent, case-insensitive; the single place that mutates `Vary`.
- `responseVary(headers, routeClass)` / `VARY_BY_ROUTE_CLASS` / `RouteVaryClass` — no `Vary` for a `"locale-invariant"` asset, `Accept` alone for a `"format-negotiated"` one, `Cookie, Accept-Language, Accept` for the `"negotiated"` surface (PERF-CACHE-001).
- `classifyRoute(pathname, classifier?)` — narrowest class first, so a locale-invariant asset never gets a locale `Vary` (PERF-CACHE-001). `classifier.isLocaleInvariantAsset` defaults to `isLocaleInvariantAsset`; `classifier.isFormatNegotiatedAsset` is application-specific (for example `GET /images/<uuid>`) and defaults to none.
- `LOCALE_INVARIANT_ASSET_PATHS`, `isOpenGraphCard`, `isLocaleInvariantAsset`, `makeLocaleInvariantAssetMatcher(paths, ...predicates)` — the default set (icons, the default share card, the public edge-cached documents), the Open Graph card predicate, and the way to build your own matcher. The set and `isOpenGraphCard` keep share images free of a locale `Vary` (OG-IMG-001).
- `ensureCacheControl(headers)` — `Cache-Control: private, no-store` (`PRIVATE_NO_STORE`) when nothing declared one: the CACHE-AUTH-003 safety net for a response that bypasses the viewer-aware policy.
- `cacheControlForViewer(headers, { viewerResolved })` — the viewer-aware policy (CACHE-AUTH-003): a resolved viewer's response is always forced to `private, no-store` (Workers Caching runs ahead of the Worker on a hit, and `Set-Cookie` cannot be relied on as its bypass); an anonymous one falls back to `ensureCacheControl`.

#### Guards and resolvers

- `isCrossOrigin(origin: Option<string>, expectedOrigin)`, `isCrossOriginRejected(request, expectedOrigin)` — the predicate an API applies per route, one for every route (a CSRF guard that differs between routes can't be audited): a present `Origin` that is not the Worker's own is refused; absent passes (a server-to-server caller). `isCrossOriginRejected` is the SEC-CSRF-001 check over a request; `expectedOrigin` is explicit because an `HttpServerRequest`'s `url` is its path.
- `crossOriginMutationRejection(request, expectedOrigin): Option<HttpServerResponse>` — the front door's SEC-CSRF-001 guard for a dispatched JSON:API request: `Some(403 CROSS_ORIGIN_REJECTED, already private, no-store)` for a cross-origin mutation, `None` to proceed. `crossOriginMutationRejectionWeb(request, expectedOrigin = new URL(request.url).origin)` over Fetch types.
- `resolveClientIp(getClientAddress): Option<string>` — the platform-resolved address or `None`, never the spoofable inbound `x-forwarded-for` (SEC-SSRF-005).
- `describeSessionDegraded(error)` / `SESSION_DEGRADED_LOG_MESSAGE` — what a fail-open session resolution reports: the fixed message plus the error for the Worker log, the error verbatim for the tracker.
- `isMutatingMethod(method)` — `POST` / `PUT` / `PATCH` / `DELETE`.
- `siteBase({ key, fallback }): Effect<string>` — the canonical site base every absolute URL about the site is built on (CANON-001): `key` (`PUBLIC_SITE_URL`) read through the ambient `ConfigProvider`, never the request origin, so a preview host still names production. Total (error channel `never`): a missing key or a provider error yields `fallback`, the application's own production origin; an invalid value yields it too, after a `site-base.invalid` warning. `normalizeSiteBase(value): Option<string>` is the check: an absolute `http(s)` URL with no credentials, path, query or fragment, returned as its origin (no trailing slash).

#### JSON:API seam errors

- `NegotiationError` (`{ status, code, title, detail }`), `CROSS_ORIGIN_REJECTED` (403 `auth.forbidden`), `SERVICE_UNAVAILABLE` (503 `unavailable`), `JSONAPI_MEDIA_TYPE`.
- `jsonApiErrorDocument(error)`, `jsonApiErrorResponse(error): HttpServerResponse`, `jsonApiErrorResponseWeb(error): Response` — the `{ errors: [...], jsonapi: { version: "1.1" } }` document.

### `./net` — the SSRF guard

- `isBlockedHost(hostname)` — loopback / internal names (trailing root dot normalised), private / link-local / CGNAT IPv4, loopback / ULA / link-local IPv6, IPv4-mapped and NAT64 literals routed through the IPv4 list. A malformed dotted quad is blocked, never allowed.
- `checkUrl(url): Result<URL, UnsafeUrl>` — http(s) only, no embedded credentials, host not blocked (SEC-SSRF-003). `UnsafeUrl` is a tagged error with `reason: "invalid" | "scheme" | "credentials" | "blocked-host"` and fixed message wording, kept stable because callers' tests pin it. `assertAllowedUrl(url): URL` is the same check for plain callers: it throws a plain `Error` carrying the message, whose `cause` is the `UnsafeUrl`.
- `followRedirects(url, init, { maxHops?, fetch? }): Effect<FollowedResponse, UnsafeUrl | RedirectRejected | FetchFailed>` — fetches with `redirect: "manual"`, re-checking the initial URL, every `Location` hop and the final URL (SEC-SSRF-003). `maxHops: 0` refuses any redirect (the shape for a POST). Pass a shared `signal` in `init` so the chain shares one deadline. `fetchFollowingRedirects(url, init, maxHops?, fetch?): Promise<FollowedResponse>` is the same for plain callers, rejecting with a plain `Error` carrying the failure's message, whose `cause` is the tagged `UnsafeUrl` / `RedirectRejected` (a `fetch` failure rejects with the original `fetch` cause instead).

### `./observability` — the read-path signals on `effect/Logger` and `effect/Tracer`

- `logStructured(payload)` — one flat JSON line through `effect/Logger`, envelope-free (`{"event":…}`, never Effect's logger envelope, so a dashboard query on the flat shape keeps working), unconditional whatever the ambient minimum log level. Safe to call from plain code: it never suspends.
- `spanTracer(trackedSpanNames): Tracer.Tracer` — logs `{ event: "span", name, durationMs, traceId, spanId, ok }` per completed span whose name is in the set, nothing for any other. **The allow-list is a required parameter, never a constant**: it replaces the tracer for the whole per-request layer, where `Effect.withSpan` has hundreds of call sites. Build it once at module scope.
- `logEvent` / `logWarningEvent` / `logErrorEvent(event, fields?)` — `Effect.logInfo` / `logWarning` / `logError` with `{ event, ...fields }` as log annotations. `describeError(error)` renders a failure as `Tag: message`, `Tag`, `message` or `String(error)`.
- `deriveAuthOutcome(facts): AuthOutcome` (`"skipped" | "resolved" | "anonymous" | "degraded"`; `"skipped"` is the credential-less fast path, PERF-CACHE-003) and `logAuthOutcome(durationMs, outcome)` — the `read-path.auth` line.
- `withRequestMetrics(fn, onSettle): Promise<A>` — runs `fn` in a fresh per-request metric scope (its own `Metric.Counter` and `MetricRegistry`, scoped through `AsyncLocalStorage`) and hands `{ count }` to `onSettle` once `fn` settles, resolved or rejected. `incrementRequestMetric(amount = 1)` adds to the active scope from any code, synchronously, and is a no-op outside one; `currentRequestMetrics(): Option<RequestMetrics>` reads it. `countingProxy(client, methodNames: ReadonlySet<string>)` counts each call of a named method on `client`, invoking it with the real client as `this` and returning its result untouched — the per-request query count, an N+1 / waterfall signal. Which methods begin a query is the caller's parameter. Emit the settled count as your own `logStructured` line (`{ event: "read-path.db", dbQueryCount: metrics.count, path }`). On Workers this needs `nodejs_compat` (it imports `node:async_hooks`).

### `./negotiate` — the dispatch verdict

- `negotiateRepresentation(request: HttpServerRequest, options): Negotiation` / `negotiateWebRequest(request: Request, options)` — reads negotiate on `Accept`, trying `text/markdown` first on a Markdown path so the page's own URL serves it (DISC-009); mutating methods on `Content-Type`, anything else is HTML; a disallowed media-type parameter answers 406 / 415 (JSONAPI-NEG-001 / JSONAPI-NEG-002). The verdict: `representation` (`"text/html" | "application/vnd.api+json" | "text/markdown"`, the normalized cache key, never the raw `Accept`: PERF-CACHE-005), `dispatch`, `markdown?`, `error?` (`NOT_ACCEPTABLE` 406 / `UNSUPPORTED_MEDIA_TYPE` 415).
- `NegotiationOptions`: `isApiPath` (required — build it with `makeApiPathMatcher(endpointPaths(groups))` from the served `HttpApi` groups, so the matcher never drifts from the surface), `isMarkdownPath?` (`makeMarkdownPathMatcher(segments)`: a `<segment>/<id>` page whose segment is listed, DISC-009), `extensions?` (the JSON:API `ext` URIs the api declares).
- `requestForRouter(request)` / `requestForRouterWeb(request)` — relabels a dispatched write's `Content-Type` to `application/json` for a router that registers JSON payloads under the default encoding.
- `chooseNegotiatedResponse(markdown: Option<A>, onHtml: () => B)` — the Markdown response or the framework's render, which runs only on `None`.
- `MARKDOWN_MEDIA_TYPE`, `Representation`, `Negotiation`.

What is adopted from `@thomasfosterau/effect-jsonapi` and what is not: the JSON:API §5/§6 media-type-parameter rule (`ext` / `profile` only; every `ext` URI must be declared) runs through `Middleware.negotiate` for a write and `Middleware.contentTypeIsAcceptable` per `Accept` instance. The **ranking** — whether the JSON:API or Markdown instance outranks every other media type the client offered (`q`, ties win, an unparsable `q` reads as `1`) — is local, because a JSON:API-only server never chooses between representations. Two consequences: an undeclared `ext` is a 406 / 415 (spec-correct), and the §6 error `code`s are effect-jsonapi's (`not_acceptable`, `unsupported_media_type`).

### `./service-worker` — caching strategies and event listeners

The two globals a worker talks to are context references with global defaults, so a worker provides nothing and a test swaps each: `Caches` (the `CacheStorage`, default `globalThis.caches`) and Effect's own `FetchHttpClient.Fetch` (default `globalThis.fetch`). Event types are structural (`FetchEventLike`, `ExtendableEventLike`, `ExtendableMessageEventLike`), so the entry compiles under the `dom` lib and the `webworker` lib's events satisfy them.

```ts
/// <reference lib="webworker" />
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  cacheFirst,
  deleteCachesExcept,
  extendableListener,
  fetchListener,
  isNavigationRequest,
  messageListener,
  networkFirst,
  precache,
  route,
  staleWhileRevalidate,
} from "@thomasfosterau/effect-web/service-worker";

declare const self: ServiceWorkerGlobalScope;
const SHELL = "shell-v3";
const CACHES = [SHELL, "pages", "assets", "images"];

// Listeners must be added while the script first evaluates, so the effects
// that build them run synchronously.
const listeners = Effect.gen(function* () {
  const onInstall = yield* extendableListener(() => precache(SHELL, ["/", "/offline", "/app.css"]));
  const onActivate = yield* extendableListener(() => deleteCachesExcept(CACHES));
  const onFetch = yield* fetchListener([
    route(isNavigationRequest, networkFirst({ cacheName: "pages", timeout: "3 seconds" })),
    route(
      (r) => new URL(r.url).pathname.startsWith("/_app/immutable/"),
      cacheFirst({ cacheName: "assets" }),
    ),
    route((r) => r.destination === "image", staleWhileRevalidate({ cacheName: "images" })),
  ]);
  const onMessage = yield* messageListener(
    Schema.Struct({ type: Schema.Literal("SKIP_WAITING") }),
    () => Effect.promise(() => self.skipWaiting()),
  );
  return { onInstall, onActivate, onFetch, onMessage };
});

const { onInstall, onActivate, onFetch, onMessage } = Effect.runSync(listeners);
self.addEventListener("install", onInstall);
self.addEventListener("activate", onActivate);
self.addEventListener("fetch", onFetch);
self.addEventListener("message", onMessage);
```

- `openCache(name): Effect<CacheHandle, CacheError>` — the cache's `match` (an `Option`), `put`, `delete`, `keys` as effects. `deleteCache(name)`, `cacheNames`, and `deleteCachesExcept(keep)` (a list or a predicate; returns the names deleted) for the `activate` sweep. Every Cache Storage rejection is a `CacheError` naming the `operation` and `cacheName`.
- `fetchRequest(request): Effect<Response, FetchFailed>` — through `FetchHttpClient.Fetch`, keeping the native `Response` that `respondWith` needs; interruption aborts. `FetchFailed` is `./net`'s class.
- `isCacheable(request, response)` — the default write-back filter: a `GET`, status `200` (so never an opaque `0` or a partial `206`), no `Vary: *`, no `Cache-Control: no-store`.
- Strategies, each `(options) => (request) => Effect<Response, …>`: `cacheFirst`, `networkFirst` (optional `timeout`: on a cache hit after it elapses the network is aborted; on a miss the network keeps its chance), `staleWhileRevalidate`, `cacheOnly` (fails with `CacheMiss`), `networkOnly`. `StrategyOptions`: `cacheName`, `cacheable?`, `matchOptions?`. Write-backs run in the background through `EventLifetime`, so the page never waits on `Cache.put`.
- `precache(cacheName, urls)` — fetches every URL with `cache: "reload"`, writes only once all are `200` (`PrecacheRejected` otherwise), so a failed `install` leaves the previous worker in charge.
- `route(match, handle)`, `fetchListener(routes)` — `match` is synchronous because `respondWith` must be called during dispatch; the first match answers, and no match leaves the request to the browser. A failed answer rejects `respondWith` (a network error to the page).
- `extendableListener(handle)` — `install` / `activate`: the effect's promise goes to `waitUntil`, so a failure fails the install. `messageListener(schema, handle)` — decodes `event.data` first; an undecodable message is logged and dropped.
- `EventLifetime` — how background work outlives a response: bound to the event's `waitUntil` inside a listener, detached outside one. Background failures are logged at `Warning`.
- Persistent notifications, shown through the worker's registration (#108 decided they live here, not in `./browser`: they outlive the page, and their events reach the worker). `Registration` is a context reference defaulting to `self.registration` (a page provides `await navigator.serviceWorker.ready`); `showNotification(title, options?)` and `getNotifications({ tag? })` fail with `ShowNotificationError` (`operation`, `reason`: `Unsupported`, `NotAllowed`, `InvalidData`, `Failed`). `notificationClickListener(schema, handle)` / `notificationCloseListener(schema, handle)` decode `notification.data` first, as `messageListener` does, and run `handle` inside `waitUntil`.
- `memoryCacheStorage({ fetch? })` — an in-memory `CacheStorage` for tests, rejecting what the browser's `put` rejects.

### `./browser` — platform services

Each module is a namespace: `import { Locks } from "@thomasfosterau/effect-web/browser"`, then `Locks.Locks` (the tag), `Locks.layer`, `Locks.make`, `Locks.withLock`, ….

- `Locks` — Web Locks. `acquire(name, { mode?, steal? }): Effect<HeldLock, LockError, Scope>` holds an origin-wide lock until the scope closes; waiting is interruptible (the request is withdrawn), and closing the scope waits for the browser to report the release. `tryAcquire` is `ifAvailable` (`None` instead of queueing). `withLock(name, options?)` runs an effect under the lock and, if another context steals it, interrupts the effect and fails `Stolen`; `withLockIfAvailable` runs it only when the lock is free (leader election). `query` is a diagnostic snapshot. `LockError.reason`: `Unsupported`, `Stolen`, `InvalidRequest`, `NotAllowed`, `InvalidState`, `Failed`.
- `Navigator` — `info` (user agent, languages, `hardwareConcurrency`, `deviceMemoryGiB`, touch points, cookies, `webdriver`, Global Privacy Control); `onLine` / `onLineChanges` / `awaitOnLine`; `languages` / `languageChanges`; `connection` / `connectionChanges` (Network Information, `None` where missing); `userActivation`; `canShare` / `share`; `sendBeacon`; `vibrate`; `storage.estimate` / `persisted` / `persist`. `NavigatorError` carries the `operation` and a `reason` (`Unsupported`, `NotAllowed`, `Aborted` — the user dismissed the share sheet, `InvalidData`, `InvalidState`, `Rejected` — the beacon was not queued, `Failed`).
- `PageVisibility` — `state`, `changes`, `awaitVisible`, and `whileVisible(effect)`: started whenever the page becomes visible, interrupted whenever it is hidden.
- `MediaQuery` — `matches(query)`, `changes(query)`, and the preference streams `colorScheme`, `reducedMotion`, `moreContrast`, `reducedData`.
- `WakeLock` — the Screen Wake Lock. `acquire` is scoped; `keepAwake(effect)` holds one lock for the effect and fails `WakeLockError` without one; `keepAwakeWhileVisible(effect)` re-acquires each time the page returns (the browser drops the lock on hide) and never fails the effect over a lock it could not get.
- `IdleDetection` — `IdleDetector` (Chromium-only, behind a permission: treat it as optional; `supported: false` is the common case). `requestPermission` (from a user gesture) returns `"granted" | "denied"`; `watch({ threshold })` is a `Stream<IdleState, IdleError>` of `{ user: "active" | "idle", screen: "locked" | "unlocked" }`, current state first, and its detector is aborted when the stream ends. `threshold` is a `Duration.Input` of at least `minimumThreshold` (one minute). `IdleError.reason`: `Unsupported`, `NotAllowed` (permission not granted, or no activation to ask with), `InvalidRequest` (threshold under a minute), `Failed`.
- `Battery` — `navigator.getBattery()` (Chromium-only; Firefox and Safari removed it). Its own service, not part of `Navigator`, because the manager is promise-acquired (once, on the first reading). `status` is an `Option<BatteryState>` — `{ charging, level (0–1), chargingTime, dischargingTime }`, the times `Option<Duration>` with the API's `Infinity` (unknown) as `None` — and `changes` follows the four change events; `None` / empty where the API is missing or `getBattery()` rejects.
- `Fullscreen` — `enter(element, options?): Effect<void, FullscreenError, Scope>` shows an element fullscreen; closing the scope calls `exitFullscreen()` only if that element is still the fullscreen one. `withFullscreen(element, options?)` is the combinator form (the user leaving with Esc does not interrupt it). `element` (`Option`) and `changes` follow `fullscreenchange`. Unprefixed API only; Safari on iPhone reads as unsupported. `FullscreenError.reason`: `Unsupported` (no API, or `fullscreenEnabled` is `false`), `NotAllowed` (no user activation, a permissions policy), `Failed`.
- `ScreenOrientation` — `type`, `angle` (`Option`), `current`, and `changes` (follows `change`; empty where missing). `lock(orientation)` is scoped and unlocks when the scope closes; `withLock(orientation)` is the combinator form, and composes inside `Fullscreen.withFullscreen`, where browsers allow a lock. `OrientationError.reason`: `Unsupported` (no API or no `lock`, or a `NotSupportedError` refusal), `NotAllowed` (`SecurityError`), `Aborted` (a newer lock superseded it), `Failed`.
- `Notifications` — the page's own `Notification`s. `permission` (`None` where unsupported); `requestPermission` returns the user's answer and fails `NotAllowed` without transient user activation; `show(title, options?): Effect<ShownNotification, NotificationError, Scope>` closes the notification when the scope closes, and its `clicks` / `closes` streams replay from when it was shown, end once it closes and fail `Failed` on the browser's `error` event; `permissionChanges` follows `PermissionStatus.changes("notifications")`. `NotificationError.reason`: `Unsupported`, `NotAllowed` (not yet granted, or no activation), `Denied`, `InvalidData`, `Failed`. Service-worker-registration notifications (`registration.showNotification`, `notificationclick`) are not here: they outlive the page and their events reach the worker, so they belong with `./service-worker`.
- `Broadcast` — `BroadcastChannel`. `channel(name, schema)` opens a scoped channel whose `publish` encodes and whose messages are decoded through the schema (an undecodable message from another tab — an older deploy — is dropped with a warning log). `subscribe` starts listening when it runs, so nothing posted before the stream is consumed is lost; `messages` listens from when it runs. `open(name)` is the undecoded form.
- `PermissionStatus` — over `@effect/platform-browser`'s `Permissions`: `state(name)`, `changes(name)` (follows the status's `change` event), `awaitGranted(name)`.
- `layer` — every live service above plus `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions`. Prefer the per-service layers where bundle size matters.

### `./testing` — doubles

- `TestLocks` — `makeLockManager({ clientId? })`, an in-memory lock manager following the Web Locks request algorithm (FIFO per name, shared/exclusive, `ifAvailable`, `steal`, `signal`, `query`), with `forClient(id)` views for other tabs; `layer(manager?)`.
- `TestNavigator` — `layer(options?)` / `make(options?)` with `Control`: `setOnLine`, `setLanguages`, `setConnection`, `setUserActivation`, and the recorded `shares`, `beacons`, `vibrations`. Options choose how `share` (`succeed` / `abort` / `deny` / `unsupported`) and `sendBeacon` (`queue` / `reject` / `unsupported`) answer.
- `TestPageVisibility`, `TestMediaQuery`, `TestWakeLock` (`held`, `requests`, `releaseAll`, `setDenied`), `TestBroadcast` (an in-memory hub with structured-clone semantics; `posted`, `deliver` a message from "another context").
- `TestIdleDetection` — `Control`: `setUser`, `setScreen` (fire `change` on running detectors), `setPermission`, `setAnswer`, `running`, `thresholds`. `TestBattery` — `Control`: `set({ charging?, level?, chargingTime?, dischargingTime? })` (fires the matching events), `requests`; options set the readings, `supported` and `reject`.
- `TestFullscreen` — `Control`: `element(id)`, `setAllowed`, `exit` (the user pressing Esc), `requests`. `TestScreenOrientation` — `Control`: `rotate(type, angle?)`, `locked`, `setRefusal`; options choose the starting orientation and whether `lock` exists.
- `TestNotifications` — `layer(options?)` / `make(options?)` with `Control`: `setPermission`, `setAnswer` (what a prompt resolves to), `setUserActivation`, `click` / `dismiss` / `fail` the `index`th notification, and the recorded `shown` and `requests`.
- `TestPermissions`, `TestClipboard`, `TestGeolocation` — doubles for the `@effect/platform-browser` services.
- `layer` — every double and every `Control` at once. `observe(stream, count)` — forks the first `count` elements and returns once the first is out.

## License

MIT — see [LICENSE](LICENSE).
