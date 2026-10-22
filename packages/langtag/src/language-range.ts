/**
 * Language ranges and matching (RFC 4647): which of a set of language tags
 * a user's preferences select.
 *
 * - **Basic filtering** (§3.3.1) — a range matches a tag equal to it or
 *   beginning with it followed by `-`: `de-de` matches `de-DE-1996`, not
 *   `de-Deva`. `*` matches every tag.
 * - **Extended filtering** (§3.3.2) — a range's subtags match in order,
 *   skipping tag subtags between them, and `*` matches any subtag:
 *   `de-*-DE` matches `de-Latn-DE` and `de-DE-x-goethe`.
 * - **Lookup** (§3.4) — the single best tag: each range in turn, truncated
 *   from the end (`de-CH-1996` → `de-CH` → `de`, dropping a dangling
 *   singleton too) until it equals an available tag.
 *
 * Matching is case-insensitive throughout, and works on plain strings: the
 * tags need not be parsed first, and each function returns the caller's
 * own values (so a branded `LanguageTag` stays one).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";

const subtagsOf = (value: string): ReadonlyArray<string> => value.toLowerCase().split("-");

const BASIC_RANGE = /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/i;
const EXTENDED_RANGE = /^(?:[a-z]{1,8}|\*)(?:-(?:[a-z0-9]{1,8}|\*))*$/i;

/**
 * Whether `range` is a basic language range (RFC 4647 §2.1): `*`, or
 * alphabetic first subtag then alphanumeric ones (`en`, `de-CH`).
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.isBasic("en-US"), LanguageRange.isBasic("en-*")) // true false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isBasic = (range: string): boolean => BASIC_RANGE.test(range);

/**
 * Whether `range` is an extended language range (RFC 4647 §2.2): like a
 * basic one, but any subtag may be `*` (`*-CH`, `en-*-US`).
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.isExtended("*-CH")) // true
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isExtended = (range: string): boolean => EXTENDED_RANGE.test(range);

/**
 * Whether the basic range `range` matches `tag` (RFC 4647 §3.3.1): equal,
 * or a prefix of it ending at a `-`, ignoring case; `*` matches every tag.
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.matchesBasic("de-de", "de-DE-1996")) // true
 * console.log(LanguageRange.matchesBasic("de-de", "de-Deva")) // false
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const matchesBasic = (range: string, tag: string): boolean => {
  if (range === "*") return true;
  const lowerRange = range.toLowerCase();
  const lowerTag = tag.toLowerCase();
  return lowerTag === lowerRange || lowerTag.startsWith(`${lowerRange}-`);
};

/**
 * The position after `subtag` in `have`, searching from `from` and skipping
 * no singleton on the way (RFC 4647 §3.3.2 step 3); `None` if there is none.
 */
const skipTo = (
  have: ReadonlyArray<string>,
  from: number,
  subtag: string,
): Option.Option<number> => {
  const after = have.slice(from);
  const at = after.indexOf(subtag);
  const crossesSingleton = after.slice(0, Math.max(at, 0)).some((skipped) => skipped.length === 1);
  return at < 0 || crossesSingleton ? Option.none() : Option.some(from + at + 1);
};

/**
 * Whether the extended range `range` matches `tag` (RFC 4647 §3.3.2): its
 * first subtag equals the tag's (or is `*`); each later non-`*` subtag is
 * found, in order, among the tag's later subtags, skipping any but a
 * singleton (`a`–`z`, `0`–`9`), which no skip may cross.
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.matchesExtended("de-*-DE", "de-Latn-DE")) // true
 * console.log(LanguageRange.matchesExtended("de-DE", "de-x-DE")) // false: `x` is never skipped
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const matchesExtended = (range: string, tag: string): boolean => {
  const wanted = subtagsOf(range);
  const have = subtagsOf(tag);
  const [first, ...rest] = wanted;
  if (first !== "*" && first !== have[0]) return false;
  const end = Arr.reduce(rest, Option.some(1), (position, subtag) =>
    Option.flatMap(position, (from) =>
      subtag === "*" ? Option.some(from) : skipTo(have, from, subtag),
    ),
  );
  return Option.isSome(end);
};

const filterWith =
  (matches: (range: string, tag: string) => boolean) =>
  <A extends string>(ranges: ReadonlyArray<string>, tags: ReadonlyArray<A>): ReadonlyArray<A> =>
    Arr.dedupe(Arr.flatMap(ranges, (range) => Arr.filter(tags, (tag) => matches(range, tag))));

/**
 * Basic filtering (RFC 4647 §3.3.1): every tag some range in the priority
 * list `ranges` matches, in the order of the ranges (then of `tags`),
 * each once.
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.filterBasic(["de-CH", "en"], ["en-US", "de", "de-CH-1996", "fr"]))
 * // ["de-CH-1996", "en-US"]
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const filterBasic: <A extends string>(
  ranges: ReadonlyArray<string>,
  tags: ReadonlyArray<A>,
) => ReadonlyArray<A> = filterWith(matchesBasic);

/**
 * Extended filtering (RFC 4647 §3.3.2): every tag some extended range in
 * `ranges` matches, in the order of the ranges (then of `tags`), each once.
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.filterExtended(["*-CH"], ["de-CH", "fr-CH", "de-DE", "it-Latn-CH"]))
 * // ["de-CH", "fr-CH", "it-Latn-CH"]
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const filterExtended: <A extends string>(
  ranges: ReadonlyArray<string>,
  tags: ReadonlyArray<A>,
) => ReadonlyArray<A> = filterWith(matchesExtended);

/**
 * The truncation sequence lookup tries for one range (RFC 4647 §3.4): the
 * range itself, then each shorter prefix, a singleton left dangling at the
 * end removed along with the subtag after it.
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.fallbacks("zh-Hant-CN-x-private1-private2"))
 * // ["zh-Hant-CN-x-private1-private2", "zh-Hant-CN-x-private1", "zh-Hant-CN", "zh-Hant", "zh"]
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const fallbacks = (range: string): ReadonlyArray<string> => {
  const subtags = range.split("-");
  return Arr.map(
    // A prefix ending in a singleton is not tried: the singleton goes too.
    Arr.filter(
      Arr.makeBy(subtags.length, (index) => subtags.length - index),
      (end) => subtags[end - 1]?.length !== 1,
    ),
    (end) => subtags.slice(0, end).join("-"),
  );
};

/**
 * Lookup (RFC 4647 §3.4): the one available tag that best matches the
 * priority list `ranges`. Each range is tried in order, through its
 * {@link fallbacks}, against `tags` (ignoring case); the first match wins.
 * A `*` range is skipped, as §3.4 directs; `None` when nothing matches, for
 * the caller to supply its default.
 *
 * @example
 * ```ts
 * import { LanguageRange } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageRange.lookup(["de-CH-1996", "fr"], ["fr-FR", "de"]))
 * // { _id: "Option", _tag: "Some", value: "de" }
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const lookup = <A extends string>(
  ranges: ReadonlyArray<string>,
  tags: ReadonlyArray<A>,
): Option.Option<A> =>
  Arr.findFirst(
    Arr.flatMap(
      Arr.filter(ranges, (range) => range !== "*"),
      fallbacks,
    ),
    (candidate) => Arr.findFirst(tags, (tag) => tag.toLowerCase() === candidate.toLowerCase()),
  );
