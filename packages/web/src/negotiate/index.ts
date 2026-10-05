/**
 * The content-negotiation **dispatch verdict** a web front door makes for a
 * URL space shared between rendered pages and a JSON:API surface: whether a
 * request is served as HTML, dispatched to the JSON:API, or answered with the
 * alternate Markdown representation (DISC-009) — decided from the request
 * line and headers alone, and nowhere else.
 *
 * Only the verdict lives here. The JSON:API §5/§6 media-type rules (which
 * parameters a JSON:API instance may carry, which `ext` URIs are supported)
 * are **adopted** from `@thomasfosterau/effect-jsonapi`'s `Middleware`
 * rather than re-implemented: a write negotiates through
 * `Middleware.negotiate` directly, and each
 * `Accept` instance's cleanliness through `Middleware.contentTypeIsAcceptable`
 * (the positional media-type-parameter rule is the same for both headers).
 * What stays local is the *ranking* — whether the JSON:API (or Markdown)
 * instance outranks every other media type the client offered — which
 * `Middleware.negotiate` has no notion of, because a JSON:API-only server
 * never has to choose between representations.
 *
 * Two consequences, both spec-correct: an `ext` URI the api does not
 * declare in `options.extensions` makes the instance unacceptable (JSON:API
 * §5); and the §6 error documents carry effect-jsonapi's `code` values
 * (`not_acceptable`, `unsupported_media_type`).
 *
 * Ported from the applications' `packages/api/src/negotiate.ts`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Headers from "effect/http/Headers";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { Middleware } from "@thomasfosterau/effect-jsonapi";
import { isMutatingMethod, JSONAPI_MEDIA_TYPE, type NegotiationError } from "../jsonapi-error.ts";

/**
 * The media type of the Markdown representation served to agents on
 * `Accept: text/markdown`.
 *
 * @since 0.1.0
 * @category constants
 */
export const MARKDOWN_MEDIA_TYPE = "text/markdown";

/**
 * The representations a URL can resolve to. This is the normalized `Accept`
 * token the negotiation verdict produces — never the raw `Accept` header —
 * so a cache keyed on it holds at most one entry per representation
 * regardless of how many distinct `Accept` strings clients send.
 *
 * @since 0.1.0
 * @category models
 */
export type Representation = "text/html" | typeof JSONAPI_MEDIA_TYPE | typeof MARKDOWN_MEDIA_TYPE;

/**
 * The outcome of negotiating one request.
 *
 * @since 0.1.0
 * @category models
 */
export interface Negotiation {
  /**
   * Normalized cache-key representation token, never the raw `Accept`
   * header (PERF-CACHE-005). Meaningful for `GET`/`HEAD`.
   */
  readonly representation: Representation;
  /** `true` → serve this request from the JSON:API. */
  readonly dispatch: boolean;
  /** `true` → serve this request as the Markdown representation. */
  readonly markdown?: boolean | undefined;
  /** A JSON:API §6 negotiation error to emit instead of dispatching. */
  readonly error?: NegotiationError | undefined;
}

/**
 * What the verdict needs to know about the application: which paths are
 * JSON:API endpoints, which (if any) are Markdown-able content detail pages,
 * and which JSON:API extensions the api declares.
 *
 * @since 0.1.0
 * @category models
 */
export interface NegotiationOptions {
  /** Whether a request path matches a known JSON:API endpoint — see {@link makeApiPathMatcher}. */
  readonly isApiPath: (pathname: string) => boolean;
  /** Whether a request path is a content detail page that serves Markdown — see {@link makeMarkdownPathMatcher}. Defaults to none. */
  readonly isMarkdownPath?: ((pathname: string) => boolean) | undefined;
  /** The JSON:API extension URIs the api supports (`Middleware.NegotiationOptions["extensions"]`). Defaults to none. */
  readonly extensions?: ReadonlyArray<string> | undefined;
}

const HTML: Negotiation = { representation: "text/html", dispatch: false };
const DISPATCH: Negotiation = { representation: JSONAPI_MEDIA_TYPE, dispatch: true };
const MARKDOWN: Negotiation = {
  representation: MARKDOWN_MEDIA_TYPE,
  dispatch: false,
  markdown: true,
};

/**
 * The 406 the verdict emits when the `Accept` header carried the JSON:API
 * media type but every instance was modified with media-type parameters
 * other than `ext` / `profile` (or an unsupported `ext`) — JSON:API §6.3.2.
 * `status` / `code` / `title` are effect-jsonapi's `ApiError.NotAcceptable`
 * wire values (pinned by a test against `ApiError.toDocument`); `detail`
 * names the rule the instance broke.
 *
 * @since 0.1.0
 * @category constants
 */
export const NOT_ACCEPTABLE: NegotiationError = {
  status: 406,
  code: "not_acceptable",
  title: "Not Acceptable",
  detail:
    "The Accept header carried the JSON:API media type, but every instance was modified with media-type parameters other than `ext` or `profile` (JSON:API §6.3.2).",
};

/**
 * The 415 the verdict emits when a write's `Content-Type` carried the
 * JSON:API media type with media-type parameters other than `ext` / `profile`
 * (or an unsupported `ext`) — JSON:API §6.3.1. Wire values from
 * effect-jsonapi's `ApiError.UnsupportedMediaType`, as for
 * {@link NOT_ACCEPTABLE}.
 *
 * @since 0.1.0
 * @category constants
 */
export const UNSUPPORTED_MEDIA_TYPE: NegotiationError = {
  status: 415,
  code: "unsupported_media_type",
  title: "Unsupported Media Type",
  detail:
    "The Content-Type header carried the JSON:API media type with media-type parameters other than `ext` or `profile` (JSON:API §6.3.1).",
};

// ── Known-endpoint path matching ────────────────────────────────────

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compile one HttpApi endpoint path (`/posts/:id`, `/posts/`, …) into a
 * matcher: `:param` segments become a single-segment wildcard and a
 * trailing slash is optional. `None` for a root (`/`) path, which would
 * over-match every URL.
 */
const routePatternToRegExp = (path: string): Option.Option<RegExp> => {
  const segments = path
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (Arr.isReadonlyArrayEmpty(segments)) return Option.none();
  const body = segments
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment)))
    .join("/");
  return Option.some(new RegExp(`^/${body}/?$`));
};

/**
 * Builds the `isApiPath` predicate from the api's endpoint paths (`/posts`,
 * `/posts/:id`, `/lists/:id/items`, …): a request path matches when it
 * matches any of them, so adding an endpoint updates the predicate with no
 * second list of paths to maintain. Derive the list from the served `HttpApi`
 * itself (see {@link endpointPaths}): a group that is served but unmatched
 * 404s every browser-issued request for it at the front door while the
 * server-side path keeps working.
 *
 * @example
 * ```ts
 * import { makeApiPathMatcher } from "@thomasfosterau/effect-web/negotiate"
 *
 * const isApiPath = makeApiPathMatcher(["/posts", "/posts/:id", "/"])
 * isApiPath("/posts/") // true
 * isApiPath("/posts/42") // true
 * isApiPath("/posts/42/edit") // false
 * isApiPath("/") // false — a root path would over-match and is ignored
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeApiPathMatcher = (paths: Iterable<string>): ((pathname: string) => boolean) => {
  const patterns = Arr.getSomes(Arr.map(Arr.fromIterable(paths), routePatternToRegExp));
  return (pathname) => patterns.some((pattern) => pattern.test(pathname));
};

/**
 * The endpoint paths of a set of `HttpApiGroup`s, read structurally
 * (`group.endpoints[name].path`) so the matcher always tracks the served
 * surface.
 *
 * @example
 * ```ts
 * import { endpointPaths, makeApiPathMatcher } from "@thomasfosterau/effect-web/negotiate"
 *
 * const groups = [{ endpoints: { list: { path: "/posts" }, get: { path: "/posts/:id" } } }]
 * endpointPaths(groups) // ["/posts", "/posts/:id"]
 * makeApiPathMatcher(endpointPaths(groups))("/posts/1") // true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const endpointPaths = (
  groups: Iterable<{ readonly endpoints: Readonly<Record<string, { readonly path: string }>> }>,
): ReadonlyArray<string> =>
  Arr.flatMap(Arr.fromIterable(groups), (group) =>
    Record.values(group.endpoints).map((endpoint) => endpoint.path),
  );

/**
 * Builds the `isMarkdownPath` predicate from the content **route** segments
 * that serve a Markdown representation: a single `<segment>/<id>` path whose
 * segment is in the list, so the Markdown is served from the page's own URL
 * (DISC-009). An empty list matches nothing, so `text/markdown` always falls
 * through to HTML.
 *
 * @example
 * ```ts
 * import { makeMarkdownPathMatcher } from "@thomasfosterau/effect-web/negotiate"
 *
 * const isMarkdownPath = makeMarkdownPathMatcher(["posts", "notes"])
 * isMarkdownPath("/posts/42") // true
 * isMarkdownPath("/posts/42/") // true
 * isMarkdownPath("/posts") // false
 * isMarkdownPath("/about") // false
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeMarkdownPathMatcher = (
  segments: Iterable<string>,
): ((pathname: string) => boolean) => {
  const list = Arr.fromIterable(segments).map(escapeRegExp);
  if (Arr.isReadonlyArrayEmpty(list)) return () => false;
  const pattern = new RegExp(`^/(?:${list.join("|")})/[^/]+/?$`);
  return (pathname) => pattern.test(pathname);
};

// ── Accept ranking ──────────────────────────────────────────────────

/**
 * One `Accept` instance: its lowercased base type, the entry (media type,
 * `q` and any accept-extension parameters, each part trimmed and empty `;`
 * parts dropped) and its weight.
 */
interface AcceptInstance {
  readonly base: string;
  readonly entry: string;
  readonly weight: number;
}

const paramName = (param: string): string => (param.split("=")[0] ?? "").trim().toLowerCase();

/**
 * The weight of an `Accept` instance: its first `q`, which defaults to `1`
 * when absent AND when unparsable — the applications' choice, pinned by their
 * tests, so a client that mangles its `q` still ties rather than being read
 * as refusing. Local because effect-jsonapi exports no per-entry weight: its
 * entry parser is `@internal`, and `Middleware.acceptIsAcceptable` reads an
 * unparsable `q` as a refusal.
 */
const weightOf = (params: ReadonlyArray<string>): number =>
  Option.match(
    Arr.findFirst(params, (param) => paramName(param) === "q"),
    {
      onNone: () => 1,
      onSome: (param) => {
        const value = Number.parseFloat(param.split("=")[1] ?? "");
        return Number.isFinite(value) ? value : 1;
      },
    },
  );

/**
 * Splits an `Accept` header into its instances. The media-type / `q` split
 * (RFC 9110 §12.4.2: `q` ends the media type's parameter list, so what
 * follows it is an accept-extension, never a media-type parameter) is
 * effect-jsonapi's: the entry goes to `Middleware.contentTypeIsAcceptable`,
 * which splits positionally at `q` (since 0.16.1, the peer floor). Only the
 * weight is read here — see `weightOf`. Each part is trimmed and empty `;`
 * parts (a trailing `;`) are dropped first, as the applications did:
 * effect-jsonapi would read one as a nameless media-type parameter and refuse
 * the instance.
 */
const parseAccept = (header: Option.Option<string>): ReadonlyArray<AcceptInstance> =>
  Option.match(header, {
    onNone: () => [],
    onSome: (value) =>
      Arr.getSomes(
        value.split(",").map((raw) => {
          const parts = raw
            .split(";")
            .map((part) => part.trim())
            .filter((part) => part !== "");
          const [type, ...params] = parts;
          if (type === undefined) return Option.none();
          return Option.some({
            base: type.toLowerCase(),
            entry: parts.join(";"),
            weight: weightOf(params),
          });
        }),
      ),
  });

const maxWeight = (instances: ReadonlyArray<AcceptInstance>): Option.Option<number> =>
  Arr.match(instances, {
    onEmpty: () => Option.none(),
    onNonEmpty: (nonEmpty) => Option.some(Math.max(...nonEmpty.map((instance) => instance.weight))),
  });

/**
 * Whether the instances `predicate` selects are the client's **winning**
 * media type: at least one acceptable (`q > 0`) instance appears and outranks
 * (≥) every other media type. A browser's `text/html,…` `Accept` has no
 * matching instance and so never wins; a client that names the type (or
 * ranks it top) does.
 */
const winsAccept = (
  instances: ReadonlyArray<AcceptInstance>,
  predicate: (instance: AcceptInstance) => boolean,
): boolean => {
  const targets = instances.filter((instance) => predicate(instance) && instance.weight > 0);
  const others = instances.filter((instance) => !predicate(instance));
  return Option.match(maxWeight(targets), {
    onNone: () => false,
    onSome: (target) => target >= Option.getOrElse(maxWeight(others), () => 0),
  });
};

// ── The negotiator ──────────────────────────────────────────────────

const pathnameOf = (request: HttpServerRequest.HttpServerRequest): string =>
  // `url` is the request path (plus query) — never absolute for a request
  // built by `HttpServerRequest.fromWeb` or an Effect server — so the base
  // only satisfies the parser and is never observable.
  new URL(request.url, "http://localhost").pathname;

/** Negotiate a read (`GET` / `HEAD`) on `Accept`. */
const negotiateRead = (
  request: HttpServerRequest.HttpServerRequest,
  options: NegotiationOptions,
): Negotiation => {
  const path = pathnameOf(request);
  const accept = parseAccept(Headers.get(request.headers, "accept"));
  // Markdown (DISC-009) is negotiated first: it applies to content detail
  // pages, an orthogonal media type / path set from the JSON:API surface.
  if (
    options.isMarkdownPath?.(path) === true &&
    winsAccept(accept, (instance) => instance.base === MARKDOWN_MEDIA_TYPE)
  ) {
    return MARKDOWN;
  }
  const jsonapi = accept.filter((instance) => instance.base === JSONAPI_MEDIA_TYPE);
  if (Arr.isReadonlyArrayEmpty(jsonapi) || !options.isApiPath(path)) return HTML;
  // §6.3.2 through effect-jsonapi: an instance is clean iff its media-type
  // parameters (the ones before `q`; effect-jsonapi makes that split) are
  // only `ext` / `profile` with supported extension URIs — the same rule for
  // both headers.
  const isClean = (instance: AcceptInstance): boolean =>
    Middleware.contentTypeIsAcceptable(instance.entry, {
      extensions: options.extensions ?? [],
    });
  if (!jsonapi.some(isClean)) {
    return { representation: "text/html", dispatch: false, error: NOT_ACCEPTABLE };
  }
  // A clean, acceptable (q > 0) instance must outrank every other media type;
  // a `q=0` clean instance is an explicit refusal, not a §6 parameterisation.
  return winsAccept(accept, (instance) => instance.base === JSONAPI_MEDIA_TYPE && isClean(instance))
    ? DISPATCH
    : HTML;
};

/** Negotiate a write (`POST` / `PUT` / `PATCH` / `DELETE`) on `Content-Type`. */
const negotiateWrite = (
  request: HttpServerRequest.HttpServerRequest,
  options: NegotiationOptions,
): Negotiation => {
  const contentType = Headers.get(request.headers, "content-type");
  const base = Option.map(contentType, (value) => (value.split(";")[0] ?? "").trim().toLowerCase());
  if (
    Option.isNone(base) ||
    base.value !== JSONAPI_MEDIA_TYPE ||
    !options.isApiPath(pathnameOf(request))
  ) {
    return HTML;
  }
  // §6.3.1 through effect-jsonapi's own negotiator (the `Accept` side is
  // left undefined, which it treats as acceptable).
  const error = Middleware.negotiate(
    { contentType: Option.getOrUndefined(contentType) },
    { extensions: options.extensions ?? [] },
  );
  return error === undefined
    ? DISPATCH
    : { representation: "text/html", dispatch: false, error: UNSUPPORTED_MEDIA_TYPE };
};

/**
 * Negotiates a single request into a {@link Negotiation}. Pure and
 * dependency-free beyond `options` (it reads only the request line and
 * headers), so a cache handle and a dispatch handle can share one verdict.
 * Reads (`GET` / `HEAD`) negotiate on `Accept`, trying `text/markdown`
 * first on a Markdown path so the page's own URL serves it (DISC-009);
 * mutating methods negotiate on `Content-Type`; anything else (`OPTIONS`,
 * …) is HTML. The JSON:API surface is chosen by its media type, never a
 * path prefix, and a disallowed media-type parameter answers 406 / 415
 * (JSONAPI-NEG-001 / JSONAPI-NEG-002).
 *
 * @example
 * ```ts
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import { makeApiPathMatcher, negotiateRepresentation } from "@thomasfosterau/effect-web/negotiate"
 *
 * const options = { isApiPath: makeApiPathMatcher(["/posts", "/posts/:id"]) }
 * const request = (accept: string) =>
 *   HttpServerRequest.fromWeb(new Request("https://example.com/posts", { headers: { accept } }))
 *
 * negotiateRepresentation(request("application/vnd.api+json"), options).dispatch // true
 * negotiateRepresentation(request("text/html,*\/*;q=0.8"), options).representation // "text/html"
 * negotiateRepresentation(request("application/vnd.api+json;version=1"), options).error?.status // 406
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const negotiateRepresentation = (
  request: HttpServerRequest.HttpServerRequest,
  options: NegotiationOptions,
): Negotiation => {
  if (request.method === "GET" || request.method === "HEAD") return negotiateRead(request, options);
  if (isMutatingMethod(request.method)) return negotiateWrite(request, options);
  return HTML;
};

/**
 * {@link negotiateRepresentation} over a Web `Request` — the SvelteKit hook
 * form.
 *
 * @example
 * ```ts
 * import { makeApiPathMatcher, negotiateWebRequest } from "@thomasfosterau/effect-web/negotiate"
 *
 * const options = { isApiPath: makeApiPathMatcher(["/posts"]) }
 * negotiateWebRequest(new Request("https://example.com/posts", { headers: { accept: "application/vnd.api+json" } }), options).dispatch // true
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const negotiateWebRequest = (request: Request, options: NegotiationOptions): Negotiation =>
  negotiateRepresentation(HttpServerRequest.fromWeb(request), options);

/**
 * Prepares a dispatched request for an internal HttpApi router that
 * registers JSON payloads under the default `application/json` encoding
 * while the negotiated **external** contract carries the JSON:API media
 * type. The media-type discrimination and the §6 status rules are already
 * enforced by {@link negotiateRepresentation} at the seam; a write's
 * `Content-Type` is relabelled to `application/json` so the router decodes
 * the (already-JSON) body. Reads pass through unchanged.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/http/Headers"
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import { requestForRouter } from "@thomasfosterau/effect-web/negotiate"
 *
 * const write = HttpServerRequest.fromWeb(
 *   new Request("https://example.com/posts", { method: "POST", headers: { "content-type": "application/vnd.api+json" } }),
 * )
 * Headers.get(requestForRouter(write).headers, "content-type") // Option.some("application/json")
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const requestForRouter = (
  request: HttpServerRequest.HttpServerRequest,
): HttpServerRequest.HttpServerRequest =>
  isMutatingMethod(request.method)
    ? request.modify({ headers: Headers.set(request.headers, "content-type", "application/json") })
    : request;

/**
 * {@link requestForRouter} over a Web `Request`.
 *
 * @example
 * ```ts
 * import { requestForRouterWeb } from "@thomasfosterau/effect-web/negotiate"
 *
 * const write = new Request("https://example.com/posts", { method: "POST", headers: { "content-type": "application/vnd.api+json" } })
 * requestForRouterWeb(write).headers.get("content-type") // "application/json"
 * const read = new Request("https://example.com/posts")
 * requestForRouterWeb(read) === read // true
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const requestForRouterWeb = (request: Request): Request => {
  if (!isMutatingMethod(request.method)) return request;
  const headers = new globalThis.Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request, { headers });
};

/**
 * Picks the Markdown response when the renderer produced one (`Some`, a
 * Markdown-able content route), or falls through to `onHtml` when it did
 * not (`None`: a path with no Markdown renderer, which the framework resolves
 * as HTML, 404 included). `onHtml` is a thunk — the framework's own render —
 * which must run only on the `None` branch; invoking it unconditionally
 * would render the page twice and defeat the point of the Markdown
 * short-circuit.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { chooseNegotiatedResponse } from "@thomasfosterau/effect-web/negotiate"
 *
 * chooseNegotiatedResponse(Option.some("# Markdown"), () => "<html>") // "# Markdown"
 * chooseNegotiatedResponse(Option.none(), () => "<html>") // "<html>"
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const chooseNegotiatedResponse = <A, B>(
  markdown: Option.Option<A>,
  onHtml: () => B,
): A | B => (Option.isSome(markdown) ? markdown.value : onHtml());
