/**
 * `@thomasfosterau/effect-web-posthog/server` — the server side: the
 * `PostHog` Effect service (`packages/infra-posthog/src/Service.ts`), the
 * per-request `posthog-node` client factory (`apps/web/src/lib/server/posthog.ts`)
 * and the `/ingest` reverse proxy (`apps/web/src/hooks.server.ts`'s
 * `ingestProxy`), with the build-time `PUBLIC_*` values taken as parameters
 * (website reads `PUBLIC_POSTHOG_PROJECT_TOKEN`, gardeneria
 * `PUBLIC_POSTHOG_KEY`; the caller passes whichever it has). Peer:
 * `posthog-node`. No alchemy import.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { PostHog as PostHogClient } from "posthog-node";
import { applyToWebHeaders, resolveClientIp, securityHeaders } from "@thomasfosterau/effect-web";
import { resolveProjectToken, scrubPostHogEvent } from "../index.ts";

// ── The Effect service ─────────────────────────────────────────────────

/**
 * Shape of a captured analytics event — mirrors the PostHog client API.
 *
 * @since 0.1.0
 * @category models
 */
export interface CaptureEvent {
  readonly distinctId: string;
  readonly event: string;
  readonly properties?: Record<string, unknown> | undefined;
  readonly groups?: Record<string, string> | undefined;
}

/**
 * The `PostHog` service: server-side analytics capture + flush, so capture
 * sites stay declarative and the flush composes with a `Scheduler.waitUntil`
 * (`@thomasfosterau/effect-web-cloudflare`) to outlive the response.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogService {
  /** Records an analytics event. Fire-and-forget; flush separately. */
  readonly capture: (event: CaptureEvent) => Effect.Effect<void>;
  /**
   * Flushes the in-memory event buffer to the PostHog server. Compose with
   * `Scheduler.waitUntil` so the flush outlives the response.
   */
  readonly flush: Effect.Effect<void>;
}

/**
 * The `PostHog` service tag.
 *
 * @since 0.1.0
 * @category services
 */
export class PostHog extends Context.Service<PostHog, PostHogService>()("PostHog") {}

/**
 * The Live Layer for {@link PostHog} from an already-constructed client (one
 * per request — see {@link makePostHogClient}).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { disabledPostHogClient, PostHog, posthogLayer } from "@thomasfosterau/effect-web-posthog/server"
 *
 * await Effect.runPromise(
 *   Effect.gen(function* () {
 *     const posthog = yield* PostHog
 *     yield* posthog.capture({ distinctId: "u-1", event: "viewed" })
 *     yield* posthog.flush
 *   }).pipe(Effect.provide(posthogLayer(disabledPostHogClient()))),
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const posthogLayer = (client: PostHogClient): Layer.Layer<PostHog> =>
  Layer.succeed(PostHog)({
    capture: (event) =>
      Effect.sync(() => {
        // `posthog-node` types its optionals without `| undefined`, so an
        // absent field is omitted rather than passed through.
        const message: Parameters<PostHogClient["capture"]>[0] = {
          distinctId: event.distinctId,
          event: event.event,
        };
        if (event.properties !== undefined) message.properties = event.properties;
        if (event.groups !== undefined) message.groups = event.groups;
        client.capture(message);
      }),
    // oxlint-disable-next-line effect/effect-promise-vs-trypromise -- the service's `flush` is `Effect<void>` by contract (the applications compose it with `Scheduler.waitUntil`, whose detached run swallows a defect); a rejected flush has no typed error a capture site could act on.
    flush: Effect.promise(() => client.flush()),
  });

// ── The per-request client ─────────────────────────────────────────────

/**
 * The build-time values the client factory reads.
 *
 * @since 0.1.0
 * @category models
 */
export interface PostHogClientOptions {
  /** The project token (`PUBLIC_POSTHOG_PROJECT_TOKEN` / `PUBLIC_POSTHOG_KEY`); absent or blank turns analytics off. */
  readonly token: string | undefined;
  /** The PostHog host (`PUBLIC_POSTHOG_HOST`); absent turns analytics off. */
  readonly host: string | undefined;
  /** The deploy stage every event is tagged `environment: <stage>` with (`PUBLIC_STAGE`). */
  readonly stage: string | undefined;
}

/**
 * A client in `posthog-node`'s own disabled mode: `capture` / `identify` /
 * `flush` / `shutdown` all short-circuit before any network access, so no
 * hand-maintained stub has to match the client surface. What
 * {@link makePostHogClient} returns when no project token is configured.
 *
 * @example
 * ```ts
 * import { disabledPostHogClient } from "@thomasfosterau/effect-web-posthog/server"
 *
 * const client = disabledPostHogClient()
 * client.capture({ distinctId: "u", event: "noop" })
 * await client.flush()
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const disabledPostHogClient = (): PostHogClient =>
  new PostHogClient("disabled", { disabled: true });

/**
 * Stamps `environment: <stage>` onto an event payload. `environment` is
 * assigned AFTER the caller's properties, so the stage is authoritative:
 * every event carries the real stage, which a caller's own `environment`
 * key — or an explicit `environment: undefined` — would otherwise silently
 * defeat.
 */
const tagWith =
  (stage: string) =>
  <T extends { readonly properties?: Record<string, unknown> | undefined }>(
    input: T,
  ): T & { readonly properties: Record<string, unknown> } => ({
    ...input,
    properties: { ...input.properties, environment: stage },
  });

/**
 * Wraps `capture` / `identify` / `captureExceptionImmediate` so every event
 * carries `environment: <stage>` — the same super property the browser
 * client registers, so both telemetry surfaces tag data the same way.
 *
 * `captureExceptionImmediate` is wrapped rather than `captureException`: it
 * awaits the actual send rather than queuing for a later flush. A Worker can
 * freeze the isolate as soon as the `ctx.waitUntil`-tracked promise resolves,
 * and `captureException`'s event build + enqueue happens on a separate,
 * unawaited chain that a plain `flush()` right after it does NOT wait for —
 * silently dropping the very exception a `handleError` exists to capture.
 *
 * @example
 * ```ts
 * import { disabledPostHogClient, withEnvironmentProperty } from "@thomasfosterau/effect-web-posthog/server"
 *
 * const client = withEnvironmentProperty(disabledPostHogClient(), "stage")
 * client.capture({ distinctId: "u", event: "viewed", properties: { environment: "spoofed" } })
 * // captured with `properties.environment === "stage"`
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const withEnvironmentProperty = (client: PostHogClient, stage: string): PostHogClient => {
  const tag = tagWith(stage);
  // SAFETY: a structural wrapper over the vendor `PostHog` class; it
  // re-exposes only the methods the applications use, so it cannot be
  // assignable to the nominal class type. Every method forwards to the real
  // client.
  // oxlint-disable-next-line effect/no-chained-type-assertions -- the wrapper is structural and the vendor class nominal; no single assertion is admitted.
  return {
    capture: (event: Parameters<PostHogClient["capture"]>[0]) => client.capture(tag(event)),
    captureExceptionImmediate: (
      error: unknown,
      distinctId?: string,
      additionalProperties?: Record<string, unknown>,
    ) =>
      // `environment` last, for the same reason as `tag`.
      client.captureExceptionImmediate(error, distinctId, {
        ...additionalProperties,
        environment: stage,
      }),
    identify: (input: Parameters<PostHogClient["identify"]>[0]) => client.identify(tag(input)),
    alias: (input: Parameters<PostHogClient["alias"]>[0]) => client.alias(input),
    groupIdentify: (input: Parameters<PostHogClient["groupIdentify"]>[0]) =>
      client.groupIdentify(input),
    flush: () => client.flush(),
    shutdown: () => client.shutdown(),
  } as unknown as PostHogClient;
};

/**
 * Creates a `posthog-node` client from the build-time values, or the
 * disabled-mode client when the token or host is missing (local dev, a PR
 * stage). **Per request, deliberately.** A `posthog-node` client shared
 * across requests is unsafe on Cloudflare Workers, for reasons in the
 * client's own flush model (#1233): `flushAt: 1` parks each capture's flush
 * promise on the instance and the next `flush()` returns it verbatim, every
 * flush chains onto the previous one, the event queue is instance state, and
 * the `waitUntil` debounce cycle is per instance — each of which hands one
 * request's I/O to another, which workerd forbids. What IS isolate-stable is
 * everything around it: the resolved token, the options object (with its
 * `before_send` scrubber) and the stage tag — build those once and call this
 * per request.
 *
 * `flushAt: 1` / `flushInterval: 0` flush immediately after each capture —
 * necessary in Workers, where the runtime may terminate once the response
 * is sent.
 *
 * @example
 * ```ts
 * import { makePostHogClient } from "@thomasfosterau/effect-web-posthog/server"
 *
 * const off = makePostHogClient({ token: undefined, host: "https://eu.i.posthog.com", stage: "dev" })
 * off.capture({ distinctId: "u", event: "noop" }) // disabled mode: no network
 * await off.flush()
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makePostHogClient = (options: PostHogClientOptions): PostHogClient => {
  const token = resolveProjectToken(options.token);
  if (Option.isNone(token) || options.host === undefined) return disabledPostHogClient();
  return withEnvironmentProperty(
    new PostHogClient(token.value, {
      host: options.host,
      flushAt: 1,
      flushInterval: 0,
      // Defence-in-depth (SEC-PRIV-001): scrub cookies / auth headers from
      // any event properties before they leave the trust boundary.
      before_send: scrubPostHogEvent,
    }),
    options.stage ?? "",
  );
};

// ── The ingest reverse proxy ───────────────────────────────────────────

/**
 * The inbound request headers the proxy forwards upstream — an explicit
 * allow-list. `cookie`, `authorization` and `set-cookie` MUST NOT leak to
 * PostHog: the session cookie would otherwise be exfiltrated on every
 * analytics call.
 *
 * @since 0.1.0
 * @category constants
 */
// oxlint-disable-next-line effect/avoid-native-object-helpers -- security allow-list probed once per inbound header on every `/ingest/*` proxy request (a hot path). A native `Set` is the cheapest membership test; structural equality buys nothing for a frozen list of ASCII header names.
export const FORWARDED_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "content-type",
  "content-length",
  "user-agent",
  "referer",
  "origin",
]);

/**
 * The methods PostHog's SDK actually uses; anything else is 405, to limit
 * abuse of an open-ish reverse proxy.
 *
 * @since 0.1.0
 * @category constants
 */
// oxlint-disable-next-line effect/avoid-native-object-helpers -- same hot-path membership test as `FORWARDED_HEADERS`.
export const INGEST_METHODS: ReadonlySet<string> = new Set(["GET", "POST", "OPTIONS", "HEAD"]);

/**
 * PostHog's EU ingest host, and its static-assets host (for `<prefix>/static/*`).
 *
 * @since 0.1.0
 * @category constants
 */
export const POSTHOG_EU_INGEST = {
  host: "eu.i.posthog.com",
  assetsHost: "eu-assets.i.posthog.com",
} as const;

/**
 * Options for {@link proxyIngestRequest}.
 *
 * @since 0.1.0
 * @category models
 */
export interface IngestProxyOptions {
  /** The path prefix the client SDK is pointed at (`api_host`). Defaults to `"/ingest"`. */
  readonly prefix?: string | undefined;
  /** The upstream ingest host and assets host. Defaults to {@link POSTHOG_EU_INGEST}. */
  readonly upstream?: { readonly host: string; readonly assetsHost: string } | undefined;
  /**
   * The platform's client-address resolver (SvelteKit's
   * `event.getClientAddress`). Forwarded as `x-forwarded-for` when it
   * resolves; never the inbound `x-forwarded-for`, which a client can spoof
   * to poison PostHog's geo / analytics (SEC-SSRF-005).
   */
  readonly getClientAddress: () => string;
  /** The `fetch` to reach upstream with. Defaults to the platform's. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Whether a pathname is the ingest proxy's: `prefix` itself or anything
 * under it.
 *
 * @example
 * ```ts
 * import { isIngestPath } from "@thomasfosterau/effect-web-posthog/server"
 *
 * isIngestPath("/ingest/e/") // true
 * isIngestPath("/ingestion") // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isIngestPath = (pathname: string, prefix = "/ingest"): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Reverse-proxies one `<prefix>/*` request to PostHog so the browser SDK can
 * route through the same origin and avoid ad-blockers. The Fetch-level core:
 * the inbound body streams straight through (`duplex: "half"`) and the
 * upstream response comes back as-is, re-wrapped so an upstream `Set-Cookie`
 * cannot plant cookies under this origin and the baseline security headers
 * (SEC-HDR-001) still apply. Answered ahead of any session or runtime work;
 * the response never carries a render middleware's `Vary` or cache stamp.
 *
 * @example
 * ```ts
 * import { proxyIngestRequest } from "@thomasfosterau/effect-web-posthog/server"
 *
 * let forwardedTo = ""
 * const response = await proxyIngestRequest(
 *   new Request("https://app.example/ingest/e/?v=1", { method: "POST", body: "{}", headers: { cookie: "s=1", "content-type": "application/json" } }),
 *   {
 *     getClientAddress: () => "203.0.113.9",
 *     fetch: async (url, init) => {
 *       forwardedTo = String(url)
 *       const headers = new Headers(init?.headers)
 *       return new Response(headers.get("cookie") ?? "no cookie", { headers: { "set-cookie": "evil=1" } })
 *     },
 *   },
 * )
 * forwardedTo // "https://eu.i.posthog.com/e/?v=1"
 * await response.text() // "no cookie"
 * response.headers.get("set-cookie") // null
 * ```
 *
 * @since 0.1.0
 * @category proxy
 */
export const proxyIngestRequest = async (
  request: Request,
  options: IngestProxyOptions,
): Promise<Response> => {
  const prefix = options.prefix ?? "/ingest";
  const upstream = options.upstream ?? POSTHOG_EU_INGEST;
  if (!INGEST_METHODS.has(request.method)) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const { pathname } = url;
  const hostname = pathname.startsWith(`${prefix}/static/`) ? upstream.assetsHost : upstream.host;
  url.protocol = "https:";
  url.hostname = hostname;
  url.port = "443";
  url.pathname = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARDED_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("host", hostname);
  headers.set("accept-encoding", "");
  const clientIp = resolveClientIp(options.getClientAddress);
  if (Option.isSome(clientIp)) headers.set("x-forwarded-for", clientIp.value);

  // `duplex: "half"` is required to send a streaming request body and is
  // not on the ambient `RequestInit`; widening the init's type states that
  // in the type system rather than suppressing the error.
  const init: RequestInit & { readonly duplex: "half" } = {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
  };
  // oxlint-disable-next-line effect/avoid-native-fetch -- reverse proxy: the platform `fetch` is what streams the inbound request body straight through (`duplex: "half"`) and returns the upstream response untouched. `HttpClient` would buffer and re-encode the body and re-derive the response headers, changing what the proxy forwards.
  const response = await (options.fetch ?? globalThis.fetch)(url.toString(), init);

  const proxied = new Response(response.body, response);
  proxied.headers.delete("set-cookie");
  applyToWebHeaders(proxied.headers, securityHeaders);
  return proxied;
};

/**
 * {@link proxyIngestRequest} as an `effect/unstable/http` handler: reads the
 * `HttpServerRequest` in context, proxies its Web form, and answers with the
 * upstream response as a raw `HttpServerResponse`. For an `HttpRouter` /
 * `HttpApp` front door whose `<prefix>` branch is this handler.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
 * import { ingestProxy } from "@thomasfosterau/effect-web-posthog/server"
 *
 * const response = await Effect.runPromise(
 *   ingestProxy({
 *     getClientAddress: () => "203.0.113.9",
 *     fetch: async () => new Response("ok", { status: 200 }),
 *   }).pipe(
 *     Effect.provideService(
 *       HttpServerRequest.HttpServerRequest,
 *       HttpServerRequest.fromWeb(new Request("https://app.example/ingest/e/")),
 *     ),
 *   ),
 * )
 * response.status // 200
 * ```
 *
 * @since 0.1.0
 * @category proxy
 */
export const ingestProxy = (
  options: IngestProxyOptions,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // A request that cannot be re-expressed as a Web `Request` is a platform
    // defect, not a proxy outcome the caller could act on.
    const web = yield* Effect.orDie(HttpServerRequest.toWeb(request));
    // oxlint-disable-next-line effect/effect-promise-vs-trypromise -- the proxy core never rejects on a modelled failure: upstream errors come back as responses, and a `fetch` throw is a defect (no typed error a caller could handle), which is what `runPromiseExit` rethrows with the original cause.
    const response = yield* Effect.promise(() => proxyIngestRequest(web, options));
    return HttpServerResponse.fromWeb(response);
  });
