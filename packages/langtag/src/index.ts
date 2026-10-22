/**
 * `@thomasfosterau/effect-langtag` — BCP 47 language tags (RFC 5646) and
 * language-range matching (RFC 4647) on Effect.
 *
 * - `LanguageTag` — parse a tag into canonical case (a branded string),
 *   its `Schema`, its subtags, and a text-direction hint.
 * - `LanguageRange` — basic and extended filtering, and lookup with its
 *   fallback truncation.
 * - `AcceptLanguage` — the `Accept-Language` header as a weighted priority
 *   list.
 * - `negotiateLanguage` — the language to serve, from the available tags
 *   and an `Accept-Language` header.
 *
 * @since 0.1.0
 */
export * as AcceptLanguage from "./accept-language.ts";
export * as LanguageRange from "./language-range.ts";
export * as LanguageTag from "./language-tag.ts";
export { negotiateLanguage } from "./negotiate.ts";
