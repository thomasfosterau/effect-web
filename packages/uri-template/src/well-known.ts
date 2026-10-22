/**
 * Well-known URIs (RFC 8615): `/.well-known/<suffix>` at the root of an
 * origin, where a site publishes site-wide metadata (`security.txt`, CSVW's
 * `csvm`, OpenID configuration).
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Suffixes in use by this family and common on the web, from the IANA
 * Well-Known URIs registry. {@link url} accepts any valid suffix; this type
 * is for naming the known ones and for a `switch` over them.
 *
 * @since 0.1.0
 * @category models
 */
export type RegisteredSuffix =
  | "acme-challenge"
  | "apple-app-site-association"
  | "assetlinks.json"
  | "change-password"
  | "csvm"
  | "dnt-policy.txt"
  | "gpc.json"
  | "host-meta"
  | "host-meta.json"
  | "mta-sts.txt"
  | "nodeinfo"
  | "oauth-authorization-server"
  | "openid-configuration"
  | "security.txt"
  | "webfinger";

/**
 * Every {@link RegisteredSuffix}, in alphabetical order.
 *
 * @since 0.1.0
 * @category models
 */
export const registeredSuffixes: ReadonlyArray<RegisteredSuffix> = [
  "acme-challenge",
  "apple-app-site-association",
  "assetlinks.json",
  "change-password",
  "csvm",
  "dnt-policy.txt",
  "gpc.json",
  "host-meta",
  "host-meta.json",
  "mta-sts.txt",
  "nodeinfo",
  "oauth-authorization-server",
  "openid-configuration",
  "security.txt",
  "webfinger",
];

/**
 * Why a well-known URL could not be built.
 *
 * - `InvalidSuffix` — not an RFC 3986 `segment-nz` (empty, `.`, `..`, or
 *   containing `/`, `?`, `#`, a space or another character that is not a
 *   `pchar`).
 * - `InvalidOrigin` — not an absolute `http`, `https`, `ws` or `wss` URL,
 *   the schemes RFC 8615 (and RFC 8307) define well-known URIs for.
 *
 * @since 0.1.0
 * @category errors
 */
export class WellKnownError extends Schema.TaggedError<WellKnownError>()("WellKnownError", {
  reason: Schema.Literals(["InvalidSuffix", "InvalidOrigin"]),
  message: Schema.String,
}) {}

/** `URL.parse` without its Node 22.1 floor: `null` for an invalid URL. */
const parseUrl = (url: string | URL): URL | null => (URL.canParse(url) ? new URL(url) : null);

/** RFC 3986 `segment-nz`: one or more `pchar`s. */
const SEGMENT_NZ = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/u;
const SCHEMES = ["http:", "https:", "ws:", "wss:"];

/**
 * Whether `suffix` may follow `/.well-known/`: a non-empty path segment
 * (RFC 3986 `segment-nz`) other than `.` and `..`.
 *
 * @example
 * ```ts
 * import { WellKnown } from "@thomasfosterau/effect-uri-template"
 *
 * console.log(WellKnown.isValidSuffix("security.txt"), WellKnown.isValidSuffix("a/b")) // true false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isValidSuffix = (suffix: string): boolean =>
  SEGMENT_NZ.test(suffix) && suffix !== "." && suffix !== "..";

/**
 * The well-known URL for `suffix` at the root of `origin`'s origin: any
 * path, query or fragment on `origin` is ignored, because RFC 8615 defines
 * well-known locations only at the root.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { WellKnown } from "@thomasfosterau/effect-uri-template"
 *
 * const url = WellKnown.url("https://example.org/tables/1.csv", "csvm")
 * console.log(Result.map(url, (url) => url.href)) // Success("https://example.org/.well-known/csvm")
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const url = (origin: string | URL, suffix: string): Result.Result<URL, WellKnownError> => {
  if (!isValidSuffix(suffix)) {
    return Result.fail(
      new WellKnownError({
        reason: "InvalidSuffix",
        message: `well-known: invalid suffix "${suffix}"`,
      }),
    );
  }
  const parsed = parseUrl(origin);
  return parsed === null || !SCHEMES.includes(parsed.protocol)
    ? Result.fail(
        new WellKnownError({
          reason: "InvalidOrigin",
          message: `well-known: invalid origin "${String(origin)}"`,
        }),
      )
    : Result.succeed(new URL(`/.well-known/${suffix}`, parsed.origin));
};

/**
 * The well-known suffix `url` addresses — the first path segment after
 * `/.well-known/` — or `None` when it is not a well-known URI.
 *
 * @example
 * ```ts
 * import { WellKnown } from "@thomasfosterau/effect-uri-template"
 *
 * console.log(WellKnown.suffixOf("https://example.org/.well-known/acme-challenge/token"))
 * // { _id: "Option", _tag: "Some", value: "acme-challenge" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const suffixOf = (url: string | URL): Option.Option<string> => {
  const parsed = parseUrl(url);
  const match = parsed === null ? null : /^\/\.well-known\/([^/]+)/u.exec(parsed.pathname);
  return Option.filter(Option.fromNullishOr(match?.[1]), isValidSuffix);
};
