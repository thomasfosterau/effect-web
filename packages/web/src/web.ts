/**
 * The Fetch-API adapter: applies a `Headers`-level policy from `./headers`
 * to a Web `Response` — the shape a SvelteKit `Handle` or a Worker `fetch`
 * export deals in. Everything else in this package is written over
 * `effect/unstable/http` types; `HttpServerRequest.fromWeb` /
 * `HttpServerResponse.toWeb` are the request and whole-response adapters,
 * and this module is the header-only one.
 *
 * `fetch()`-sourced responses (service bindings included) have immutable
 * headers in the Workers runtime, so a stamp clones the response only when
 * the policy actually changed something (`ensureCacheControl`'s "cheap
 * no-op path" in the applications).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Headers from "effect/unstable/http/Headers";

/**
 * The names whose value `next` sets differently from `previous` (a policy
 * never removes a header, so only additions and replacements matter).
 */
const changedEntries = (
  previous: Headers.Headers,
  next: Headers.Headers,
): ReadonlyArray<readonly [name: string, value: string]> =>
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- `Headers` carries a symbol-keyed `TypeId` member alongside its string keys; `Record.toEntries` types the values as the union of both, while `Object.entries` (which never yields symbol keys) keeps them `string`.
  Object.entries(next).filter(([name, value]) => previous[name] !== value);

/**
 * Applies a header policy to a Web `Response`. Returns the same instance
 * when the policy changed nothing; otherwise a clone (same status, same
 * body stream) carrying the policy's headers — a `fetch()`-sourced
 * response's headers are immutable, so mutation in place is never assumed.
 *
 * @example
 * ```ts
 * import { ensureCacheControl, securityHeaders, updateWebHeaders } from "@thomasfosterau/effect-web"
 *
 * const response = updateWebHeaders(new Response("hi"), (headers) => ensureCacheControl(securityHeaders(headers)))
 * response.headers.get("cache-control") // "private, no-store"
 * response.headers.get("x-content-type-options") // "nosniff"
 *
 * const declared = new Response("hi", { headers: { "cache-control": "no-store" } })
 * updateWebHeaders(declared, ensureCacheControl) === declared // true — nothing to stamp, no clone
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const updateWebHeaders = (
  response: Response,
  policy: (headers: Headers.Headers) => Headers.Headers,
): Response => {
  const previous = Headers.fromInput(response.headers);
  return Arr.match(changedEntries(previous, policy(previous)), {
    onEmpty: () => response,
    onNonEmpty: (changes) => {
      const stamped = new Response(response.body, response);
      changes.forEach(([name, value]) => stamped.headers.set(name, value));
      return stamped;
    },
  });
};

/**
 * Applies a header policy in place to a mutable Web `Headers` — a
 * SvelteKit `resolve()` response's headers, which the applications' hooks
 * mutate directly.
 *
 * @example
 * ```ts
 * import { securityHeaders, applyToWebHeaders } from "@thomasfosterau/effect-web"
 *
 * const headers = new Headers({ "x-frame-options": "SAMEORIGIN" })
 * applyToWebHeaders(headers, securityHeaders)
 * headers.get("x-frame-options") // "SAMEORIGIN"
 * headers.get("referrer-policy") // "strict-origin-when-cross-origin"
 * ```
 *
 * @since 0.1.0
 * @category adapters
 */
export const applyToWebHeaders = (
  target: globalThis.Headers,
  policy: (headers: Headers.Headers) => Headers.Headers,
): void => {
  const previous = Headers.fromInput(target);
  changedEntries(previous, policy(previous)).forEach(([name, value]) => target.set(name, value));
};
