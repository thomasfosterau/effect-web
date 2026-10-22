/**
 * Language negotiation: the language to serve, from the available tags and
 * an `Accept-Language` header, by RFC 4647 lookup.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import type * as Option from "effect/Option";
import { parse } from "./accept-language.ts";
import { lookup, matchesBasic } from "./language-range.ts";

/**
 * Chooses the language to serve from the `available` tags, for an
 * `Accept-Language` value (or `undefined` where the request had none):
 *
 * 1. a tag a `q=0` range matches (basic filtering) is never chosen;
 * 2. the remaining ranges, highest quality first, go to RFC 4647 lookup —
 *    `de-CH-1996` → `de-CH` → `de`, the first equal available tag wins;
 * 3. a `*` range accepts the first available tag left, at its place in
 *    the priority list.
 *
 * `None` when nothing is acceptable (or there was no header), for the
 * caller to serve its default. Returns the caller's own value from
 * `available`.
 *
 * @example
 * ```ts
 * import { negotiateLanguage } from "@thomasfosterau/effect-langtag"
 *
 * console.log(negotiateLanguage(["en", "de", "fr"], "de-CH, fr;q=0.8"))
 * // { _id: "Option", _tag: "Some", value: "de" }
 * console.log(negotiateLanguage(["en", "de"], "*, en;q=0")._tag) // "Some" — de, en is refused
 * ```
 *
 * @since 0.1.0
 * @category negotiation
 */
export const negotiateLanguage = <A extends string>(
  available: ReadonlyArray<A>,
  header: string | undefined,
): Option.Option<A> => {
  const preferences = header === undefined ? [] : parse(header);
  const accepted = Arr.filter(preferences, (preference) => preference.quality > 0);
  const refused = Arr.filter(preferences, (preference) => preference.quality === 0);
  const candidates = Arr.filter(
    available,
    (tag) => !Arr.some(refused, (preference) => matchesBasic(preference.range, tag)),
  );
  return Arr.findFirst(accepted, (preference) =>
    preference.range === "*" ? Arr.head(candidates) : lookup([preference.range], candidates),
  );
};
