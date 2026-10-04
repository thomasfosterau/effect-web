/**
 * The trusted client address for an outbound `x-forwarded-for` (an analytics
 * reverse proxy, say).
 *
 * Ported from the website / gardeneria `client-ip.ts`.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import * as String from "effect/String";

/**
 * The platform-resolved client address (Cloudflare's `CF-Connecting-IP`,
 * surfaced through SvelteKit's `getClientAddress()` or a Worker request's
 * headers), or `None` when the resolver threw or resolved to a blank string.
 * Never the inbound `x-forwarded-for` request header — a client can spoof
 * that to poison analytics geo data (SEC-SSRF-005) — so a caller that can't
 * determine a trustworthy address must forward none rather than fall back
 * to the untrusted header.
 *
 * `getClientAddress` is a thunk because SvelteKit's throws when the platform
 * cannot determine an address; the throw is the `None` case.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { resolveClientIp } from "@thomasfosterau/effect-web"
 *
 * resolveClientIp(() => "203.0.113.7") // Option.some("203.0.113.7")
 * resolveClientIp(() => "") // Option.none()
 * Option.isNone(resolveClientIp(() => { throw new Error("no address") })) // true
 * ```
 *
 * @since 0.1.0
 * @category resolvers
 */
export const resolveClientIp = (getClientAddress: () => string): Option.Option<string> => {
  // oxlint-disable-next-line effect/avoid-try-catch -- plain framework glue, outside any Effect runtime: the resolver throws when the platform cannot determine an address, and SEC-SSRF-005 requires forwarding no IP in that case rather than falling back to the spoofable `x-forwarded-for`.
  try {
    return Option.filter(Option.some(getClientAddress()), String.isNonEmpty);
  } catch {
    return Option.none();
  }
};
