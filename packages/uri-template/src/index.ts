/**
 * `@thomasfosterau/effect-uri-template` — URI Templates (RFC 6570), Web
 * Linking (RFC 8288) and well-known URIs (RFC 8615) on Effect.
 *
 * - `UriTemplate` — parse a template, expand it at all four levels, list
 *   its variables.
 * - `LinkHeader` — the `Link` header: parse (resolving against a base),
 *   serialise, find links by relation type.
 * - `WellKnown` — build and recognise `/.well-known/<suffix>` URLs.
 *
 * @since 0.1.0
 */
export * as LinkHeader from "./link-header.ts";
export * as UriTemplate from "./uri-template.ts";
export * as WellKnown from "./well-known.ts";
