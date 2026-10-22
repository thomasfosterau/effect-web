# @thomasfosterau/effect-web

The framework-neutral half of the family: request/response utilities that serve a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally — and, in `./browser` / `./testing`, browser platform APIs as Effect services with their test doubles.

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `web`, no outbound rule). Peer: `effect`; `@thomasfosterau/effect-jsonapi` is an optional peer that only the `./negotiate` entry may import; `@effect/platform-browser` is an optional peer that only the `./browser` and `./testing` entries may import. `./testing` imports `./browser`'s modules (its doubles run the real adapters); nothing outside `./testing` imports `./testing`.

## Invariants

- **No SvelteKit, Alchemy or Cloudflare dependency**, at the type level included. Anything that needs a Worker binding lives in the consuming application; anything that needs `$app/*` lives in `effect-svelte`.
- **Allow-lists and predicates are parameters**: no viewer or session shape beyond "a viewer was resolved", no route names, no span names. `spanTracer` takes its allow-list; it is never a constant.
- **The stage is the caller's**: nothing here reads an environment (`stageNoindex` takes `indexable`).
- **`logStructured` keeps the flat line shape** (`{"event":…}`), never Effect's logger envelope: the line shape is a stable output contract that log dashboards and queries key on.
- **The `Accept` `q` split is effect-jsonapi's; the weight is local.** Each `Accept` entry, trimmed and with empty `;` parts dropped, goes to `Middleware.contentTypeIsAcceptable`, which ends the media type at the first `q` (RFC 9110 §12.4.2) from the `>=0.16.1` peer floor on. The weight (the first `q`) is read locally, because effect-jsonapi exports no per-entry weight and its `acceptIsAcceptable` reads an unparsable `q` as a refusal, where `./negotiate` reads it as `1` (a malformed weight is a client bug, not a refusal). The local weight goes once effect-jsonapi exports a per-entry weight, or under #58 (whether `./negotiate` defers to effect-jsonapi's `Negotiation`).
- **The plain-`Promise` / plain-`Error` forms** (`assertAllowedUrl`, `fetchFollowingRedirects`) keep fixed message wording (the `UnsafeUrl` and `RedirectRejected` messages), stable because callers' tests pin it; the tests here pin it too. The tagged `cause` they carry is readable in the same realm only.
- **`./service-worker` touches no global at import.** `caches` and `fetch` are read through context references with global defaults (`Caches`, Effect's `FetchHttpClient.Fetch`), on first use; event types are structural so the entry compiles under `dom` without the `webworker` lib.
- **A route's `match` is synchronous.** `respondWith` must be called during dispatch, so whether a route answers can never wait on an effect; no match means no `respondWith`, and the browser fetches the request itself.
- **The page never waits on a cache write.** Strategies clone the response and hand the `put` to `EventLifetime`, which inside a listener is bound to the event's `waitUntil`; a background failure is logged, never served.
- **The ambient platform objects** (`navigator`, `document`, `matchMedia`, `BroadcastChannel`, `IdleDetector`, `globalThis` as an event target) **are read in exactly one place**, `src/internal/globals.ts`, and only from inside a live `layer`'s build — never at import, never in `make`. Every `./browser` service has a `make` over a structural `*Like` interface (the slice of the platform object it calls), so a double, a worker's own global or a test object can stand in.
- **A missing API degrades; it never fails the layer.** `supported: false` plus an `Unsupported` failure for a call, `Option.none()` for a reading, a single-value (or, with no value to report, empty) stream for a change stream. One layer serves every browser, a worker and a server render.
- **Every change stream emits the current value first, after its listeners are attached** (`internal/dom.ts` `watch`), then each change, deduplicated, on a sliding buffer. `./testing`'s `observe` relies on this; so does every test that drives a `Control`.
- **A `Scope` holds a platform resource; closing it releases the resource and waits for the platform to report the release** (a lock is free for another context once `withLock` returns). A grant that races an interruption is released, never leaked.
- **The doubles in `./testing` run the real adapter** over an in-memory platform object, and drive it through the events the browser would fire. A double never re-implements a service's logic, and its getters read live state (`Object.assign` snapshots a getter: use a small `EventTarget` subclass).
- **`./browser` does not wrap what `@effect/platform-browser` already provides** (`Clipboard`, `Geolocation`, `Permissions`, `IndexedDb`, `KeyValueStore`, workers, sockets); it builds beside or on top of them, and `./testing` doubles them.

## Terms

- **Header policy** — a pure `(headers: Headers.Headers) => Headers.Headers`. Composed, then applied once: `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only on change) or `applyToWebHeaders` (in place).
- **Fetch adapter** — the boundary to the Fetch types a SvelteKit hook deals in: Effect's own `HttpServerRequest.fromWeb` / `HttpServerResponse.toWeb`, this package's header adapters, and the `*Web` pre-applied forms.
- **Route class** — `"locale-invariant" | "format-negotiated" | "negotiated"`: what decides a response's `Vary`. Classification is injected; the locale-invariant set ships as the default.
- **Verdict** — a `Negotiation`: representation token, dispatch flag, Markdown flag, §6 error. Decided from the request line and headers alone.
- **Strategy** — `(request: Request) => Effect<Response, E, R>`: how one request is answered. The five standard ones are built from `StrategyOptions`; any function of that shape is one.
- **Event lifetime** — `EventLifetime`: where background work goes. Inside a listener it is the event's `waitUntil`; outside one, a detached fiber.
- **Ranking** — the one part of content negotiation that stays local: whether the JSON:API / Markdown instance outranks every other media type the client offered. The §5/§6 parameter rules are effect-jsonapi's.
- **`*Like` interface** — the structural slice of a platform object a `./browser` adapter calls (`LockManagerLike`, `NavigatorLike`, `DocumentLike`, …). The DOM object satisfies it; so does a double.
- **Double** — a `./testing` module: `make` (the real adapter over an in-memory platform object, plus its `Control`), `layer` (both, as a `Layer`).
- **Control** — the per-double service a test drives the platform through and reads recorded calls from.
