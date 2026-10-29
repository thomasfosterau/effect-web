/**
 * CSS Text and Text Decoration values: parse `text-align`,
 * `vertical-align` and `text-decoration` (with its `-line`, `-style`,
 * `-color` and `-thickness` longhands) into typed values.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import * as Color from "./color.ts";
import * as Length from "./length.ts";
import { parseComponentValueList } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

type Values = ReadonlyArray<ComponentValue>;

const significant = (values: Values): Values =>
  values.filter((value) => !Predicate.isTagged(value, "Whitespace"));

const partsOf = (input: string | Values): Values =>
  significant(Predicate.isString(input) ? parseComponentValueList(input) : input);

const keyword = (value: ComponentValue): Option.Option<string> =>
  Predicate.isTagged(value, "Ident") ? Option.some(Str.toLowerCase(value.value)) : Option.none();

/** The one significant part's keyword, if it is one of `allowed`. */
const singleKeyword = (
  input: string | Values,
  allowed: ReadonlyArray<string>,
): Option.Option<string> => {
  const parts = partsOf(input);
  const [only] = parts;
  return parts.length === 1 && only !== undefined
    ? Option.filter(keyword(only), (name) => allowed.includes(name))
    : Option.none();
};

/**
 * The `text-align` keywords (CSS Text 3 §6.1). `match-parent` and
 * `justify-all` included.
 *
 * @since 0.1.0
 * @category models
 */
export type TextAlign =
  | "start"
  | "end"
  | "left"
  | "right"
  | "center"
  | "justify"
  | "match-parent"
  | "justify-all";

const TEXT_ALIGN: ReadonlyArray<TextAlign> = [
  "start",
  "end",
  "left",
  "right",
  "center",
  "justify",
  "match-parent",
  "justify-all",
];

const isTextAlign = (name: string): name is TextAlign => Arr.contains(TEXT_ALIGN, name);

/**
 * Parses `text-align`: one keyword, case-insensitive.
 *
 * @example
 * ```ts
 * import { Text } from "@thomasfosterau/effect-css"
 *
 * console.log(Text.parseAlign("Center")) // Option.some("center")
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseAlign = (input: string | Values): Option.Option<TextAlign> =>
  Option.filter(singleKeyword(input, TEXT_ALIGN), isTextAlign);

/**
 * A `vertical-align` (CSS 2.1 §10.8.1): a keyword or a length or
 * percentage (which may be negative) to shift the baseline by.
 *
 * @since 0.1.0
 * @category models
 */
export type VerticalAlign =
  | { readonly _tag: "Keyword"; readonly keyword: string }
  | { readonly _tag: "Length"; readonly length: Length.Length };

const VERTICAL_ALIGN: ReadonlyArray<string> = [
  "baseline",
  "sub",
  "super",
  "text-top",
  "text-bottom",
  "middle",
  "top",
  "bottom",
];

/**
 * Parses `vertical-align`: `baseline`, `sub`, `super`, `text-top`,
 * `text-bottom`, `middle`, `top`, `bottom`, or a length or percentage.
 *
 * @example
 * ```ts
 * import { Text } from "@thomasfosterau/effect-css"
 *
 * console.log(Text.parseVerticalAlign("-2px")) // Option.some({ _tag: "Length", length: { value: -2, unit: "px" } })
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseVerticalAlign = (input: string | Values): Option.Option<VerticalAlign> => {
  const parts = partsOf(input);
  const [only] = parts;
  if (parts.length !== 1 || only === undefined) return Option.none();
  return Option.orElse(
    Option.map(
      Option.filter(keyword(only), (name) => VERTICAL_ALIGN.includes(name)),
      (name): VerticalAlign => ({ _tag: "Keyword", keyword: name }),
    ),
    () => Option.map(Length.parse(only), (length): VerticalAlign => ({ _tag: "Length", length })),
  );
};

/**
 * A `text-decoration-line` (CSS Text Decoration 3 §2.1): `none`, or a
 * set of `underline`, `overline`, `line-through` and `blink`, each at
 * most once, in the order written.
 *
 * @since 0.1.0
 * @category models
 */
export type DecorationLine = ReadonlyArray<"underline" | "overline" | "line-through" | "blink">;

type LineKeyword = DecorationLine[number];

const LINE_KEYWORDS: ReadonlyArray<LineKeyword> = [
  "underline",
  "overline",
  "line-through",
  "blink",
];

const isLineKeyword = (name: string): name is LineKeyword => Arr.contains(LINE_KEYWORDS, name);

/**
 * A `text-decoration-style`.
 *
 * @since 0.1.0
 * @category models
 */
export type DecorationStyle = "solid" | "double" | "dotted" | "dashed" | "wavy";

const DECORATION_STYLES: ReadonlyArray<DecorationStyle> = [
  "solid",
  "double",
  "dotted",
  "dashed",
  "wavy",
];

const isDecorationStyle = (name: string): name is DecorationStyle =>
  Arr.contains(DECORATION_STYLES, name);

/**
 * A `text-decoration-thickness` (CSS Text Decoration 4 §2.4): `auto`,
 * `from-font`, or a length or percentage.
 *
 * @since 0.1.0
 * @category models
 */
export type DecorationThickness =
  | { readonly _tag: "Auto" }
  | { readonly _tag: "FromFont" }
  | { readonly _tag: "Length"; readonly length: Length.Length };

/** The `none` line: an empty set. */
const NO_LINE: DecorationLine = [];

/** Adds a line keyword to `lines`, or `None` for a repeat. */
const addLine = (lines: DecorationLine, line: LineKeyword): Option.Option<DecorationLine> =>
  Arr.contains(lines, line) ? Option.none() : Option.some([...lines, line]);

/**
 * Parses `text-decoration-line`: `none` (an empty set), or one or more of
 * `underline`, `overline`, `line-through` and `blink`, none repeated.
 *
 * @example
 * ```ts
 * import { Text } from "@thomasfosterau/effect-css"
 *
 * console.log(Text.parseDecorationLine("underline overline")) // Option.some(["underline", "overline"])
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseDecorationLine = (input: string | Values): Option.Option<DecorationLine> => {
  const names = Option.all(partsOf(input).map(keyword));
  return Option.flatMap(Option.filter(names, Arr.isReadonlyArrayNonEmpty), (all) => {
    const [head] = all;
    if (all.length === 1 && head === "none") return Option.some(NO_LINE);
    return Arr.reduce(all, Option.some(NO_LINE), (lines, name) =>
      Option.flatMap(lines, (current) =>
        isLineKeyword(name) ? addLine(current, name) : Option.none(),
      ),
    );
  });
};

/**
 * Parses `text-decoration-style`: `solid`, `double`, `dotted`, `dashed`
 * or `wavy`.
 *
 * @example
 * ```ts
 * import { Text } from "@thomasfosterau/effect-css"
 *
 * console.log(Text.parseDecorationStyle("wavy")) // Option.some("wavy")
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseDecorationStyle = (input: string | Values): Option.Option<DecorationStyle> =>
  Option.filter(singleKeyword(input, DECORATION_STYLES), isDecorationStyle);

const thicknessOf = (value: ComponentValue): Option.Option<DecorationThickness> => {
  const name = Option.getOrElse(keyword(value), () => "");
  if (name === "auto") return Option.some({ _tag: "Auto" });
  if (name === "from-font") return Option.some({ _tag: "FromFont" });
  return Option.map(Length.parse(value), (length): DecorationThickness => ({
    _tag: "Length",
    length,
  }));
};

/**
 * Parses `text-decoration-thickness`: `auto`, `from-font`, or a length or
 * percentage.
 *
 * @example
 * ```ts
 * import { Text } from "@thomasfosterau/effect-css"
 *
 * console.log(Text.parseDecorationThickness("from-font")) // Option.some({ _tag: "FromFont" })
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseDecorationThickness = (
  input: string | Values,
): Option.Option<DecorationThickness> => {
  const parts = partsOf(input);
  const [only] = parts;
  return parts.length === 1 && only !== undefined ? thicknessOf(only) : Option.none();
};

/**
 * The `text-decoration` shorthand: every longhand it sets. One the
 * shorthand leaves out holds its initial value: no line, `solid`,
 * `currentcolor` (`None`) and `auto`.
 *
 * @since 0.1.0
 * @category models
 */
export interface TextDecoration {
  readonly line: DecorationLine;
  readonly style: DecorationStyle;
  /** `None` for `currentcolor`, the initial value. */
  readonly color: Option.Option<Color.Color>;
  readonly thickness: DecorationThickness;
}

/** The longhands seen so far; `none` counts as setting the line. */
interface Parts {
  readonly line: Option.Option<DecorationLine>;
  readonly style: Option.Option<DecorationStyle>;
  readonly color: Option.Option<Option.Option<Color.Color>>;
  readonly thickness: Option.Option<DecorationThickness>;
}

const NO_PARTS: Parts = {
  line: Option.none(),
  style: Option.none(),
  color: Option.none(),
  thickness: Option.none(),
};

/** A line keyword (or `none`), added to the line set. */
const addLinePart = (parts: Parts, name: string): Option.Option<Parts> => {
  if (name === "none") {
    return Option.isNone(parts.line)
      ? Option.some({ ...parts, line: Option.some(NO_LINE) })
      : Option.none();
  }
  if (!isLineKeyword(name)) return Option.none();
  const lines = Option.getOrElse(parts.line, () => NO_LINE);
  // `none` cannot combine with a line keyword.
  if (Option.isSome(parts.line) && Arr.isReadonlyArrayEmpty(lines)) return Option.none();
  return Option.map(addLine(lines, name), (line) => ({ ...parts, line: Option.some(line) }));
};

/** A colour part (`currentcolor` included), or `None` once a colour is set. */
const addColorPart = (parts: Parts, value: ComponentValue): Option.Option<Parts> => {
  if (Option.isSome(parts.color)) return Option.none();
  if (Option.exists(keyword(value), (name) => name === "currentcolor")) {
    return Option.some({ ...parts, color: Option.some(Option.none()) });
  }
  return Option.map(Color.parse(value), (color) => ({
    ...parts,
    color: Option.some(Option.some(color)),
  }));
};

/** One part of the shorthand, added to `parts`. */
const addPart = (parts: Parts, value: ComponentValue): Option.Option<Parts> => {
  const name = Option.getOrElse(keyword(value), () => "");
  if (name === "none" || isLineKeyword(name)) return addLinePart(parts, name);
  if (isDecorationStyle(name)) {
    return Option.isNone(parts.style)
      ? Option.some({ ...parts, style: Option.some(name) })
      : Option.none();
  }
  const thickness = Option.isNone(parts.thickness) ? thicknessOf(value) : Option.none();
  return Option.match(thickness, {
    onNone: () => addColorPart(parts, value),
    onSome: (one) => Option.some({ ...parts, thickness: Option.some(one) }),
  });
};

/**
 * Parses the `text-decoration` shorthand: a line (`none`, or line
 * keywords, none repeated), a style, a colour and a thickness, each at
 * most once and in any order (line keywords need not be adjacent, as in
 * browsers). Omitted longhands take their initial value.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Text } from "@thomasfosterau/effect-css"
 *
 * const decoration = Text.parseDecoration("underline wavy red 2px")
 * console.log(Option.map(decoration, (one) => [one.line, one.style, one.thickness]))
 * // Option.some([["underline"], "wavy", { _tag: "Length", length: { value: 2, unit: "px" } }])
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseDecoration = (input: string | Values): Option.Option<TextDecoration> =>
  Option.map(
    Option.flatMap(
      Option.filter(Option.some(partsOf(input)), Arr.isReadonlyArrayNonEmpty),
      (values) =>
        Arr.reduce(values, Option.some(NO_PARTS), (parts, value) =>
          Option.flatMap(parts, (current) => addPart(current, value)),
        ),
    ),
    (parts) => ({
      line: Option.getOrElse(parts.line, () => NO_LINE),
      style: Option.getOrElse(parts.style, (): DecorationStyle => "solid"),
      color: Option.flatten(parts.color),
      thickness: Option.getOrElse(parts.thickness, (): DecorationThickness => ({ _tag: "Auto" })),
    }),
  );
