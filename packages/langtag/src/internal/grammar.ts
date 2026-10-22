/**
 * The RFC 5646 §2.1 grammar: a total parse of a tag into {@link Parts}
 * (`undefined` for a tag that is not well-formed), and the §2.1.1 case
 * conventions.
 *
 * The grammar matches the lowercased tag, so it never has to think about
 * case; {@link canonicalCase} puts it back.
 */

import * as Arr from "effect/Array";
import * as Option from "effect/Option";

/** One extension: its singleton and the subtags after it, lowercase. */
export interface ExtensionParts {
  readonly singleton: string;
  readonly subtags: ReadonlyArray<string>;
}

/** A well-formed tag, split by production; every subtag lowercase. */
export interface Parts {
  readonly kind: "langtag" | "privateuse" | "grandfathered";
  readonly language: string | undefined;
  readonly extlangs: ReadonlyArray<string>;
  readonly script: string | undefined;
  readonly region: string | undefined;
  readonly variants: ReadonlyArray<string>;
  readonly extensions: ReadonlyArray<ExtensionParts>;
  readonly privateUse: ReadonlyArray<string>;
}

/**
 * The grandfathered tags (RFC 5646 §2.2.8), lowercase, mapped to their
 * registered case. The `regular` ones also match the `langtag` production;
 * they are still read as grandfathered, as §2.1 requires.
 */
const GRANDFATHERED: ReadonlyArray<string> = [
  // irregular
  "en-GB-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "sgn-BE-FR",
  "sgn-BE-NL",
  "sgn-CH-DE",
  // regular
  "art-lojban",
  "cel-gaulish",
  "no-bok",
  "no-nyn",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
];

/** The registered form of a grandfathered tag, matched case-insensitively. */
const grandfathered = (lower: string): string | undefined =>
  GRANDFATHERED.find((tag) => tag.toLowerCase() === lower);

const ALPHA = /^[a-z]+$/;

/**
 * The `langtag` production (RFC 5646 §2.1) over a lowercase tag. Each
 * subtag kind has a distinct shape (a script is 4 letters, a region 2
 * letters or 3 digits, a variant 5–8 alphanumerics or a digit and 3, a
 * singleton one character), so the match is unambiguous.
 */
const LANGTAG =
  /^(?:(?<language>[a-z]{2,3})(?<extlangs>(?:-[a-z]{3}){0,3})|(?<long>[a-z]{4,8}))(?:-(?<script>[a-z]{4}))?(?:-(?<region>[a-z]{2}|[0-9]{3}))?(?<variants>(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*)(?<extensions>(?:-[0-9a-wyz](?:-[a-z0-9]{2,8})+)*)(?:-x(?<privateuse>(?:-[a-z0-9]{1,8})+))?$/;

/** The `privateuse` production, as a whole tag. */
const PRIVATEUSE = /^x(?<privateuse>(?:-[a-z0-9]{1,8})+)$/;

/** `-a-b-c` → `["a", "b", "c"]`; `""` or `undefined` → `[]`. */
const subtagsOf = (group: string | undefined): ReadonlyArray<string> =>
  Arr.filter((group ?? "").split("-"), (subtag) => subtag !== "");

/** A singleton: one alphanumeric character other than `x`, which opens private use. */
const isSingleton = (subtag: string): boolean => subtag.length === 1 && subtag !== "x";

const NO_EXTENSIONS: ReadonlyArray<ExtensionParts> = [];

/** `-u-ca-chinese-a-foo` → one entry per singleton, with the subtags after it. */
const extensionsOf = (group: string | undefined): ReadonlyArray<ExtensionParts> =>
  Arr.reduce(subtagsOf(group), NO_EXTENSIONS, (found, subtag) => {
    if (isSingleton(subtag)) return [...found, { singleton: subtag, subtags: [] }];
    const last = Arr.last(found);
    return Option.match(last, {
      onNone: () => found,
      onSome: (extension) => [
        ...Arr.dropRight(found, 1),
        { singleton: extension.singleton, subtags: [...extension.subtags, subtag] },
      ],
    });
  });

const EMPTY: Omit<Parts, "kind"> = {
  language: undefined,
  extlangs: [],
  script: undefined,
  region: undefined,
  variants: [],
  extensions: [],
  privateUse: [],
};

/** Parses a tag into its {@link Parts}; `undefined` when it is not well-formed. */
export const parseParts = (tag: string): Parts | undefined => {
  const lower = tag.toLowerCase();
  if (grandfathered(lower) !== undefined) return { kind: "grandfathered", ...EMPTY };
  const privateOnly = PRIVATEUSE.exec(lower)?.groups;
  if (privateOnly !== undefined) {
    return { kind: "privateuse", ...EMPTY, privateUse: subtagsOf(privateOnly["privateuse"]) };
  }
  const groups = LANGTAG.exec(lower)?.groups;
  if (groups === undefined) return undefined;
  return {
    kind: "langtag",
    language: groups["language"] ?? groups["long"],
    extlangs: subtagsOf(groups["extlangs"]),
    script: groups["script"],
    region: groups["region"],
    variants: subtagsOf(groups["variants"]),
    extensions: extensionsOf(groups["extensions"]),
    privateUse: subtagsOf(groups["privateuse"]),
  };
};

/** The case of one subtag: uppercase a region, title-case a script, lowercase the rest. */
const caseSubtag = (subtag: string, index: number, afterSingleton: boolean): string => {
  if (index === 0 || afterSingleton) return subtag;
  if (subtag.length === 2 && ALPHA.test(subtag)) return subtag.toUpperCase();
  if (subtag.length === 4 && ALPHA.test(subtag)) return subtag[0]?.toUpperCase() + subtag.slice(1);
  return subtag;
};

/**
 * Applies the RFC 5646 §2.1.1 case conventions: lowercase throughout, but a
 * two-letter subtag (a region) uppercase and a four-letter one (a script)
 * title-case, except as the first subtag or anywhere after a singleton
 * (extensions and private use stay lowercase). A grandfathered tag takes
 * its registered case. Any string is accepted; whether it is well-formed is
 * {@link parseParts}'s question.
 */
export const canonicalCase = (tag: string): string => {
  const lower = tag.toLowerCase();
  const registered = grandfathered(lower);
  if (registered !== undefined) return registered;
  let afterSingleton = false;
  return lower
    .split("-")
    .map((subtag, index) => {
      const cased = caseSubtag(subtag, index, afterSingleton);
      // `x` (private use) counts too, first subtag or not.
      if (subtag.length === 1) afterSingleton = true;
      return cased;
    })
    .join("-");
};
