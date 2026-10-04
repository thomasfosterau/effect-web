/**
 * Response-header policies shared by every web surface a site serves — the
 * security baseline, the stage `noindex`, the `Vary` discipline and the
 * `Cache-Control` safety net — as pure functions over `effect/http`'s
 * immutable `Headers`, so the same policy applies to an
 * `HttpServerResponse`, to a Fetch `Response` (through `./web`) or to a
 * SvelteKit hook's `response.headers`.
 *
 * Ported from the website / gardeneria `hooks.server.ts` and `cache-control.ts`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Headers from "effect/http/Headers";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** Sets `name` to `value` only when `headers` carries no header of that name. */
const setIfAbsent = (headers: Headers.Headers, name: string, value: string): Headers.Headers =>
  Headers.has(headers, name) ? headers : Headers.set(headers, name, value);

/**
 * The baseline security headers every response leaves the Worker with, as
 * `name → value`. Each is applied only when the route did not already set
 * it, so a route can tighten or relax one deliberately.
 *
 * @example
 * ```ts
 * import { SECURITY_HEADER_DEFAULTS } from "@thomasfosterau/effect-web"
 *
 * SECURITY_HEADER_DEFAULTS["X-Frame-Options"] // "DENY"
 * ```
 *
 * @since 0.1.0
 * @category constants
 */
export const SECURITY_HEADER_DEFAULTS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=(), serial=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Adds the baseline security response headers ({@link SECURITY_HEADER_DEFAULTS})
 * to `headers`, leaving any the route already set untouched. Apply it to
 * every response a front door returns, rendered pages and proxied responses
 * alike (SEC-HDR-001).
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import { securityHeaders } from "@thomasfosterau/effect-web"
 *
 * const headers = securityHeaders(Headers.fromInput({ "x-frame-options": "SAMEORIGIN" }))
 * Headers.get(headers, "x-frame-options") // Option.some("SAMEORIGIN") — the route's own value wins
 * Headers.get(headers, "x-content-type-options") // Option.some("nosniff")
 * ```
 *
 * @since 0.1.0
 * @category policies
 */
export const securityHeaders = (headers: Headers.Headers): Headers.Headers =>
  Record.toEntries(SECURITY_HEADER_DEFAULTS).reduce(
    (acc, [name, value]) => setIfAbsent(acc, name, value),
    headers,
  );

/**
 * Marks a non-production response non-indexable with `X-Robots-Tag: noindex`
 * (CANON-003): a `dev-<branch>`, `ci-<run_id>` or PR-preview deployment
 * leaking into a search index would duplicate production. Complements the
 * full-disallow `robots.txt` those stages serve as the index-time backstop.
 * An indexable stage (production) is left untouched, as is a response that
 * already declares its own `X-Robots-Tag`.
 *
 * The stage decision is the caller's (`indexable: PUBLIC_STAGE ===
 * "production"`, say); this package never reads an environment.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import { stageNoindex } from "@thomasfosterau/effect-web"
 *
 * Headers.get(stageNoindex(Headers.empty, { indexable: false }), "x-robots-tag") // Option.some("noindex")
 * Headers.has(stageNoindex(Headers.empty, { indexable: true }), "x-robots-tag") // false
 * ```
 *
 * @since 0.1.0
 * @category policies
 */
export const stageNoindex = (
  headers: Headers.Headers,
  options: { readonly indexable: boolean },
): Headers.Headers =>
  options.indexable ? headers : setIfAbsent(headers, "X-Robots-Tag", "noindex");

/**
 * Idempotently appends header names to a response `Vary`, skipping any
 * already present (case-insensitively). The single place the policies here
 * mutate `Vary`, so a front door's `Vary` handling stays in one function.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import { appendVary } from "@thomasfosterau/effect-web"
 *
 * const headers = appendVary(Headers.fromInput({ vary: "accept" }), ["Accept", "Cookie"])
 * Headers.get(headers, "vary") // Option.some("accept, Cookie")
 * ```
 *
 * @since 0.1.0
 * @category policies
 */
export const appendVary = (
  headers: Headers.Headers,
  names: ReadonlyArray<string>,
): Headers.Headers => {
  const existing = Headers.get(headers, "vary");
  const present = Option.match(existing, {
    onNone: () => new Set<string>(),
    onSome: (value) =>
      new Set(
        value
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry !== ""),
      ),
  });
  const additions = names.filter((name) => !present.has(name.toLowerCase()));
  if (Arr.isReadonlyArrayEmpty(additions)) return headers;
  return Headers.set(
    headers,
    "Vary",
    Option.match(existing, {
      onNone: () => additions.join(", "),
      onSome: (value) => `${value}, ${additions.join(", ")}`,
    }),
  );
};

/**
 * The three route classes a response `Vary` is chosen by, narrowest first:
 *
 * - `"locale-invariant"` — identical bytes for every visitor, locale and
 *   representation (favicons, `sitemap.xml`, `robots.txt`, share cards).
 *   No `Vary` at all.
 * - `"format-negotiated"` — identical for every visitor and locale, but the
 *   rendition is negotiated from `Accept` (an image endpoint serving AVIF or
 *   WebP). `Vary: Accept` alone.
 * - `"negotiated"` — the negotiated surface: HTML pages, JSON:API,
 *   everything else. `Vary: Cookie, Accept-Language, Accept`.
 *
 * Workers Caching keys a stored response on the URL plus every header it
 * `Vary`s on, taken verbatim, so a `Vary` dimension on a storable response
 * is a cache-key dimension: a `Cookie` entry on a shareable route fragments
 * it per visitor. It costs the negotiated surface nothing, because the
 * cache-control policy ({@link cacheControlForViewer}) forces every response
 * there to `private, no-store` unless the route declared its own, so their
 * `Vary` only keeps browsers honest. Keying the `format-negotiated` routes
 * that ARE stored on the raw `Accept` is a deliberate trade-off, bounded to
 * those routes and never applied to HTML.
 *
 * @since 0.1.0
 * @category models
 */
export type RouteVaryClass = "locale-invariant" | "format-negotiated" | "negotiated";

/**
 * The `Vary` dimensions each {@link RouteVaryClass} appends.
 *
 * @example
 * ```ts
 * import { VARY_BY_ROUTE_CLASS } from "@thomasfosterau/effect-web"
 *
 * VARY_BY_ROUTE_CLASS["negotiated"] // ["Cookie", "Accept-Language", "Accept"]
 * ```
 *
 * @since 0.1.0
 * @category constants
 */
export const VARY_BY_ROUTE_CLASS: Readonly<Record<RouteVaryClass, ReadonlyArray<string>>> = {
  "locale-invariant": [],
  "format-negotiated": ["Accept"],
  negotiated: ["Cookie", "Accept-Language", "Accept"],
};

/**
 * Appends the response `Vary` dimensions for a route class, so a
 * locale-invariant route carries no `Vary: Cookie` / `Accept-Language`
 * (PERF-CACHE-001). The classification is handed in by the caller (see
 * {@link classifyRoute}).
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import { responseVary } from "@thomasfosterau/effect-web"
 *
 * Headers.get(responseVary(Headers.empty, "negotiated"), "vary") // Option.some("Cookie, Accept-Language, Accept")
 * Headers.has(responseVary(Headers.empty, "locale-invariant"), "vary") // false
 * ```
 *
 * @since 0.1.0
 * @category policies
 */
export const responseVary = (
  headers: Headers.Headers,
  routeClass: RouteVaryClass,
): Headers.Headers => appendVary(headers, VARY_BY_ROUTE_CLASS[routeClass]);

/**
 * Routes that serve identical bytes to every visitor regardless of locale
 * or cookies — the favicon, apple-touch-icon and PWA install icons, the
 * default share card (OG-IMG-001), and the public edge-cached documents
 * (`sitemap.xml`, `feed.json`, `robots.txt`). They must NOT carry `Vary: Cookie,
 * Accept-Language`: that header fragments the Cloudflare Cache API by exact
 * cookie string (every distinct analytics / locale cookie becomes a separate
 * cache entry), collapsing the hit rate for assets that should cache
 * near-universally, and defeating the `s-maxage` the documents declare.
 * They set their own `Cache-Control`.
 *
 * @example
 * ```ts
 * import { LOCALE_INVARIANT_ASSET_PATHS } from "@thomasfosterau/effect-web"
 *
 * LOCALE_INVARIANT_ASSET_PATHS.has("/robots.txt") // true
 * ```
 *
 * @since 0.1.0
 * @category constants
 */
// oxlint-disable-next-line effect/avoid-native-object-helpers -- a per-response membership test on string literals; a native `Set` is the cheapest form and `HashSet` would hash the path each time.
export const LOCALE_INVARIANT_ASSET_PATHS: ReadonlySet<string> = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/og-default.png",
  "/sitemap.xml",
  "/feed.json",
  "/robots.txt",
]);

/**
 * Per-page Open Graph share cards: content-addressed PNGs under
 * `/og/` whose bytes are identical for every visitor and locale — the card
 * text rides in the query, not the cookie or `Accept-Language`. A locale
 * `Vary` would fragment the Cache API by cookie string and defeat the
 * immutable cache that OG-IMG-001 depends on (the "MastoDDoS" fan-out
 * defence).
 *
 * @example
 * ```ts
 * import { isOpenGraphCard } from "@thomasfosterau/effect-web"
 *
 * isOpenGraphCard("/og/abc123.png") // true
 * isOpenGraphCard("/og-default.png") // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isOpenGraphCard = (pathname: string): boolean =>
  pathname.startsWith("/og/") && pathname.endsWith(".png");

/**
 * Builds a locale-invariant asset predicate from an exact-path set plus any
 * further predicates (a prefix family like {@link isOpenGraphCard}).
 *
 * @example
 * ```ts
 * import { makeLocaleInvariantAssetMatcher } from "@thomasfosterau/effect-web"
 *
 * const isInvariant = makeLocaleInvariantAssetMatcher(["/favicon.ico"], (p) => p.startsWith("/static/"))
 * isInvariant("/favicon.ico") // true
 * isInvariant("/static/app.css") // true
 * isInvariant("/posts") // false
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeLocaleInvariantAssetMatcher = (
  paths: Iterable<string>,
  ...predicates: ReadonlyArray<(pathname: string) => boolean>
): ((pathname: string) => boolean) => {
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- see LOCALE_INVARIANT_ASSET_PATHS
  const set = new Set(paths);
  return (pathname) => set.has(pathname) || predicates.some((predicate) => predicate(pathname));
};

/**
 * The default locale-invariant asset predicate {@link classifyRoute} uses:
 * {@link LOCALE_INVARIANT_ASSET_PATHS} plus {@link isOpenGraphCard}.
 *
 * @example
 * ```ts
 * import { isLocaleInvariantAsset } from "@thomasfosterau/effect-web"
 *
 * isLocaleInvariantAsset("/sitemap.xml") // true
 * isLocaleInvariantAsset("/og/card.png") // true
 * isLocaleInvariantAsset("/posts") // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isLocaleInvariantAsset: (pathname: string) => boolean =
  makeLocaleInvariantAssetMatcher(LOCALE_INVARIANT_ASSET_PATHS, isOpenGraphCard);

/**
 * The two route predicates {@link classifyRoute} needs. `isFormatNegotiatedAsset`
 * is application-specific (an image endpoint serving AVIF or WebP from one
 * URL, say) and defaults to "none"; `isLocaleInvariantAsset` defaults to
 * {@link isLocaleInvariantAsset}.
 *
 * @since 0.1.0
 * @category models
 */
export interface RouteClassifier {
  readonly isLocaleInvariantAsset?: ((pathname: string) => boolean) | undefined;
  readonly isFormatNegotiatedAsset?: ((pathname: string) => boolean) | undefined;
}

/**
 * Classifies a request path into its {@link RouteVaryClass}, narrowest
 * class first, so a locale- and cookie-invariant asset is never classed as
 * negotiated and {@link responseVary} gives it no `Vary: Cookie` /
 * `Accept-Language` (PERF-CACHE-001).
 *
 * @example
 * ```ts
 * import { classifyRoute } from "@thomasfosterau/effect-web"
 *
 * classifyRoute("/robots.txt") // "locale-invariant"
 * classifyRoute("/posts/1") // "negotiated"
 * classifyRoute("/images/1", { isFormatNegotiatedAsset: (p) => p.startsWith("/images/") }) // "format-negotiated"
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const classifyRoute = (
  pathname: string,
  classifier: RouteClassifier = {},
): RouteVaryClass => {
  const invariant = classifier.isLocaleInvariantAsset ?? isLocaleInvariantAsset;
  if (invariant(pathname)) return "locale-invariant";
  if (classifier.isFormatNegotiatedAsset?.(pathname) === true) return "format-negotiated";
  return "negotiated";
};

/**
 * The `Cache-Control` value {@link ensureCacheControl} defaults to and
 * {@link cacheControlForViewer} forces: private, and never stored.
 *
 * @since 0.1.0
 * @category constants
 */
export const PRIVATE_NO_STORE = "private, no-store";

/**
 * Ensures `headers` carry a `Cache-Control`, defaulting to
 * {@link PRIVATE_NO_STORE} when nothing declared one — the CACHE-AUTH-003
 * safety net.
 *
 * Under Cloudflare Workers Caching, *any* response the Worker returns is
 * subject to platform caching based on whatever `Cache-Control` it carries —
 * RFC 9111 heuristic freshness applies to a 200 with no header at all,
 * regardless of which handle produced it. Without this, an authenticated
 * session JSON or a private JSON:API resource forwarded from an API Worker
 * that sets no `Cache-Control` would be cacheable-by-default the moment
 * Workers Caching is enabled — the exact CACHE-AUTH-003 leak, on a path the
 * viewer-aware policy never sees.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import { ensureCacheControl } from "@thomasfosterau/effect-web"
 *
 * Headers.get(ensureCacheControl(Headers.empty), "cache-control") // Option.some("private, no-store")
 * Headers.get(ensureCacheControl(Headers.fromInput({ "cache-control": "public, max-age=3600" })), "cache-control") // Option.some("public, max-age=3600")
 * ```
 *
 * @since 0.1.0
 * @category policies
 */
export const ensureCacheControl = (headers: Headers.Headers): Headers.Headers =>
  setIfAbsent(headers, "Cache-Control", PRIVATE_NO_STORE);

/**
 * The viewer-aware `Cache-Control` policy (CACHE-AUTH-003): a response
 * rendered for a **resolved viewer** is always forced to
 * {@link PRIVATE_NO_STORE}, overriding whatever a downstream handler set —
 * Workers Caching sits in front of the Worker, so on a hit the viewer check
 * never runs, and the only lever is what the response carried when it was
 * produced. The platform's automatic bypass on `Set-Cookie` cannot be relied
 * on: a session cookie is refreshed once per update window, so most
 * authenticated requests carry no `Set-Cookie` at all. An **anonymous**
 * response falls back to {@link ensureCacheControl}, so a route that is
 * genuinely safe to cache keeps the `Cache-Control` it declared.
 *
 * Must run after the viewer is resolved and before any representation
 * substitution, so the stamp lands on whichever response is returned.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import { cacheControlForViewer } from "@thomasfosterau/effect-web"
 *
 * const declared = Headers.fromInput({ "cache-control": "public, max-age=60" })
 * Headers.get(cacheControlForViewer(declared, { viewerResolved: true }), "cache-control") // Option.some("private, no-store")
 * Headers.get(cacheControlForViewer(declared, { viewerResolved: false }), "cache-control") // Option.some("public, max-age=60")
 * ```
 *
 * @since 0.1.0
 * @category policies
 */
export const cacheControlForViewer = (
  headers: Headers.Headers,
  options: { readonly viewerResolved: boolean },
): Headers.Headers =>
  options.viewerResolved
    ? Headers.set(headers, "Cache-Control", PRIVATE_NO_STORE)
    : ensureCacheControl(headers);

/**
 * Applies a header policy to an `HttpServerResponse`, returning a new
 * response (the input is immutable). Policies only ever add or replace
 * headers, so the update is a merge.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { ensureCacheControl, securityHeaders, updateHeaders } from "@thomasfosterau/effect-web"
 *
 * const response = updateHeaders(HttpServerResponse.text("hi"), (headers) => ensureCacheControl(securityHeaders(headers)))
 * Headers.get(response.headers, "cache-control") // Option.some("private, no-store")
 * Headers.get(response.headers, "x-frame-options") // Option.some("DENY")
 * ```
 *
 * @since 0.1.0
 * @category combinators
 */
export const updateHeaders = (
  response: HttpServerResponse.HttpServerResponse,
  policy: (headers: Headers.Headers) => Headers.Headers,
): HttpServerResponse.HttpServerResponse => {
  const next = policy(response.headers);
  return next === response.headers ? response : HttpServerResponse.setHeaders(response, next);
};
