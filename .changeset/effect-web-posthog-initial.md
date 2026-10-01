---
"@thomasfosterau/effect-web-posthog": patch
---

Initial prototype release: PostHog for the website, gardeneria and preferenceflow applications, extracted with the build-time values as parameters.

- `.` — `scrubPostHogProperties` / `scrubPostHogEvent` (the shared `before_send`), `resolveProjectToken`.
- `./alchemy` — the Alchemy v2 provider collection (`providers()`) and resources `Environment`, `Dashboard`, `FeatureFlag`, `Survey`; `PostHogConfig` / `fromEnvironment`; `createPostHogApi` over `@distilled.cloud/posthog` 1.0.0-rc.12's operation names; tagged errors.
- `./server` — the `PostHog` service / `posthogLayer`; `makePostHogClient` (per request), `disabledPostHogClient`, `withEnvironmentProperty`; the ingest reverse proxy as `proxyIngestRequest` (Fetch) and `ingestProxy` (an `effect/http` handler).
- `./browser` — `makeAnalytics`, the lazily loaded `posthog-js` client.

Peers: `effect`; optional `alchemy` (exactly 2.0.0-beta.79) + `@distilled.cloud/posthog`, `posthog-node`, `posthog-js`.
