/**
 * `@thomasfosterau/effect-web-posthog/browser` — the application's single
 * browser PostHog client, loaded on demand, off the critical path. Ported
 * from the applications' `apps/web/src/lib/analytics.ts` with the build-time
 * values as parameters. Peer: `posthog-js`. No Node import.
 *
 * `posthog-js` is reached by **dynamic import** (`load`, defaulting to
 * `() => import("posthog-js")`), memoised in one promise per
 * {@link makeAnalytics} call, so the runtime is fetched in parallel with
 * hydration instead of sitting in the always-loaded chunk (PERF-BUNDLE-001,
 * #1236). Nothing else in an application may import `posthog-js`.
 *
 * **`load()` is never awaited on the hydration path.** `init()` is
 * fire-and-forget: SvelteKit awaits `hooks.client.ts`'s `init()` before
 * mounting the app, so awaiting the import there would trade a bundle cost
 * for a latency cost. Captures made before the chunk lands are not lost —
 * every wrapper awaits the same memoised promise, so they queue behind
 * `posthog.init()` and fire in call order once it resolves.
 *
 * Each wrapper is `void`-returning and swallows its own failure: analytics is
 * never load-bearing, and a blocked or ad-blocked `<prefix>` must not surface
 * as an unhandled rejection in a reader's console.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import { resolveProjectToken, scrubPostHogEvent } from "../index.ts";

/**
 * The `posthog-js` singleton type.
 *
 * @since 0.1.0
 * @category models
 */
export type PostHogJs = typeof import("posthog-js").default;

/**
 * The build-time values the browser client reads, and the seams a test
 * stands in at.
 *
 * @since 0.1.0
 * @category models
 */
export interface AnalyticsOptions {
  /** The project token (`PUBLIC_POSTHOG_PROJECT_TOKEN` / `PUBLIC_POSTHOG_KEY`); absent or blank turns analytics off. */
  readonly token: string | undefined;
  /** The PostHog UI host (`PUBLIC_POSTHOG_HOST`), for toolbar links. */
  readonly host: string | undefined;
  /** The deploy stage registered as the `environment` super property (`PUBLIC_STAGE`). */
  readonly stage: string | undefined;
  /** Where the SDK sends events: the same-origin ingest proxy. Defaults to `"/ingest"`. */
  readonly apiHost?: string | undefined;
  /** Loads the SDK. Defaults to `() => import("posthog-js")`; a test injects a fake. */
  readonly load?: (() => Promise<{ readonly default: PostHogJs }>) | undefined;
}

/**
 * The browser analytics surface an application's `hooks.client.ts` and
 * components call.
 *
 * @since 0.1.0
 * @category models
 */
export interface Analytics {
  /** Starts loading and initialising PostHog. Call once from `hooks.client.ts`'s `init()`; do not await it there. */
  readonly init: () => void;
  /** Captures a product event. */
  readonly captureEvent: (event: string, properties?: Record<string, unknown>) => void;
  /** Associates subsequent events with a signed-in user. */
  readonly identifyUser: (id: string, properties?: Record<string, unknown>) => void;
  /** Clears the identity and starts a fresh anonymous session (sign-out). */
  readonly reset: () => void;
  /** Forwards a client-side exception to PostHog's error tracking. */
  readonly captureException: (error: unknown) => void;
}

/**
 * The `defaults` date the SDK's behaviour is pinned to.
 *
 * @since 0.1.0
 * @category constants
 */
export const POSTHOG_DEFAULTS = "2026-01-30";

/**
 * Builds the application's analytics surface. One call per page load, at
 * module scope of the application's `lib/analytics.ts`.
 *
 * @example
 * ```ts
 * import { makeAnalytics, type PostHogJs } from "@thomasfosterau/effect-web-posthog/browser"
 *
 * const calls: Array<string> = []
 * const fake = {
 *   init: (token: string) => { calls.push(`init ${token}`) },
 *   register: () => {},
 *   capture: (event: string) => { calls.push(`capture ${event}`) },
 *   identify: () => {},
 *   reset: () => {},
 *   captureException: () => {},
 * } as unknown as PostHogJs
 * const analytics = makeAnalytics({ token: "phc_x", host: "https://eu.posthog.com", stage: "dev", load: async () => ({ default: fake }) })
 * analytics.captureEvent("viewed") // queues behind init
 * await new Promise((resolve) => setTimeout(resolve, 0))
 * calls // ["init phc_x", "capture viewed"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeAnalytics = (options: AnalyticsOptions): Analytics => {
  const token = resolveProjectToken(options.token);
  const load = options.load ?? (() => import("posthog-js"));

  /**
   * The one in-flight / settled load, once `start()` has been called.
   * `None` is "not started yet" (the memo slot), distinct from the inner
   * `None`, which is "analytics off".
   */
  let clientPromise: Option.Option<Promise<Option.Option<PostHogJs>>> = Option.none();

  const start = (): Promise<Option.Option<PostHogJs>> => {
    if (Option.isSome(clientPromise)) return clientPromise.value;
    const started = (async () => {
      if (Option.isNone(token)) return Option.none<PostHogJs>();
      const { default: posthog } = await load();
      posthog.init(token.value, {
        api_host: options.apiHost ?? "/ingest",
        ui_host: options.host ?? "",
        defaults: POSTHOG_DEFAULTS,
        capture_exceptions: true,
        // Defence-in-depth (SEC-PRIV-001): scrub cookies / auth headers from
        // any event properties before they leave the trust boundary.
        before_send: scrubPostHogEvent,
      });
      // Super property attached to every captured event so production data
      // stays filterable in PostHog by deploy stage.
      posthog.register({ environment: options.stage ?? "" });
      return Option.some(posthog);
    })();
    clientPromise = Option.some(started);
    return started;
  };

  /** Runs `operation` against the initialised client, ignoring "analytics off" and any failure. */
  const withClient = (operation: (posthog: PostHogJs) => void): void => {
    void start()
      .then((client) => {
        if (Option.isSome(client)) operation(client.value);
      })
      .catch(() => {
        // Analytics is never load-bearing — a blocked ingest, an ad-blocked
        // chunk fetch, or a PostHog outage must not reach the reader.
      });
  };

  return {
    init: () => {
      withClient(() => {});
    },
    captureEvent: (event, properties) => {
      withClient((posthog) => {
        posthog.capture(event, properties);
      });
    },
    identifyUser: (id, properties) => {
      withClient((posthog) => {
        posthog.identify(id, properties);
      });
    },
    reset: () => {
      withClient((posthog) => {
        posthog.reset();
      });
    },
    captureException: (error) => {
      withClient((posthog) => {
        posthog.captureException(error);
      });
    },
  };
};
