/**
 * The JSON:API error responses a web front door emits at its seam — the
 * guard statuses (403 cross-origin, 503 no runtime) and their serialiser —
 * ported from `packages/api/src/negotiate.ts` of the three applications
 * (`NegotiationError`, `CROSS_ORIGIN_REJECTED`, `SERVICE_UNAVAILABLE`,
 * `jsonApiErrorResponse`, `isMutatingMethod`). Dependency-free: the §6
 * negotiation errors themselves come from `@thomasfosterau/effect-jsonapi`
 * through the `./negotiate` entry, which builds on this module.
 *
 * @since 0.1.0
 */
import * as HashSet from "effect/HashSet";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * The JSON:API media type. Duplicated from `@thomasfosterau/effect-jsonapi`'s
 * `MEDIA_TYPE` so the root entry needs no dependency on it.
 *
 * @since 0.1.0
 * @category constants
 */
export const JSONAPI_MEDIA_TYPE = "application/vnd.api+json";

/**
 * A JSON:API error to emit at the seam (the §6 / guard statuses).
 *
 * @since 0.1.0
 * @category models
 */
export interface NegotiationError {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * The cross-origin mutation guard rejection (SEC-CSRF-001).
 *
 * @since 0.1.0
 * @category constants
 */
export const CROSS_ORIGIN_REJECTED: NegotiationError = {
  status: 403,
  code: "auth.forbidden",
  title: "Forbidden",
  detail: "Cross-origin request rejected.",
};

/**
 * No per-request runtime — the API cannot serve without its services.
 *
 * @since 0.1.0
 * @category constants
 */
export const SERVICE_UNAVAILABLE: NegotiationError = {
  status: 503,
  code: "unavailable",
  title: "Service Unavailable",
  detail: "The API is temporarily unavailable.",
};

const WRITE_METHODS = HashSet.make("POST", "PUT", "PATCH", "DELETE");

/**
 * Whether a method mutates state (so the cross-origin guard applies and
 * negotiation runs on `Content-Type` rather than `Accept`).
 *
 * @example
 * ```ts
 * import { isMutatingMethod } from "@thomasfosterau/effect-web"
 *
 * isMutatingMethod("patch") // true
 * isMutatingMethod("GET") // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isMutatingMethod = (method: string): boolean =>
  HashSet.has(WRITE_METHODS, method.toUpperCase());

/**
 * Encode a JSON:API document to its wire string. `Schema.fromJsonString` is
 * `JSON.stringify` in the encode direction, so the emitted bytes — key order
 * included — are identical to the hand-rolled call the applications had.
 */
const encodeJsonDocument = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * One JSON:API error object as this seam emits it.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonApiErrorObject {
  readonly status: string;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * The JSON:API error document this seam emits.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonApiErrorDocument {
  readonly errors: readonly [JsonApiErrorObject];
  readonly jsonapi: { readonly version: "1.1" };
}

/**
 * The JSON:API error document (`{ errors: [...], jsonapi: { version } }`)
 * for a {@link NegotiationError}, as a value.
 *
 * @example
 * ```ts
 * import { CROSS_ORIGIN_REJECTED, jsonApiErrorDocument } from "@thomasfosterau/effect-web"
 *
 * jsonApiErrorDocument(CROSS_ORIGIN_REJECTED).errors[0].status // "403"
 * ```
 *
 * @since 0.1.0
 * @category encoding
 */
export const jsonApiErrorDocument = (error: NegotiationError): JsonApiErrorDocument => ({
  errors: [
    {
      status: error.status.toString(),
      code: error.code,
      title: error.title,
      detail: error.detail,
    },
  ],
  jsonapi: { version: "1.1" },
});

/**
 * Serialises a {@link NegotiationError} into a JSON:API error response
 * carrying the JSON:API media type.
 *
 * @example
 * ```ts
 * import * as Headers from "effect/unstable/http/Headers"
 * import { jsonApiErrorResponse, SERVICE_UNAVAILABLE } from "@thomasfosterau/effect-web"
 *
 * const response = jsonApiErrorResponse(SERVICE_UNAVAILABLE)
 * response.status // 503
 * Headers.get(response.headers, "content-type") // Option.some("application/vnd.api+json")
 * ```
 *
 * @since 0.1.0
 * @category encoding
 */
export const jsonApiErrorResponse = (
  error: NegotiationError,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text(encodeJsonDocument(jsonApiErrorDocument(error)), {
    status: error.status,
    contentType: JSONAPI_MEDIA_TYPE,
  });

/**
 * {@link jsonApiErrorResponse} as a Web `Response`, for a framework hook
 * that returns Fetch types.
 *
 * @example
 * ```ts
 * import { jsonApiErrorResponseWeb, CROSS_ORIGIN_REJECTED } from "@thomasfosterau/effect-web"
 *
 * const response = jsonApiErrorResponseWeb(CROSS_ORIGIN_REJECTED)
 * response.status // 403
 * response.headers.get("content-type") // "application/vnd.api+json"
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const jsonApiErrorResponseWeb = (error: NegotiationError): Response =>
  HttpServerResponse.toWeb(jsonApiErrorResponse(error));
