/**
 * The SEC-CSRF-001 cross-origin mutation guard, in two shapes: the
 * predicate an API applies per route, and the rejection response a web front
 * door returns. One module, one explanation, because a CSRF guard that
 * differs subtly between routes is a CSRF guard nobody can audit.
 *
 * ## What it relies on
 *
 * A browser always sends `Origin` on a cross-origin request, so a present
 * `Origin` that is not this Worker's own is rejected. A server-to-server call
 * (an SSR binding, a webhook) either sends none or sends its own, which is
 * same-origin with the forwarded request's URL — so a legitimate call passes
 * either way. A route whose authentication is something other than the
 * session cookie (a payment webhook, authenticated by its signature) does
 * NOT use this and must not: that sender is a server, sends no `Origin`, and
 * could not satisfy an origin check if one were demanded of it.
 *
 * ## Why it applies to JSON routes too
 *
 * A negotiated JSON:API surface is protected by its own media type — a
 * browser form cannot submit `application/vnd.api+json` — but
 * `multipart/form-data` IS form-submittable, and `application/json` is only
 * not-form-submittable as a property of today's body format rather than of
 * the route. So the guard is applied uniformly rather than reasoned away per
 * route, because the reasoning is exactly what a later change to one route's
 * body format would silently invalidate.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import * as Headers from "effect/http/Headers";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ensureCacheControl, updateHeaders } from "./headers.ts";
import {
  CROSS_ORIGIN_REJECTED,
  isMutatingMethod,
  jsonApiErrorResponse,
  jsonApiErrorResponseWeb,
} from "./jsonapi-error.ts";
import { updateWebHeaders } from "./web.ts";

/**
 * Whether an `Origin` header value must be refused: present, and not
 * `expectedOrigin` (the serving Worker's own origin). Absent passes.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { isCrossOrigin } from "@thomasfosterau/effect-web"
 *
 * isCrossOrigin(Option.some("https://evil.example"), "https://thomasfoster.au") // true
 * isCrossOrigin(Option.some("https://thomasfoster.au"), "https://thomasfoster.au") // false
 * isCrossOrigin(Option.none(), "https://thomasfoster.au") // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isCrossOrigin = (origin: Option.Option<string>, expectedOrigin: string): boolean =>
  Option.isSome(origin) && origin.value !== expectedOrigin;

/**
 * Whether `request` must be refused as cross-origin: it carries an `Origin`
 * other than `expectedOrigin` (SEC-CSRF-001).
 *
 * `expectedOrigin` is explicit rather than derived: an `HttpServerRequest`'s
 * `url` is its path, and `HttpServerRequest.toURL` reconstructs the origin
 * from the `Host` header with an `http` default, which is not the origin a
 * browser puts in `Origin` for an HTTPS site.
 *
 * `request` must be an `HttpServerRequest` (wrap a Fetch `Request` with
 * `HttpServerRequest.fromWeb`): its `headers` is a plain record, and a Fetch
 * `Request` cast to this type reads no `Origin` and passes every request. A
 * Fetch-level caller uses {@link isCrossOriginRejectedWeb}.
 *
 * @example
 * ```ts
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import { isCrossOriginRejected } from "@thomasfosterau/effect-web"
 *
 * const request = new Request("https://thomasfoster.au/uploads", { method: "POST" })
 * request.headers.set("origin", "https://evil.example")
 * isCrossOriginRejected(HttpServerRequest.fromWeb(request), "https://thomasfoster.au") // true
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isCrossOriginRejected = (
  request: HttpServerRequest.HttpServerRequest,
  expectedOrigin: string,
): boolean => isCrossOrigin(Headers.get(request.headers, "origin"), expectedOrigin);

/**
 * {@link isCrossOriginRejected} over a Fetch `Request`: whether it carries an
 * `Origin` other than `expectedOrigin` (SEC-CSRF-001), read from the Fetch
 * `Headers`. `expectedOrigin` defaults to the request URL's own origin, which
 * at a Fetch-level seam is the origin the browser was talking to.
 *
 * @example
 * ```ts
 * import { isCrossOriginRejectedWeb } from "@thomasfosterau/effect-web"
 *
 * const request = new Request("https://thomasfoster.au/uploads", { method: "POST" })
 * request.headers.set("origin", "https://evil.example")
 * isCrossOriginRejectedWeb(request) // true
 * isCrossOriginRejectedWeb(request, "https://evil.example") // false
 * ```
 *
 * @since 0.2.0
 * @category adapters
 */
export const isCrossOriginRejectedWeb = (
  request: Request,
  expectedOrigin: string = new URL(request.url).origin,
): boolean => isCrossOrigin(Option.fromNullishOr(request.headers.get("origin")), expectedOrigin);

/**
 * The web front door's SEC-CSRF-001 guard for a dispatched JSON:API request
 * before it is forwarded to the API Worker: a 403
 * {@link CROSS_ORIGIN_REJECTED} response (already stamped `private,
 * no-store`) when `request` uses a mutating method and carries an `Origin`
 * that doesn't match `expectedOrigin`, and `None` when the request should
 * proceed (same-origin, a non-mutating method, or no `Origin` header at all
 * — a non-browser client).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import * as HttpServerRequest from "effect/http/HttpServerRequest"
 * import { crossOriginMutationRejection } from "@thomasfosterau/effect-web"
 *
 * const request = new Request("https://thomasfoster.au/posts", { method: "POST" })
 * request.headers.set("origin", "https://evil.example")
 * const rejection = crossOriginMutationRejection(HttpServerRequest.fromWeb(request), "https://thomasfoster.au")
 * Option.map(rejection, (response) => response.status) // Option.some(403)
 *
 * const read = new Request("https://thomasfoster.au/posts")
 * Option.isNone(crossOriginMutationRejection(HttpServerRequest.fromWeb(read), "https://thomasfoster.au")) // true
 * ```
 *
 * @since 0.1.0
 * @category guards
 */
export const crossOriginMutationRejection = (
  request: HttpServerRequest.HttpServerRequest,
  expectedOrigin: string,
): Option.Option<HttpServerResponse.HttpServerResponse> =>
  isMutatingMethod(request.method) && isCrossOriginRejected(request, expectedOrigin)
    ? Option.some(updateHeaders(jsonApiErrorResponse(CROSS_ORIGIN_REJECTED), ensureCacheControl))
    : Option.none();

/**
 * {@link crossOriginMutationRejection} over Fetch types, for a framework
 * hook, with the expected origin defaulting to the request URL's own.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { crossOriginMutationRejectionWeb } from "@thomasfosterau/effect-web"
 *
 * const request = new Request("https://thomasfoster.au/posts", { method: "POST" })
 * request.headers.set("origin", "https://evil.example")
 * Option.map(crossOriginMutationRejectionWeb(request), (response) => response.status) // Option.some(403)
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const crossOriginMutationRejectionWeb = (
  request: Request,
  expectedOrigin: string = new URL(request.url).origin,
): Option.Option<Response> => {
  if (!isMutatingMethod(request.method)) return Option.none();
  return isCrossOriginRejectedWeb(request, expectedOrigin)
    ? Option.some(
        updateWebHeaders(jsonApiErrorResponseWeb(CROSS_ORIGIN_REJECTED), ensureCacheControl),
      )
    : Option.none();
};
