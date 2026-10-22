/**
 * `@thomasfosterau/effect-web` — framework-neutral web request/response
 * utilities on `effect/http`: response-header policies
 * (security baseline, stage `noindex`, `Vary` discipline, the
 * `Cache-Control` safety net), the cross-origin mutation guard, the trusted
 * client address, the degraded-session report, the canonical site base and
 * the JSON:API guard responses a front door emits at its seam.
 *
 * Everything here is written over `Headers`, `HttpServerRequest` and
 * `HttpServerResponse`; `HttpServerRequest.fromWeb`, `HttpServerResponse.toWeb`
 * and the `*Web` adapters in this entry bridge to the Fetch types a
 * SvelteKit hook or a Worker `fetch` export deals in.
 *
 * The other entries: `./net` (the SSRF guard and redirect-following fetch),
 * `./observability` (structured log, allow-listed span tracer, event trio,
 * auth-outcome signal), `./negotiate` (the content-negotiation dispatch
 * verdict, over `@thomasfosterau/effect-jsonapi`).
 *
 * @since 0.1.0
 */
export * from "./client-ip.ts";
export * from "./cross-origin.ts";
export * from "./headers.ts";
export * from "./jsonapi-error.ts";
export * from "./session.ts";
export * from "./site-base.ts";
export * from "./web.ts";
