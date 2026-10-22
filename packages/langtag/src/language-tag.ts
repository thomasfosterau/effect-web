/**
 * BCP 47 language tags (RFC 5646): parse a tag, put it in canonical case,
 * and read its subtags.
 *
 * A {@link LanguageTag} is a branded string, always well-formed and in
 * canonical case, so two tags are equal exactly when they are `===`. This
 * checks well-formedness (the §2.1 ABNF), not validity: it does not consult
 * the IANA Language Subtag Registry, so `qq-Zzzz` is accepted and `iw` is
 * not mapped to `he`. Unlike `Intl.Locale`, it accepts every well-formed
 * tag, private-use (`x-whatever`) and grandfathered (`i-klingon`) ones
 * included.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { canonicalCase, parseParts, type Parts } from "./internal/grammar.ts";

/**
 * A well-formed BCP 47 language tag in canonical case (`en-US`, `zh-Hant-TW`,
 * `sr-Latn`, `x-private`, `i-klingon`). Make one with {@link parse} or
 * {@link LanguageTagFromString}.
 *
 * @since 0.1.0
 * @category schemas
 */
export const LanguageTag = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (tag: string) => parseParts(tag) !== undefined && canonicalCase(tag) === tag,
      {
        identifier: "LanguageTag",
        title: "BCP 47 language tag",
        description: "A well-formed BCP 47 language tag (RFC 5646) in canonical case.",
        expected: "a well-formed BCP 47 language tag in canonical case",
      },
    ),
  ),
  Schema.brand("LanguageTag"),
);

/**
 * A well-formed BCP 47 language tag in canonical case.
 *
 * @since 0.1.0
 * @category models
 */
export type LanguageTag = typeof LanguageTag.Type;

/**
 * Decodes any well-formed tag, in any case, to its canonical-case
 * {@link LanguageTag} (`en-us` → `en-US`, `ZH-HANT` → `zh-Hant`); a tag
 * that is not well-formed fails. Encodes a tag as itself.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * console.log(Schema.decodeUnknownSync(LanguageTag.LanguageTagFromString)("sr-latn-rs")) // "sr-Latn-RS"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const LanguageTagFromString: Schema.Codec<LanguageTag, string> = Schema.String.pipe(
  Schema.decodeTo(
    LanguageTag,
    SchemaTransformation.transform({ decode: canonicalCase, encode: (tag) => tag }),
  ),
);

/**
 * The decoded side of {@link LanguageTagFromString}: a {@link LanguageTag}.
 *
 * @since 0.1.0
 * @category models
 */
export type LanguageTagFromString = typeof LanguageTagFromString.Type;

/**
 * Parses a BCP 47 tag, in any case, into its canonical-case
 * {@link LanguageTag}; `None` when it is not well-formed.
 *
 * @example
 * ```ts
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageTag.parse("en-us")) // { _id: "Option", _tag: "Some", value: "en-US" }
 * console.log(LanguageTag.parse("en-")._tag) // "None"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const parse = (tag: string): Option.Option<LanguageTag> => decodeOption(tag);

const decodeOption = Schema.decodeUnknownOption(LanguageTagFromString);

/**
 * Whether `tag` is a well-formed BCP 47 tag, in any case.
 *
 * @example
 * ```ts
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * console.log(LanguageTag.isWellFormed("de-CH-1996")) // true
 * console.log(LanguageTag.isWellFormed("de-419-DE")) // false: two regions
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isWellFormed = (tag: string): boolean => parseParts(tag) !== undefined;

/**
 * One extension of a tag (RFC 5646 §2.2.6): its `singleton` (`u`, `t`, …)
 * and the subtags after it, lowercase.
 *
 * @since 0.1.0
 * @category models
 */
export interface Extension {
  readonly singleton: string;
  readonly subtags: ReadonlyArray<string>;
}

/**
 * A tag split by production, each subtag in canonical case.
 *
 * - `kind` — `"langtag"` (the ordinary form), `"privateuse"` (a tag that
 *   is only `x-…`) or `"grandfathered"` (one of the §2.2.8 legacy tags,
 *   which has no parts: every member below is empty).
 * - `language` — the primary language subtag (`en`); `None` unless `kind`
 *   is `"langtag"`.
 * - `extlangs` — extended language subtags (`zh-yue` → `["yue"]`).
 * - `script` (`Latn`), `region` (`US`, `419`) — `None` when absent.
 * - `variants` — `["1996"]` in `de-CH-1996`.
 * - `extensions` — `[{ singleton: "u", subtags: ["ca", "buddhist"] }]`.
 * - `privateUse` — the subtags after `x`, without it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Subtags {
  readonly kind: "langtag" | "privateuse" | "grandfathered";
  readonly language: Option.Option<string>;
  readonly extlangs: ReadonlyArray<string>;
  readonly script: Option.Option<string>;
  readonly region: Option.Option<string>;
  readonly variants: ReadonlyArray<string>;
  readonly extensions: ReadonlyArray<Extension>;
  readonly privateUse: ReadonlyArray<string>;
}

const EMPTY_PARTS: Parts = {
  kind: "grandfathered",
  language: undefined,
  extlangs: [],
  script: undefined,
  region: undefined,
  variants: [],
  extensions: [],
  privateUse: [],
};

/**
 * Splits a tag into its {@link Subtags}, in canonical case.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * const tag = Option.getOrThrow(LanguageTag.parse("zh-hant-tw-u-nu-hanidec"))
 * const subtags = LanguageTag.subtags(tag)
 * console.log(subtags.script, subtags.region, subtags.extensions)
 * // Some("Hant") Some("TW") [{ singleton: "u", subtags: ["nu", "hanidec"] }]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const subtags = (tag: LanguageTag): Subtags => {
  // A `LanguageTag` is well-formed by construction; the fallback is unreachable.
  const parts = parseParts(tag) ?? EMPTY_PARTS;
  return {
    kind: parts.kind,
    language: Option.fromUndefinedOr(parts.language),
    extlangs: parts.extlangs,
    script: Option.map(
      Option.fromUndefinedOr(parts.script),
      (script) => script.charAt(0).toUpperCase() + script.slice(1),
    ),
    region: Option.map(Option.fromUndefinedOr(parts.region), (region) => region.toUpperCase()),
    variants: parts.variants,
    extensions: parts.extensions,
    privateUse: parts.privateUse,
  };
};

/**
 * The primary language subtag (`en` in `en-GB`); `None` for a private-use
 * or grandfathered tag, which has none.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * const tag = Option.getOrThrow(LanguageTag.parse("pt-BR"))
 * console.log(LanguageTag.primaryLanguage(tag)) // { _id: "Option", _tag: "Some", value: "pt" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const primaryLanguage = (tag: LanguageTag): Option.Option<string> => subtags(tag).language;

/**
 * The script subtag (`Hant` in `zh-Hant-TW`); `None` when the tag has none.
 * An absent script is not "no script": a reader infers it from the
 * language (`Suppress-Script` in the registry).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * const tag = Option.getOrThrow(LanguageTag.parse("zh-Hant-TW"))
 * console.log(LanguageTag.script(tag)) // { _id: "Option", _tag: "Some", value: "Hant" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const script = (tag: LanguageTag): Option.Option<string> => subtags(tag).script;

/**
 * The region subtag (`GB` in `en-GB`, `419` in `es-419`); `None` when the
 * tag has none.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * const tag = Option.getOrThrow(LanguageTag.parse("es-419"))
 * console.log(LanguageTag.region(tag)) // { _id: "Option", _tag: "Some", value: "419" }
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const region = (tag: LanguageTag): Option.Option<string> => subtags(tag).region;

/** Scripts written right to left (ISO 15924), lowercase. */
const RTL_SCRIPTS: ReadonlyArray<string> = [
  "adlm",
  "arab",
  "aran",
  "armi",
  "avst",
  "cprt",
  "hebr",
  "khar",
  "mand",
  "mend",
  "nbat",
  "nkoo",
  "orkh",
  "palm",
  "phli",
  "phlp",
  "phnx",
  "rohg",
  "samr",
  "sarb",
  "sogd",
  "sogo",
  "syrc",
  "thaa",
  "yezi",
];

/**
 * Languages whose default script is written right to left. A language
 * written in several scripts is listed only when its usual script is
 * right-to-left (Kurdish, written mostly in Latin, is not; Central Kurdish,
 * `ckb`, is).
 */
const RTL_LANGUAGES: ReadonlyArray<string> = [
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "he",
  "iw",
  "ji",
  "ks",
  "lrc",
  "mzn",
  "nqo",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
];

/**
 * A text-direction hint for content in `tag`, for an HTML `dir`: `"rtl"`
 * when its script is written right to left (`az-Arab`), or when it has no
 * script and its language usually is (`ar`, `he`, `fa`, `ur`, `yi`, …);
 * `"ltr"` otherwise, private-use and grandfathered tags included. It is a
 * hint, not a lookup in CLDR: content that knows its direction says so.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { LanguageTag } from "@thomasfosterau/effect-langtag"
 *
 * const tag = (value: string) => Option.getOrThrow(LanguageTag.parse(value))
 * console.log(LanguageTag.direction(tag("ar-EG"))) // "rtl"
 * console.log(LanguageTag.direction(tag("az-Arab"))) // "rtl"
 * console.log(LanguageTag.direction(tag("en"))) // "ltr"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const direction = (tag: LanguageTag): "ltr" | "rtl" => {
  const parts = subtags(tag);
  const rtl = Option.match(parts.script, {
    onSome: (script) => RTL_SCRIPTS.includes(script.toLowerCase()),
    onNone: () =>
      Option.match(parts.language, {
        onSome: (language) => RTL_LANGUAGES.includes(language),
        onNone: () => false,
      }),
  });
  return rtl ? "rtl" : "ltr";
};
