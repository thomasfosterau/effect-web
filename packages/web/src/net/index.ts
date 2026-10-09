/**
 * Outbound-request safety primitives shared by every Worker: the lexical
 * SSRF host block list and the redirect-revalidating fetch built on it
 * (SEC-SSRF-003).
 *
 * The core is an `Effect` with tagged failures ({@link UnsafeUrl},
 * {@link RedirectRejected}, {@link FetchFailed}). A plain-`Promise` /
 * plain-`Error` surface ({@link assertAllowedUrl},
 * {@link fetchFollowingRedirects}) is kept as an adapter over it, throwing
 * or rejecting with a plain `Error` carrying the failure's message, with the
 * tagged {@link UnsafeUrl} / {@link RedirectRejected} as its `cause` (a
 * `fetch` failure rejects with its original cause instead), so a SvelteKit
 * route or a queue consumer can use the guard without running Effect itself
 * and still read the structured failure (`reason`, `url`). That `cause` can
 * be read in the same realm only: across `structuredClone` / `postMessage` /
 * Workers RPC it arrives as a plain `Error` that keeps only its message.
 *
 * DNS rebinding to a private IP is moot: Workers' outbound `fetch` runs on
 * Cloudflare's edge with no private network behind it, so the lexical block
 * list is the operative guard.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/** Matches IPv4 dotted-quad literals (loose — value range checked separately). */
const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Non-routable / reserved IPv4 ranges, expressed as inclusive ranges over the
 * first two octets (`a * 256 + b`).
 */
const PRIVATE_IPV4_PREFIX_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 255], // 0.0.0.0/8 — "this network"
  [10 * 256, 10 * 256 + 255], // 10.0.0.0/8 — RFC 1918
  [100 * 256 + 64, 100 * 256 + 127], // 100.64.0.0/10 — CGNAT (RFC 6598)
  [127 * 256, 127 * 256 + 255], // 127.0.0.0/8 — loopback
  [169 * 256 + 254, 169 * 256 + 254], // 169.254.0.0/16 — link-local
  [172 * 256 + 16, 172 * 256 + 31], // 172.16.0.0/12 — RFC 1918
  [192 * 256 + 168, 192 * 256 + 168], // 192.168.0.0/16 — RFC 1918
];

const isPrivateIpv4 = (host: string): boolean => {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet > 255)) {
    // Malformed dotted quad — treat as private to be safe.
    return true;
  }
  // Fold the first two octets into the `a * 256 + b` prefix without indexing
  // (and so without a non-null assertion); the length check above guarantees
  // exactly two elements reach the reducer.
  const prefix = octets.slice(0, 2).reduce((acc, octet) => acc * 256 + octet, 0);
  return PRIVATE_IPV4_PREFIX_RANGES.some(([low, high]) => prefix >= low && prefix <= high);
};

/** Hostnames that always resolve to loopback / internal networks. */
const BLOCKED_HOSTNAMES: ReadonlyArray<string> = ["localhost"];

/** Hostname suffixes reserved for non-public name resolution. */
const BLOCKED_HOST_SUFFIXES: ReadonlyArray<string> = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

/** IPv4-mapped (`::ffff:0:0/96`) and NAT64 (`64:ff9b::/96`) IPv6 prefixes. */
const IPV4_MAPPED_PREFIX = /^(?:::ffff:|64:ff9b::)/;

/** IPv6 prefixes covering loopback, ULA (fc00::/7), and link-local (fe80::/10). */
const BLOCKED_IPV6_PREFIXES: ReadonlyArray<string> = ["fc", "fd", "fe8", "fe9", "fea", "feb"];

/**
 * Extracts the IPv4 address embedded in an IPv4-mapped (`::ffff:0:0/96`) or
 * NAT64 well-known-prefix (`64:ff9b::/96`) IPv6 literal, so the IPv4 block
 * list applies to it — `http://[::ffff:127.0.0.1]/` must be as blocked as
 * `http://127.0.0.1/`. Accepts both the dotted form (`::ffff:127.0.0.1`) and
 * the hex-group form the WHATWG URL parser canonicalises to
 * (`::ffff:7f00:1`). `None` for every other IPv6 shape.
 */
const embeddedIpv4 = (v6: string): Option.Option<string> => {
  if (!IPV4_MAPPED_PREFIX.test(v6)) return Option.none();
  const rest = v6.replace(IPV4_MAPPED_PREFIX, "");
  if (rest.includes(".")) return Option.some(rest);
  const groups = rest.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return Option.none();
  }
  // Exactly two hex groups here, each split into its high and low byte — the
  // four dotted-quad octets, built without indexing into `groups`.
  return Option.some(
    groups
      .flatMap((group) => {
        const value = Number.parseInt(group, 16);
        return [value >> 8, value & 0xff];
      })
      .join("."),
  );
};

/**
 * Hostnames no outbound request is ever made to: loopback/internal names,
 * private and link-local IPv4 literals, and loopback/ULA/link-local IPv6
 * literals (IPv4-mapped and NAT64 forms included).
 *
 * The trailing root dot is stripped before any matching. `localhost.` is the
 * fully-qualified spelling of `localhost`: the WHATWG URL parser preserves
 * the dot in `.hostname` and DNS resolves the two identically — but it
 * defeats both the exact-match and the suffix-match arm, so without this a
 * bare `http://localhost./` walks straight through the guard.
 *
 * @example
 * ```ts
 * import { isBlockedHost } from "@thomasfosterau/effect-web/net"
 *
 * isBlockedHost("169.254.169.254") // true
 * isBlockedHost("localhost.") // true
 * isBlockedHost("[::ffff:7f00:1]") // true
 * isBlockedHost("example.com") // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isBlockedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.+$/, "");

  if (
    BLOCKED_HOSTNAMES.includes(host) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return true;
  }

  if (IPV4_PATTERN.test(host)) {
    return isPrivateIpv4(host);
  }

  // IPv6 literals appear bracketed in URL.hostname.
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    if (v6 === "::1" || v6 === "::" || BLOCKED_IPV6_PREFIXES.some((p) => v6.startsWith(p))) {
      return true;
    }
    // IPv4-mapped / NAT64 literals smuggle an IPv4 destination past the
    // dotted-quad check above — re-route them through the IPv4 block list.
    return Option.match(embeddedIpv4(v6), { onNone: () => false, onSome: isPrivateIpv4 });
  }

  return false;
};

/**
 * Why a URL fails the outbound-request safety policy.
 *
 * @since 0.1.0
 * @category models
 */
export type UnsafeUrlReason = "invalid" | "scheme" | "credentials" | "blocked-host";

/**
 * A URL that fails the outbound-request safety policy ({@link checkUrl}).
 * `message` carries fixed wording (`invalid URL '…'`, `unsupported scheme
 * '…'`, `embedded credentials in '…'`, `blocked host '…'`), kept stable
 * because callers' tests pin it.
 *
 * @since 0.1.0
 * @category errors
 */
export class UnsafeUrl extends Schema.TaggedError<UnsafeUrl>()("UnsafeUrl", {
  url: Schema.String,
  reason: Schema.Literals(["invalid", "scheme", "credentials", "blocked-host"]),
  message: Schema.String,
}) {}

/**
 * Parses and validates a URL against the outbound-request safety policy:
 * http(s) scheme only, no embedded credentials, host not on the SSRF block
 * list ({@link isBlockedHost}). The single check every caller that validates
 * a URL before requesting it (or letting something else request it) runs —
 * {@link followRedirects}' per-hop guard and a Browser Rendering navigation
 * guard (SEC-SSRF-003) alike.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { checkUrl } from "@thomasfosterau/effect-web/net"
 *
 * Result.isSuccess(checkUrl("https://example.com/page")) // true
 * Result.match(checkUrl("http://127.0.0.1/"), { onFailure: (e) => e.reason, onSuccess: () => "ok" }) // "blocked-host"
 * ```
 *
 * @since 0.1.0
 * @category validation
 */
export const checkUrl = (url: string): Result.Result<URL, UnsafeUrl> => {
  const parsed = URL.parse(url);
  if (parsed === null) {
    return Result.fail(new UnsafeUrl({ url, reason: "invalid", message: `invalid URL '${url}'` }));
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Result.fail(
      new UnsafeUrl({ url, reason: "scheme", message: `unsupported scheme '${parsed.protocol}'` }),
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return Result.fail(
      new UnsafeUrl({ url, reason: "credentials", message: `embedded credentials in '${url}'` }),
    );
  }
  if (isBlockedHost(parsed.hostname)) {
    return Result.fail(
      new UnsafeUrl({ url, reason: "blocked-host", message: `blocked host '${parsed.hostname}'` }),
    );
  }
  return Result.succeed(parsed);
};

/**
 * {@link checkUrl} for plain (non-Effect) callers: returns the parsed URL or
 * throws a plain `Error` (not a typed failure) so it composes into whichever
 * failure channel the caller uses. The thrown `Error` carries the
 * {@link UnsafeUrl}'s message, and its `cause` is that `UnsafeUrl`, so a
 * caller can read `reason` and `url` without running Effect.
 *
 * @example
 * ```ts
 * import { assertAllowedUrl, UnsafeUrl } from "@thomasfosterau/effect-web/net"
 *
 * assertAllowedUrl("https://example.com/page").href // "https://example.com/page"
 * let thrown: Error | undefined
 * try { assertAllowedUrl("ftp://example.com/") } catch (e) { thrown = e as Error }
 * thrown?.message // "unsupported scheme 'ftp:'"
 * thrown?.cause instanceof UnsafeUrl // true
 * ```
 *
 * @since 0.1.0
 * @category validation
 */
export const assertAllowedUrl = (url: string): URL =>
  Result.getOrThrowWith(checkUrl(url), (error) => new Error(error.message, { cause: error }));

/**
 * Why a redirect chain was refused.
 *
 * @since 0.1.0
 * @category models
 */
export type RedirectRejectedReason = "no-location" | "invalid-target" | "too-many-hops";

/**
 * A redirect chain {@link followRedirects} refused to continue: a 3xx with no
 * `Location`, an unparsable target, or more than `maxHops` hops.
 *
 * @since 0.1.0
 * @category errors
 */
export class RedirectRejected extends Schema.TaggedError<RedirectRejected>()("RedirectRejected", {
  url: Schema.String,
  reason: Schema.Literals(["no-location", "invalid-target", "too-many-hops"]),
  message: Schema.String,
}) {}

/**
 * The underlying `fetch` rejected (a network failure, a timeout signal).
 *
 * @since 0.1.0
 * @category errors
 */
export class FetchFailed extends Schema.TaggedError<FetchFailed>()("FetchFailed", {
  url: Schema.String,
  cause: Schema.Unknown,
}) {}

/** Maximum redirect hops followed before giving up. */
const MAX_REDIRECT_HOPS = 5;

/** HTTP status codes that carry a `Location` redirect. */
const REDIRECT_STATUSES: ReadonlyArray<number> = [301, 302, 303, 307, 308];

/**
 * A validated final response: the response itself and the URL the bytes
 * came from, which {@link checkUrl} passed.
 *
 * @since 0.1.0
 * @category models
 */
export interface FollowedResponse {
  readonly response: Response;
  readonly finalUrl: string;
}

/**
 * Options for {@link followRedirects}.
 *
 * @since 0.1.0
 * @category models
 */
export interface FollowRedirectsOptions {
  /**
   * Redirect hops followed before refusing. `0` is the shape for a POST whose
   * redirected replay would land the body at an unvalidated target: the host
   * guard still runs, and any 3xx becomes a rejection rather than a silent
   * second request. Defaults to 5.
   */
  readonly maxHops?: number | undefined;
  /** The `fetch` to call; defaults to the global. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * Fetches `url`, following redirects **manually** and re-running
 * {@link checkUrl} on the initial URL, every `Location` hop, and the final
 * resolved URL (SEC-SSRF-003). Auto-redirect is disabled, so a public host
 * that 30x-redirects to a private / link-local / loopback address, a
 * credentialed URL, or a non-http(s) scheme cannot bypass the producer-seam
 * guard, and the final URL the bytes came from is always validated.
 *
 * Pass a single shared `signal` in `init` (e.g. `AbortSignal.timeout(...)`)
 * so the whole redirect chain shares one deadline.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { followRedirects } from "@thomasfosterau/effect-web/net"
 *
 * const stub: typeof fetch = async (input) =>
 *   String(input) === "https://example.com/"
 *     ? new Response(null, { status: 302, headers: { location: "https://example.org/final" } })
 *     : new Response("ok")
 *
 * const { finalUrl } = await Effect.runPromise(followRedirects("https://example.com/", {}, { fetch: stub }))
 * finalUrl // "https://example.org/final"
 *
 * const refused = await Effect.runPromise(Effect.flip(followRedirects("http://127.0.0.1/", {}, { fetch: stub })))
 * refused._tag // "UnsafeUrl"
 * ```
 *
 * @since 0.1.0
 * @category fetching
 */
export const followRedirects = (
  url: string,
  init: RequestInit,
  options: FollowRedirectsOptions = {},
): Effect.Effect<FollowedResponse, UnsafeUrl | RedirectRejected | FetchFailed> => {
  const maxHops = options.maxHops ?? MAX_REDIRECT_HOPS;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const hop = (
    currentUrl: string,
    remaining: number,
  ): Effect.Effect<FollowedResponse, UnsafeUrl | RedirectRejected | FetchFailed> =>
    Effect.gen(function* () {
      // Validate the host about to be fetched. For hop 0 this re-asserts the
      // producer-seam guard; for later hops it validates the redirect target
      // *before* any request is made to it.
      yield* Effect.fromResult(checkUrl(currentUrl));
      const response = yield* Effect.tryPromise({
        try: () => fetchImpl(currentUrl, { ...init, redirect: "manual" }),
        catch: (cause) => new FetchFailed({ url: currentUrl, cause }),
      });
      if (!REDIRECT_STATUSES.includes(response.status)) {
        // Final hop: `currentUrl`'s host was validated above, so the bytes come
        // from a validated origin.
        return { response, finalUrl: currentUrl };
      }
      const location = Option.fromNullishOr(response.headers.get("location")).pipe(
        Option.filter((value) => value !== ""),
      );
      // Drain the redirect response body so the connection can be reused; a
      // failure to cancel is not a failure of the fetch.
      yield* Effect.tryPromise({
        try: () => response.body?.cancel() ?? Promise.resolve(),
        catch: (cause) => new FetchFailed({ url: currentUrl, cause }),
      }).pipe(Effect.ignore);
      if (Option.isNone(location)) {
        return yield* new RedirectRejected({
          url: currentUrl,
          reason: "no-location",
          message: `redirect with no Location from '${currentUrl}'`,
        });
      }
      if (remaining === 0) {
        return yield* new RedirectRejected({
          url,
          reason: "too-many-hops",
          message: `too many redirects (> ${maxHops}) from '${url}'`,
        });
      }
      // Relative redirects resolve against the current URL; the next hop
      // validates the resolved host before fetching it.
      const next = URL.parse(location.value, currentUrl);
      if (next === null) {
        return yield* new RedirectRejected({
          url: currentUrl,
          reason: "invalid-target",
          message: `invalid redirect target '${location.value}'`,
        });
      }
      return yield* hop(next.toString(), remaining - 1);
    });
  return hop(url, maxHops);
};

/**
 * {@link followRedirects} for plain (non-Effect) callers, with the same
 * per-hop revalidation (SEC-SSRF-003), so it composes into whichever failure
 * channel the caller uses. An {@link UnsafeUrl} or {@link RedirectRejected}
 * rejects with a plain `Error` carrying the failure's message, whose `cause`
 * is that tagged failure (read `reason` and `url` from it without running
 * Effect). A `fetch` failure ({@link FetchFailed}) rejects with the original
 * value `fetch` rejected with, unwrapped. The structured `cause` can be read
 * in the same realm only: across `structuredClone` / `postMessage` / Workers
 * RPC it arrives as a plain `Error` that keeps only its message.
 *
 * @example
 * ```ts
 * import { fetchFollowingRedirects, UnsafeUrl } from "@thomasfosterau/effect-web/net"
 *
 * const stub: typeof fetch = async () => new Response("ok")
 * const { response, finalUrl } = await fetchFollowingRedirects("https://example.com/page", {}, 5, stub)
 * finalUrl // "https://example.com/page"
 * response.status // 200
 *
 * const refused = await fetchFollowingRedirects("http://127.0.0.1/", {}, 5, stub).then(
 *   () => undefined,
 *   (error: Error) => error,
 * )
 * refused?.message // "blocked host '127.0.0.1'"
 * refused?.cause instanceof UnsafeUrl // true
 * ```
 *
 * @since 0.1.0
 * @category fetching
 */
export const fetchFollowingRedirects = (
  url: string,
  init: RequestInit,
  maxHops: number = MAX_REDIRECT_HOPS,
  fetchImpl?: typeof globalThis.fetch,
): Promise<FollowedResponse> =>
  Effect.runPromise(
    followRedirects(url, init, { maxHops, fetch: fetchImpl }).pipe(
      Effect.catchTag("FetchFailed", (error) => Effect.die(error.cause)),
      Effect.catch((error) => Effect.die(new Error(error.message, { cause: error }))),
    ),
  );
