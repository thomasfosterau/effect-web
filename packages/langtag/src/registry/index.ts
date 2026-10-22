/**
 * `@thomasfosterau/effect-langtag/registry` — BCP 47 validity and
 * canonicalisation against a snapshot of the IANA Language Subtag Registry
 * (RFC 5646 §3).
 *
 * The root entry checks that a tag is *well-formed*; this one checks that
 * it is *valid* (every subtag registered for its position, RFC 5646
 * §2.2.9) and puts it in *canonical form* (RFC 5646 §4.5: deprecated
 * subtags replaced by their `Preferred-Value`, extensions in singleton
 * order). It is a separate entry because the snapshot is ~45 KB: a
 * consumer that only parses and matches tags never bundles it.
 *
 * The snapshot's date is {@link registryDate}; a subtag registered after it
 * reads as unregistered until the snapshot is regenerated.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { type Extension, type LanguageTag, parse, type Subtags, subtags } from "../language-tag.ts";
import {
  EXTLANGS,
  FILE_DATE,
  LANGUAGES,
  PREFERRED_EXTLANGS,
  PREFERRED_LANGUAGES,
  PREFERRED_REGIONS,
  PREFERRED_SCRIPTS,
  PREFERRED_TAGS,
  PREFERRED_VARIANTS,
  REGIONS,
  SCRIPTS,
  SUPPRESS_SCRIPTS,
  VARIANTS,
} from "../internal/registry-data.ts";

/**
 * The `File-Date` of the registry snapshot this entry validates against
 * (`YYYY-MM-DD`).
 *
 * @example
 * ```ts
 * import { registryDate } from "@thomasfosterau/effect-langtag/registry"
 *
 * console.log(/^\d{4}-\d{2}-\d{2}$/.test(registryDate)) // true
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export const registryDate: string = FILE_DATE;

/** Whether `subtag` is in the space-delimited `list`, ignoring case. */
const listed = (list: string, subtag: string): boolean =>
  list.includes(` ${subtag.toLowerCase()} `);

/** The value `key` maps to in the space-delimited `key:value` `map`, ignoring the key's case. */
const mapped = (map: string, key: string): Option.Option<string> => {
  const needle = ` ${key.toLowerCase()}:`;
  const at = map.indexOf(needle);
  if (at < 0) return Option.none();
  const start = at + needle.length;
  return Option.some(map.slice(start, map.indexOf(" ", start)));
};

const isUnique = (values: ReadonlyArray<string>): boolean =>
  Arr.dedupe(Arr.map(values, (value) => value.toLowerCase())).length === values.length;

/** Every subtag of a `langtag` registered for its position. */
const registered = (parts: Subtags): boolean =>
  Option.exists(parts.language, (language) => listed(LANGUAGES, language)) &&
  Arr.every(parts.extlangs, (extlang) => listed(EXTLANGS, extlang)) &&
  Option.match(parts.script, { onNone: () => true, onSome: (script) => listed(SCRIPTS, script) }) &&
  Option.match(parts.region, { onNone: () => true, onSome: (region) => listed(REGIONS, region) }) &&
  Arr.every(parts.variants, (variant) => listed(VARIANTS, variant));

/**
 * Whether `tag` is *valid* (RFC 5646 §2.2.9): a grandfathered or private-use
 * tag, or one whose language, extended language, script, region and
 * variant subtags are all registered, with no variant and no extension
 * singleton repeated. Private-use and extension subtags are not checked
 * against the registry (they have none).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 * import { isValid } from "@thomasfosterau/effect-langtag/registry"
 *
 * const tag = (value: string) => Option.getOrThrow(LanguageTag.parse(value))
 * console.log(isValid(tag("de-CH-1996"))) // true
 * console.log(isValid(tag("qq-Zzzz"))) // false: "qq" is not a registered language
 * console.log(isValid(tag("de-DE-1901-1901"))) // false: a repeated variant
 * ```
 *
 * @since 0.1.0
 * @category validation
 */
export const isValid = (tag: LanguageTag): boolean => {
  const parts = subtags(tag);
  if (parts.kind !== "langtag") return true;
  return (
    registered(parts) &&
    isUnique(parts.variants) &&
    isUnique(Arr.map(parts.extensions, (extension) => extension.singleton))
  );
};

/** The suppressed (implied) script of a language, if the registry gives one. */
const suppressedScriptOf = (language: string): Option.Option<string> =>
  mapped(SUPPRESS_SCRIPTS, language);

/**
 * The script a language is written in by default, which a tag need not
 * repeat (the registry's `Suppress-Script`): `Latn` for `en`, `Arab` for
 * `ar`; `None` when the language has several in common use (`zh`, `sr`).
 *
 * @example
 * ```ts
 * import { suppressScript } from "@thomasfosterau/effect-langtag/registry"
 *
 * console.log(suppressScript("en")) // { _id: "Option", _tag: "Some", value: "Latn" }
 * console.log(suppressScript("zh")._tag) // "None"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const suppressScript = (language: string): Option.Option<string> =>
  suppressedScriptOf(language);

/**
 * What {@link canonicalize} does beyond RFC 5646's canonical form:
 * `suppressScript` (default `false`) also drops a script equal to the
 * language's `Suppress-Script` (`en-Latn-US` → `en-US`), which RFC 5646
 * §4.1 recommends for tags a producer writes.
 *
 * @since 0.1.0
 * @category models
 */
export interface CanonicalizeOptions {
  readonly suppressScript?: boolean | undefined;
}

const preferred = (map: string, subtag: string): string =>
  Option.getOrElse(mapped(map, subtag), () => subtag);

const byOrder: Order.Order<Extension> = Order.mapInput(Order.String, (extension: Extension) =>
  extension.singleton.toLowerCase(),
);

/** A `langtag`'s parts in canonical form, as a tag string. */
const canonicalLangtag = (parts: Subtags, options: CanonicalizeOptions | undefined): string => {
  const primary = Option.getOrElse(parts.language, () => "");
  // An extlang's Preferred-Value is the language it is: `zh-yue` → `yue`.
  const language = Option.match(Arr.head(parts.extlangs), {
    onNone: () => preferred(PREFERRED_LANGUAGES, primary),
    onSome: (extlang) => preferred(PREFERRED_LANGUAGES, preferred(PREFERRED_EXTLANGS, extlang)),
  });
  const extlangs =
    Arr.isReadonlyArrayNonEmpty(parts.extlangs) &&
    Option.isSome(mapped(PREFERRED_EXTLANGS, parts.extlangs[0]))
      ? parts.extlangs.slice(1)
      : parts.extlangs;
  const script = Option.filter(
    Option.map(parts.script, (value) => preferred(PREFERRED_SCRIPTS, value)),
    (value) =>
      options?.suppressScript !== true ||
      !Option.exists(
        suppressedScriptOf(language),
        (implied) => implied.toLowerCase() === value.toLowerCase(),
      ),
  );
  const sorted: ReadonlyArray<Extension> = Arr.sort(parts.extensions, byOrder);
  return [
    language,
    ...extlangs,
    ...Option.toArray(script),
    ...Option.toArray(Option.map(parts.region, (value) => preferred(PREFERRED_REGIONS, value))),
    ...Arr.map(parts.variants, (variant) => preferred(PREFERRED_VARIANTS, variant)),
    ...Arr.flatMap(sorted, (extension) => [extension.singleton, ...extension.subtags]),
    ...(Arr.isReadonlyArrayNonEmpty(parts.privateUse) ? ["x", ...parts.privateUse] : []),
  ].join("-");
};

/**
 * Puts `tag` in canonical form (RFC 5646 §4.5): a grandfathered or
 * redundant tag with a `Preferred-Value` is replaced by it (`i-klingon` →
 * `tlh`, `zh-guoyu` → `cmn`); each deprecated subtag by its own (`iw` →
 * `he`, `in` → `id`, region `BU` → `MM`); an extended language by the
 * language it is (`zh-yue-HK` → `yue-HK`); and extensions sorted by
 * singleton. The result is again in canonical case. A tag with nothing to
 * replace comes back unchanged.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 * import { canonicalize } from "@thomasfosterau/effect-langtag/registry"
 *
 * const tag = (value: string) => Option.getOrThrow(LanguageTag.parse(value))
 * console.log(canonicalize(tag("iw-IL"))) // "he-IL"
 * console.log(canonicalize(tag("en-b-ccc-a-bbb"))) // "en-a-bbb-b-ccc"
 * console.log(canonicalize(tag("en-Latn-US"), { suppressScript: true })) // "en-US"
 * ```
 *
 * @since 0.1.0
 * @category canonicalization
 */
export const canonicalize = (
  tag: LanguageTag,
  options?: CanonicalizeOptions | undefined,
): LanguageTag => {
  const whole = Option.flatMap(mapped(PREFERRED_TAGS, tag), parse);
  const start = Option.getOrElse(whole, () => tag);
  const parts = subtags(start);
  if (parts.kind !== "langtag") return start;
  // Every replacement is a registered subtag of the same shape, so the
  // rebuilt tag is well-formed; the fallback is unreachable.
  return Option.getOrElse(parse(canonicalLangtag(parts, options)), () => start);
};
