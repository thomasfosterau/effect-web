/**
 * `@thomasfosterau/effect-mime` — MIME types, MIME sniffing and `data:`
 * URLs, after the WHATWG MIME Sniffing and Fetch standards.
 *
 * - `MimeType` — parse and serialise `type/subtype;name=value`, its
 *   essence and parameters, and a `Schema`.
 * - `Sniff` — what a resource is from its leading bytes and supplied
 *   type: images, audio and video, fonts, archives, HTML / XML / PDF, and
 *   text or binary, extensible with custom signatures.
 * - `Extension` — a curated extension ↔ MIME type table with a hook for
 *   custom entries.
 * - `DataUrl` — the `data:` URL processor: MIME type and body bytes.
 *
 * @since 0.1.0
 */
export * as DataUrl from "./data-url.ts";
export * as Extension from "./extension.ts";
export * as MimeType from "./mime-type.ts";
export * as Sniff from "./sniff.ts";
