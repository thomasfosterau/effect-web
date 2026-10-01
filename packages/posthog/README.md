# @thomasfosterau/effect-web-posthog

> **Prototype.** Extracted from the `thomasfosterau/website`, `thomasfosterau/gardeneria` and `thomasfosterau/preferenceflow` applications, whose copies were byte-identical (the IaC) or differed only in the name of one environment variable (the clients). It stays `0.0.x` until the three have adopted it; the API may still move.

PostHog for Effect web applications on Cloudflare Workers: the Alchemy providers that manage a PostHog project's environment tokens, dashboards, feature flags and surveys as infrastructure; the server-side `PostHog` Effect service and the per-request `posthog-node` client it wraps; the same-origin ingest reverse proxy that keeps the browser SDK out of ad-blockers; the lazily loaded `posthog-js` client; and the event scrubber both SDKs run.

## Install

```sh
pnpm add @thomasfosterau/effect-web-posthog @thomasfosterau/effect-web effect
# plus, per entry you use:
pnpm add alchemy@2.0.0-beta.79 @distilled.cloud/posthog   # ./alchemy
pnpm add posthog-node                                       # ./server
pnpm add posthog-js                                         # ./browser
```

| Entry | What it is | Peers |
| --- | --- | --- |
| `.` | `scrubPostHogProperties` / `scrubPostHogEvent` (the shared `before_send`, SEC-PRIV-001), `resolveProjectToken` (absent or blank = analytics off), `SENSITIVE_HEADERS`, `FILTERED`. | `effect` |
| `./alchemy` | `providers()`, `Providers`; the resources `Environment`, `Dashboard`, `FeatureFlag`, `Survey` and their `*Provider` layers; `PostHogConfig` / `fromEnvironment`; `createPostHogApi` and the record types; the tagged errors `PostHogApiError`, `PostHogApiNotConfiguredError`, `PostHogUnexpectedError`; `isNotFoundError`, `withMissingAsUndefined`, `withSdkMissingAsUndefined`, `postHogResourceProvider`. | `effect`, `alchemy` (exactly `2.0.0-beta.79`), `@distilled.cloud/posthog` (>= 1.0.0-rc.12) |
| `./server` | `PostHog` / `PostHogService` / `posthogLayer`; `makePostHogClient`, `disabledPostHogClient`, `withEnvironmentProperty`; `proxyIngestRequest`, `ingestProxy`, `isIngestPath`, `FORWARDED_HEADERS`, `INGEST_METHODS`, `POSTHOG_EU_INGEST`. | `effect`, `posthog-node` |
| `./browser` | `makeAnalytics` → `Analytics` (`init`, `captureEvent`, `identifyUser`, `reset`, `captureException`), `POSTHOG_DEFAULTS`. | `effect`, `posthog-js` |

Every entry is `sideEffects: false`: no top-level statements in `dist/`. `./server` imports no alchemy; `./browser` imports no Node.

## The IaC

```ts
// alchemy.run.ts
import * as Cloudflare from "alchemy/Cloudflare";
import * as Layer from "effect/Layer";
import * as PostHog from "@thomasfosterau/effect-web-posthog/alchemy";

const providers = Layer.mergeAll(Cloudflare.providers(), PostHog.providers() /* , … */);
```

**Every alchemy resource module's `providers()` must be merged into the stack's providers** — a missing one fails intermittently at deploy with "Provider not found", and a green e2e does not prove registration. `fromEnvironment` reads `POSTHOG_HOST` (default `https://us.posthog.com`) and `POSTHOG_API_KEY` (a personal API key from the secrets store at deploy time; nothing in an agent session has one).

```ts
// packages/bindings or the stack module that declares the analytics surface
import * as PostHog from "@thomasfosterau/effect-web-posthog/alchemy";

const analytics = PostHog.Environment("Analytics", { projectId: "12345", environmentId: 67890 });
const homeDashboard = PostHog.Dashboard("HomeDashboard", {
  projectId: "12345",
  name: "Home",
  pinned: true,
});
const betaFlag = PostHog.FeatureFlag("Beta", { projectId: "12345", key: "beta", active: true });
```

Each resource is immutable along its identity (`projectId`, plus `environmentId` / `key`) and mutable everywhere else; `Dashboard`, `FeatureFlag` and `Survey` take `delete: true` to remove the PostHog object on destroy and otherwise leave it in place. Attributes are persisted alchemy state and so stay `null`-valued rather than `Option`.

## The server side

```ts
// lib/server/posthog.ts — isolate scope: the options; per request: the client
import { makePostHogClient } from "@thomasfosterau/effect-web-posthog/server";
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_PROJECT_TOKEN, PUBLIC_STAGE } from "$app/env/public";

const options = {
  token: PUBLIC_POSTHOG_PROJECT_TOKEN,
  host: PUBLIC_POSTHOG_HOST,
  stage: PUBLIC_STAGE,
};
export const makePostHog = () => makePostHogClient(options);
```

```ts
// the per-request runtime
import { posthogLayer } from "@thomasfosterau/effect-web-posthog/server";
// …
Layer.mergeAll(runtime.requestLayer(input), posthogLayer(input.posthog) /* , … */);

// an operation
const posthog = yield * PostHog;
yield * posthog.capture({ distinctId: viewer.id, event: "post_created" });
const scheduler = yield * Scheduler;
yield * scheduler.waitUntil(posthog.flush); // outlives the response
```

The client is per request on purpose: `posthog-node`'s flush pipeline parks one request's in-flight promise on the instance, every flush chains onto the previous one, the event queue is instance state, and its `waitUntil` cycle is per instance — a shared client hands one request's I/O to another, which workerd forbids (#1233). `withEnvironmentProperty` stamps `environment: <stage>` last on every event, so the stage is authoritative.

### The ingest proxy

```ts
// hooks.server.ts (SvelteKit) — answered ahead of any session or runtime work
import { isIngestPath, proxyIngestRequest } from "@thomasfosterau/effect-web-posthog/server";

if (isIngestPath(event.url.pathname)) {
  return proxyIngestRequest(event.request, { getClientAddress: () => event.getClientAddress() });
}
```

```ts
// an effect/http front door
import { ingestProxy } from "@thomasfosterau/effect-web-posthog/server";

HttpRouter.mountApp("/ingest", ingestProxy({ getClientAddress }));
```

Only `FORWARDED_HEADERS` (`accept`, `accept-encoding`, `accept-language`, `content-type`, `content-length`, `user-agent`, `referer`, `origin`) reach PostHog; `cookie` and `authorization` never do. `x-forwarded-for` is the platform-resolved client address (`CF-Connecting-IP`), never the spoofable inbound header (SEC-SSRF-005). An upstream `Set-Cookie` is stripped and the baseline security headers are stamped on the way back. Methods other than `GET` / `POST` / `OPTIONS` / `HEAD` are 405.

## The browser side

```ts
// lib/analytics.ts — nothing else in the app imports posthog-js
import { makeAnalytics } from "@thomasfosterau/effect-web-posthog/browser";
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_PROJECT_TOKEN, PUBLIC_STAGE } from "$app/env/public";

export const analytics = makeAnalytics({
  token: PUBLIC_POSTHOG_PROJECT_TOKEN,
  host: PUBLIC_POSTHOG_HOST,
  stage: PUBLIC_STAGE,
});
```

```ts
// hooks.client.ts
import { analytics } from "$lib/analytics";

export async function init() {
  analytics.init(); // fire-and-forget: awaiting it would delay hydration by exactly what the code split saves
}

export const handleError: HandleClientError = async ({ kind, error }) => {
  if ((kind === "unknown" ? 500 : error.status) !== 404) analytics.captureException(error);
};
```

The SDK is `import("posthog-js")`ed once per page load and memoised; captures made before it lands queue behind `init()` and fire in call order. Events go to `apiHost` (`/ingest`, the proxy above) with `before_send: scrubPostHogEvent` and the `environment: <stage>` super property. Every method is `void` and swallows its own failure.

## Superseded application files

| Application file | Here |
| --- | --- |
| `packages/infra-posthog/src/{Api,Config,Dashboard,Environment,FeatureFlag,ProviderUtils,Providers,Survey}.ts` (byte-identical in all three) | `./alchemy` |
| `packages/infra-posthog/src/Service.ts` | `./server` — `PostHog`, `posthogLayer` |
| `apps/web/src/lib/server/posthog.ts` (`makePostHog`, `withEnvironmentProperty`) | `./server` — `makePostHogClient`, `withEnvironmentProperty`, `disabledPostHogClient` |
| `apps/web/src/hooks.server.ts` — `FORWARDED_HEADERS`, `ingestProxy` | `./server` — `proxyIngestRequest`, `ingestProxy`, `isIngestPath` |
| `apps/web/src/lib/posthog.ts` | `.` — `scrubPostHogProperties`, `scrubPostHogEvent` |
| `apps/web/src/lib/analytics.ts` | `./browser` — `makeAnalytics` |
| `apps/web/src/hooks.client.ts` | stays in the app (SvelteKit-typed); the recipe above |
