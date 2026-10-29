/**
 * CSS Fonts 4 values: parse `font-family`, `font-weight`, `font-style`,
 * `font-size` and `line-height` into typed values, and the `font`
 * shorthand into all of them at once.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import * as Length from "./length.ts";
import { parseComponentValueList } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

/**
 * A `font-family` entry: a generic family keyword (`serif`, `system-ui`,
 * …) or a family name, from a string or a run of identifiers joined by
 * single spaces.
 *
 * @since 0.1.0
 * @category models
 */
export type FamilyName =
  | { readonly _tag: "Generic"; readonly name: string }
  | { readonly _tag: "Family"; readonly name: string };

/**
 * A `font-style`: `normal`, `italic`, or `oblique` with its angle in
 * degrees (14 when omitted).
 *
 * @since 0.1.0
 * @category models
 */
export type FontStyle =
  | { readonly _tag: "Normal" }
  | { readonly _tag: "Italic" }
  | { readonly _tag: "Oblique"; readonly angle: number };

/**
 * A `font-weight`: a number from 1 to 1000 (`normal` is 400, `bold` 700),
 * or `bolder` / `lighter`, which resolve against the parent's weight.
 *
 * @since 0.1.0
 * @category models
 */
export type FontWeight = number | "bolder" | "lighter";

/**
 * A `font-size`: an absolute-size keyword (`xx-small` to `xxx-large`),
 * `larger` / `smaller`, `math`, or a non-negative length or percentage.
 *
 * @since 0.1.0
 * @category models
 */
export type FontSize =
  | { readonly _tag: "Keyword"; readonly keyword: string }
  | { readonly _tag: "Length"; readonly length: Length.Length };

/**
 * A `line-height`: `normal`, a non-negative number (a multiple of the
 * font size), or a non-negative length or percentage.
 *
 * @since 0.1.0
 * @category models
 */
export type LineHeight =
  | { readonly _tag: "Normal" }
  | { readonly _tag: "Number"; readonly value: number }
  | { readonly _tag: "Length"; readonly length: Length.Length };

/**
 * The `font` shorthand, every longhand it sets. A part the shorthand
 * leaves out holds its initial value (`normal` for style, variant, weight,
 * width and line height). A system font (`caption`, `menu`, …) is
 * `SystemFont` instead.
 *
 * @since 0.1.0
 * @category models
 */
export type Font =
  | {
      readonly _tag: "Font";
      readonly style: FontStyle;
      readonly variant: "normal" | "small-caps";
      readonly weight: FontWeight;
      readonly width: string;
      readonly size: FontSize;
      readonly lineHeight: LineHeight;
      readonly family: ReadonlyArray<FamilyName>;
    }
  | { readonly _tag: "SystemFont"; readonly name: string };

const GENERIC_FAMILIES: ReadonlyArray<string> = [
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
];

/** Keywords a family name made of identifiers may not start with (CSS Fonts 4 §2.1.1). */
const RESERVED_FAMILY_KEYWORDS: ReadonlyArray<string> = [
  ...GENERIC_FAMILIES,
  "initial",
  "inherit",
  "unset",
  "default",
  "revert",
  "revert-layer",
];

const ABSOLUTE_SIZES: ReadonlyArray<string> = [
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
];

/** The `font-width` (`font-stretch`) keywords the `font` shorthand takes. */
const WIDTHS: ReadonlyArray<string> = [
  "normal",
  "ultra-condensed",
  "extra-condensed",
  "condensed",
  "semi-condensed",
  "semi-expanded",
  "expanded",
  "extra-expanded",
  "ultra-expanded",
];

const SYSTEM_FONTS: ReadonlyArray<string> = [
  "caption",
  "icon",
  "menu",
  "message-box",
  "small-caption",
  "status-bar",
];

type Values = ReadonlyArray<ComponentValue>;

const significant = (values: Values): Values =>
  values.filter((value) => !Predicate.isTagged(value, "Whitespace"));

const valuesOf = (input: string | Values): Values =>
  Predicate.isString(input) ? parseComponentValueList(input) : input;

const keyword = (value: ComponentValue): Option.Option<string> =>
  Predicate.isTagged(value, "Ident") ? Option.some(Str.toLowerCase(value.value)) : Option.none();

/** Exactly one significant component value, else `None`. */
const single = (input: string | Values): Option.Option<ComponentValue> => {
  const values = significant(valuesOf(input));
  const [only] = values;
  return values.length === 1 && only !== undefined ? Option.some(only) : Option.none();
};

/** The comma-separated groups of `values`, each without whitespace. */
const commaGroups = (values: Values): ReadonlyArray<Values> =>
  values
    .reduce<ReadonlyArray<Values>>(
      (groups, value) =>
        Predicate.isTagged(value, "Comma")
          ? [...groups, []]
          : [...groups.slice(0, -1), [...(groups.at(-1) ?? []), value]],
      [[]],
    )
    .map(significant);

const identValue = (value: ComponentValue): Option.Option<string> =>
  Predicate.isTagged(value, "Ident") ? Option.some(value.value) : Option.none();

/** A family name from identifiers: a lone generic keyword, or names not starting with a reserved keyword. */
const identFamily = (idents: Arr.NonEmptyReadonlyArray<string>): Option.Option<FamilyName> => {
  const head = Str.toLowerCase(Arr.headNonEmpty(idents));
  if (idents.length === 1 && GENERIC_FAMILIES.includes(head)) {
    return Option.some({ _tag: "Generic", name: head });
  }
  return RESERVED_FAMILY_KEYWORDS.includes(head)
    ? Option.none()
    : Option.some({ _tag: "Family", name: idents.join(" ") });
};

/** One `font-family` entry (CSS Fonts 4 §2.1). */
const familyName = (group: Values): Option.Option<FamilyName> => {
  const [first, ...rest] = group;
  if (Predicate.isTagged(first, "String") && Arr.isReadonlyArrayEmpty(rest)) {
    return Option.some({ _tag: "Family", name: first.value });
  }
  return Option.flatMap(Option.all(group.map(identValue)), (idents) =>
    Arr.isReadonlyArrayNonEmpty(idents) ? identFamily(idents) : Option.none(),
  );
};

/**
 * Parses `font-family`: a comma-separated list of generic families,
 * quoted names and unquoted names (identifiers joined by single spaces).
 * `None` for an empty entry or an unquoted name that starts with a
 * generic or CSS-wide keyword.
 *
 * @example
 * ```ts
 * import { Font } from "@thomasfosterau/effect-css"
 *
 * console.log(Font.parseFamily('"Helvetica Neue", Times New Roman, serif'))
 * // Option.some([{ _tag: "Family", name: "Helvetica Neue" }, { _tag: "Family", name: "Times New Roman" }, { _tag: "Generic", name: "serif" }])
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseFamily = (input: string | Values): Option.Option<ReadonlyArray<FamilyName>> =>
  Option.all(commaGroups(valuesOf(input)).map(familyName));

/** A `font-weight` from one component value. */
const weightOf = (value: ComponentValue): Option.Option<FontWeight> => {
  if (Predicate.isTagged(value, "Number")) {
    return value.value >= 1 && value.value <= 1000 ? Option.some(value.value) : Option.none();
  }
  return Option.flatMap(keyword(value), (name) => {
    if (name === "normal") return Option.some(400);
    if (name === "bold") return Option.some(700);
    return name === "bolder" || name === "lighter" ? Option.some(name) : Option.none();
  });
};

/**
 * Parses `font-weight`: `normal` (400), `bold` (700), `bolder`,
 * `lighter`, or a number from 1 to 1000.
 *
 * @example
 * ```ts
 * import { Font } from "@thomasfosterau/effect-css"
 *
 * console.log(Font.parseWeight("bold")) // Option.some(700)
 * console.log(Font.parseWeight("350")) // Option.some(350)
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseWeight = (input: string | Values): Option.Option<FontWeight> =>
  Option.flatMap(single(input), weightOf);

/** How many degrees one of an angle unit is (CSS Values 4 §7.1). */
const degreesPer = (unit: string): Option.Option<number> => {
  if (unit === "deg") return Option.some(1);
  if (unit === "grad") return Option.some(0.9);
  if (unit === "rad") return Option.some(180 / Math.PI);
  return unit === "turn" ? Option.some(360) : Option.none();
};

/** An oblique angle, in degrees, from -90 to 90. */
const obliqueAngle = (value: ComponentValue): Option.Option<number> =>
  Predicate.isTagged(value, "Dimension")
    ? Option.filter(
        Option.map(degreesPer(Str.toLowerCase(value.unit)), (factor) => value.value * factor),
        (degrees) => degrees >= -90 && degrees <= 90,
      )
    : Option.none();

/**
 * Parses `font-style`: `normal`, `italic`, or `oblique` with an optional
 * angle from -90deg to 90deg (14deg when omitted).
 *
 * @example
 * ```ts
 * import { Font } from "@thomasfosterau/effect-css"
 *
 * console.log(Font.parseStyle("oblique 10deg")) // Option.some({ _tag: "Oblique", angle: 10 })
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseStyle = (input: string | Values): Option.Option<FontStyle> => {
  const [first, second, ...rest] = significant(valuesOf(input));
  if (first === undefined || !Arr.isReadonlyArrayEmpty(rest)) return Option.none();
  return Option.flatMap(keyword(first), (name): Option.Option<FontStyle> => {
    if (name === "oblique") {
      return second === undefined
        ? Option.some({ _tag: "Oblique", angle: 14 })
        : Option.map(obliqueAngle(second), (angle) => ({ _tag: "Oblique", angle }));
    }
    if (second !== undefined) return Option.none();
    if (name === "normal") return Option.some({ _tag: "Normal" });
    return name === "italic" ? Option.some({ _tag: "Italic" }) : Option.none();
  });
};

/** A non-negative length or percentage. */
const nonNegativeLength = (value: ComponentValue): Option.Option<Length.Length> =>
  Option.filter(Length.parse(value), (length) => length.value >= 0);

const sizeOf = (value: ComponentValue): Option.Option<FontSize> =>
  Option.orElse(
    Option.map(nonNegativeLength(value), (length): FontSize => ({ _tag: "Length", length })),
    () =>
      Option.flatMap(keyword(value), (name) =>
        ABSOLUTE_SIZES.includes(name) || name === "larger" || name === "smaller" || name === "math"
          ? Option.some<FontSize>({ _tag: "Keyword", keyword: name })
          : Option.none(),
      ),
  );

/**
 * Parses `font-size`: an absolute-size keyword, `larger`, `smaller`,
 * `math`, or a non-negative length or percentage.
 *
 * @example
 * ```ts
 * import { Font } from "@thomasfosterau/effect-css"
 *
 * console.log(Font.parseSize("12pt")) // Option.some({ _tag: "Length", length: { value: 12, unit: "pt" } })
 * console.log(Font.parseSize("x-large")) // Option.some({ _tag: "Keyword", keyword: "x-large" })
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseSize = (input: string | Values): Option.Option<FontSize> =>
  Option.flatMap(single(input), sizeOf);

const lineHeightOf = (value: ComponentValue): Option.Option<LineHeight> => {
  if (Predicate.isTagged(value, "Number")) {
    return value.value >= 0 ? Option.some({ _tag: "Number", value: value.value }) : Option.none();
  }
  if (Option.exists(keyword(value), (name) => name === "normal")) {
    return Option.some({ _tag: "Normal" });
  }
  return Option.map(nonNegativeLength(value), (length): LineHeight => ({ _tag: "Length", length }));
};

/**
 * Parses `line-height`: `normal`, a non-negative number, or a
 * non-negative length or percentage.
 *
 * @example
 * ```ts
 * import { Font } from "@thomasfosterau/effect-css"
 *
 * console.log(Font.parseLineHeight("1.5")) // Option.some({ _tag: "Number", value: 1.5 })
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseLineHeight = (input: string | Values): Option.Option<LineHeight> =>
  Option.flatMap(single(input), lineHeightOf);

/** The parts before the size, each at most once and in any order; `normal` sets none. */
interface Leading {
  readonly style: Option.Option<FontStyle>;
  readonly variant: Option.Option<"small-caps">;
  readonly weight: Option.Option<FontWeight>;
  readonly width: Option.Option<string>;
  readonly normals: number;
  /** The previous part was `oblique`, so an angle may follow. */
  readonly afterOblique: boolean;
}

const NO_LEADING: Leading = {
  style: Option.none(),
  variant: Option.none(),
  weight: Option.none(),
  width: Option.none(),
  normals: 0,
  afterOblique: false,
};

/** A leading keyword part (or weight), added to `leading`, or `None` when it fits nowhere left. */
const addKeyword = (leading: Leading, value: ComponentValue): Option.Option<Leading> => {
  const name = Option.getOrElse(keyword(value), () => "");
  if (name === "normal") return Option.some({ ...leading, normals: leading.normals + 1 });
  if ((name === "italic" || name === "oblique") && Option.isNone(leading.style)) {
    return Option.some({
      ...leading,
      style: Option.some(name === "italic" ? { _tag: "Italic" } : { _tag: "Oblique", angle: 14 }),
      afterOblique: name === "oblique",
    });
  }
  if (name === "small-caps" && Option.isNone(leading.variant)) {
    return Option.some({ ...leading, variant: Option.some("small-caps") });
  }
  if (WIDTHS.includes(name) && Option.isNone(leading.width)) {
    return Option.some({ ...leading, width: Option.some(name) });
  }
  return Option.isNone(leading.weight)
    ? Option.map(weightOf(value), (weight) => ({ ...leading, weight: Option.some(weight) }))
    : Option.none();
};

/** One part before the size: an angle right after `oblique`, or a keyword part. */
const addLeading = (leading: Leading, value: ComponentValue): Option.Option<Leading> => {
  const angle = leading.afterOblique ? obliqueAngle(value) : Option.none();
  const next = { ...leading, afterOblique: false };
  return Option.match(angle, {
    onNone: () => addKeyword(next, value),
    onSome: (degrees) =>
      Option.some({ ...next, style: Option.some<FontStyle>({ _tag: "Oblique", angle: degrees }) }),
  });
};

/** The longhands the leading parts set, or `None` when `normal` is used more often than parts are left. */
const finishLeading = (leading: Leading): Option.Option<Leading> => {
  const unset = [
    Option.isNone(leading.style),
    Option.isNone(leading.variant),
    Option.isNone(leading.weight),
    Option.isNone(leading.width),
  ].filter(Boolean).length;
  return leading.normals <= unset ? Option.some(leading) : Option.none();
};

/** `size [/ line-height]` from the values after the leading parts, and what follows. */
const sizeAndLineHeight = (
  values: Values,
): Option.Option<{
  readonly size: FontSize;
  readonly lineHeight: LineHeight;
  readonly rest: Values;
}> => {
  const [sizeValue, slash, lineHeightValue, ...rest] = values;
  if (sizeValue === undefined) return Option.none();
  return Option.flatMap(sizeOf(sizeValue), (size) =>
    Predicate.isTagged(slash, "Delim") && slash.value === "/"
      ? Option.map(
          Option.flatMap(Option.fromUndefinedOr(lineHeightValue), lineHeightOf),
          (lineHeight) => ({ size, lineHeight, rest }),
        )
      : Option.some({
          size,
          lineHeight: { _tag: "Normal" } as const,
          rest: values.slice(1),
        }),
  );
};

/**
 * Parses the `font` shorthand (CSS Fonts 4 §2.8): optional style,
 * (with an optional oblique angle), `small-caps`, weight and width
 * keywords in any order (each at most once,
 * `normal` standing for any of them), then the size, an optional
 * `/ line-height` and the family list; or a system font keyword alone.
 * Omitted parts take their initial value. `None` for anything else.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Font } from "@thomasfosterau/effect-css"
 *
 * const font = Font.parse("italic bold 12px/1.5 Georgia, serif")
 * console.log(Option.map(font, (one) => one._tag === "Font" && [one.weight, one.lineHeight]))
 * // Option.some([700, { _tag: "Number", value: 1.5 }])
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (input: string | Values): Option.Option<Font> => {
  const values = valuesOf(input);
  const systemFont = Option.flatMap(single(values), keyword);
  if (Option.exists(systemFont, (name) => SYSTEM_FONTS.includes(name))) {
    return Option.map(systemFont, (name) => ({ _tag: "SystemFont", name }));
  }
  const parts = significant(values);
  // The size is the first part that is not a leading keyword or weight.
  const sizeAt = parts.findIndex(
    (value) => Option.isSome(sizeOf(value)) && Option.isNone(weightOf(value)),
  );
  if (sizeAt < 0 || sizeAt > 5) return Option.none();
  const leading = Option.flatMap(
    Arr.reduce(parts.slice(0, sizeAt), Option.some(NO_LEADING), (state, value) =>
      Option.flatMap(state, (current) => addLeading(current, value)),
    ),
    finishLeading,
  );
  return Option.flatMap(leading, (lead) =>
    Option.flatMap(sizeAndLineHeight(parts.slice(sizeAt)), ({ size, lineHeight, rest }) =>
      Option.flatMap(
        Option.filter(parseFamily(rest), Arr.isReadonlyArrayNonEmpty),
        (family): Option.Option<Font> =>
          Option.some({
            _tag: "Font",
            style: Option.getOrElse(lead.style, (): FontStyle => ({ _tag: "Normal" })),
            variant: Option.getOrElse(lead.variant, () => "normal" as const),
            weight: Option.getOrElse(lead.weight, (): FontWeight => 400),
            width: Option.getOrElse(lead.width, () => "normal"),
            size,
            lineHeight,
            family,
          }),
      ),
    ),
  );
};
