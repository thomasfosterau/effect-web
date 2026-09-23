# packages/posthog — `@thomasfosterau/effect-web-posthog`

**Prototype** (`0.0.x` until the three applications have adopted it). PostHog for the applications, in four entries with four different peers: the Alchemy IaC (`./alchemy`: `alchemy` + `@distilled.cloud/posthog`), the server client and ingest proxy (`./server`: `posthog-node`), the browser client (`./browser`: `posthog-js`), and the peer-free scrubber + token gate they share (`.`).

## Terms

- **Scrubber** — `scrubPostHogEvent`, the one `before_send` both SDKs run: `cookie` / `set-cookie` / `authorization` / `proxy-authorization` / `x-api-key` under `properties.headers`, and `properties.cookies`, become `"[Filtered]"` (SEC-PRIV-001). Defence in depth: the applications never attach raw headers.
- **Token gate** — `resolveProjectToken`: absent OR blank is `None`, "analytics off". A `Some("")` must never read as configured.
- **Per-request client** — `makePostHogClient` builds a fresh `posthog-node` client per request. A shared one is unsafe on Workers (its flush pipeline hands one request's I/O to another, #1233); only the options around it are isolate-stable.
- **Ingest proxy** — `<prefix>/*` → `eu.i.posthog.com` (`<prefix>/static/*` → the assets host), forwarding only `FORWARDED_HEADERS`, `x-forwarded-for` from the platform's resolver, answered ahead of any session work.
- **Providers** — `providers()`, the thunk every alchemy provider package exports; `alchemy.run.ts` merges it into the stack's providers, or the deploy fails intermittently with "Provider not found".

## Local invariants

- **`./server` imports no alchemy; `./browser` imports no Node** (and no `posthog-node`). `./alchemy` is deploy-time only and is imported by neither. The `.` entry imports none of the four peers.
- **`posthog-js` is reached only through `load`** (default `() => import("posthog-js")`), memoised once per `makeAnalytics`: the browser runtime must never sit in an application's always-loaded chunk (PERF-BUNDLE-001). `init()` is never awaited on the hydration path.
- **Every browser wrapper swallows its own failure.** Analytics is never load-bearing; an ad-blocked chunk must not reach the reader's console as an unhandled rejection.
- **`FORWARDED_HEADERS` is an allow-list.** Adding `cookie` or `authorization` exfiltrates the session cookie to PostHog on every analytics call.
- **Alchemy props / attributes stay `null`-valued, never `Option`.** alchemy persists them through `encodeState`, which has no `Option` codec; `Option` stops in `Api.ts`'s records.
- **`@distilled.cloud/posthog` is pinned to `1.0.0-rc.12`** and the SDK calls use its operation names (`getDashboard`, `createFeatureFlag`, `updateSurveysPartial`, …); rc.8 (website / gardeneria) names them `dashboardsRetrieve` / `featureFlagsCreate` / `surveysPartialUpdate`, and rc.9 (preferenceflow) has the new names but still calls `Config.string`, so it cannot load under effect rc.115. Re-check the names on any bump — the API surface is generated and renames between rcs.
- **The alchemy entry never runs in a test with a credential.** `tests/alchemy.test.ts` proves `providers()` builds without one and drives the client over an injected `fetch`.

## Boundary

May import from `@thomasfosterau/effect-web` (`.fallowrc.json` zone `posthog` → `web`): `resolveClientIp`, `securityHeaders` and `applyToWebHeaders` for the ingest proxy. Nothing here is imported by another package.
