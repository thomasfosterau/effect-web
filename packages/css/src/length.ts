/**
 * CSS Values 4 lengths: parse a `<length>` or `<length-percentage>`
 * (`12px`, `1.5em`, `50%`, a unitless `0`, a `calc()` of them) into a value
 * and a unit, or a simplified sum of them, and convert between the
 * absolute units.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Str from "effect/String";
import { evaluate } from "./internal/calc.ts";
import { parseComponentValue } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

/**
 * The absolute length units (CSS Values 4 §6.2) and how many CSS pixels
 * one of each is (1in = 96px = 2.54cm = 72pt = 6pc; 1Q = 1/40 cm).
 *
 * @since 0.1.0
 * @category constants
 */
export const ABSOLUTE_UNITS = {
  px: 1,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  in: 96,
  pt: 96 / 72,
  pc: 16,
} as const;

/**
 * An absolute length unit.
 *
 * @since 0.1.0
 * @category models
 */
export type AbsoluteUnit = keyof typeof ABSOLUTE_UNITS;

/**
 * The relative length units (CSS Values 4 §6.1), resolved only against
 * a font or a viewport.
 *
 * @since 0.1.0
 * @category constants
 */
export const RELATIVE_UNITS = [
  "em",
  "rem",
  "ex",
  "rex",
  "cap",
  "rcap",
  "ch",
  "rch",
  "ic",
  "ric",
  "lh",
  "rlh",
  "vw",
  "vh",
  "vi",
  "vb",
  "vmin",
  "vmax",
  "svw",
  "svh",
  "lvw",
  "lvh",
  "dvw",
  "dvh",
] as const;

/**
 * A relative length unit.
 *
 * @since 0.1.0
 * @category models
 */
export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

/**
 * A length (or, unit `%`, a percentage): its value and its unit, lower-case.
 *
 * @since 0.1.0
 * @category models
 */
export interface Length {
  readonly value: number;
  readonly unit: AbsoluteUnit | RelativeUnit | "%";
}

const isUnit = (unit: string): unit is AbsoluteUnit | RelativeUnit =>
  Record.has<string, number>(ABSOLUTE_UNITS, unit) ||
  RELATIVE_UNITS.some((relative) => relative === unit);

/** A length unit's canonical unit and factor in `calc()`: an absolute unit becomes `px`. */
const canonical = (unit: string): Option.Option<readonly [string, number]> =>
  Option.orElse(
    Option.map(
      Record.get<string, number>(ABSOLUTE_UNITS, unit),
      (pixels) => ["px", pixels] as const,
    ),
    () => (isUnit(unit) ? Option.some([unit, 1] as const) : Option.none()),
  );

/** `%` first, then the units in ASCII order (CSS Values 4 §10.10's sort). */
const byUnit = (left: Length, right: Length): number =>
  left.unit === right.unit
    ? 0
    : left.unit === "%"
      ? -1
      : right.unit === "%"
        ? 1
        : left.unit < right.unit
          ? -1
          : 1;

/**
 * A `<length-percentage>` that `calc()` could not reduce to one unit: its
 * terms, one per unit (`calc(100% - 2em + 4px)` is `50%`… three terms),
 * the absolute units folded into `px`, `%` first then the units in ASCII
 * order. A plain length is a one-term sum.
 *
 * @since 0.1.0
 * @category models
 */
export type Sum = ReadonlyArray<Length>;

/**
 * Parses a `<length-percentage>`, `calc()` included (CSS Values 4 §10),
 * into its simplified {@link Sum}: `+` and `-` (with whitespace around
 * them) between lengths and percentages, `*` by a number on either side,
 * `/` by a non-zero number, nested parentheses and `calc()`. Like terms
 * combine and the absolute units fold into `px`, so `calc(1in + 10px)` is
 * `[106px]` and `calc(50% - 1em)` keeps both terms. `None` for anything
 * else, a sum that mixes a bare number with a length included.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Length } from "@thomasfosterau/effect-css"
 *
 * console.log(Option.map(Length.parseSum("calc(100% - (2em + 4pt) * 2)"), Length.serializeSum))
 * // Option.some("calc(100% - 4em - 10.666667px)")
 * console.log(Length.parseSum("calc(1in + 10px)")) // Option.some([{ value: 106, unit: "px" }])
 * console.log(Option.isNone(Length.parseSum("calc(1px + 2)"))) // true
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseSum = (input: string | ComponentValue): Option.Option<Sum> => {
  const value = Predicate.isString(input) ? parseComponentValue(input) : input;
  if (!Predicate.isTagged(value, "Func") || Str.toLowerCase(value.name) !== "calc") {
    return Option.map(parsePlain(value), (length) => [length]);
  }
  return Option.flatMap(evaluate(value.value, canonical), (terms) =>
    Record.has(terms, "")
      ? Option.none()
      : Option.some(
          Record.toEntries(terms)
            .flatMap(([unit, coefficient]): ReadonlyArray<Length> =>
              unit === "%" || isUnit(unit) ? [{ value: coefficient, unit }] : [],
            )
            .toSorted(byUnit),
        ),
  );
};

const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
};

/**
 * Serialises a {@link Sum}: one term as itself (`12pt`), more as
 * `calc(a + b - c)`, numbers with at most six decimals.
 *
 * @example
 * ```ts
 * import { Length } from "@thomasfosterau/effect-css"
 *
 * console.log(Length.serializeSum([{ value: 50, unit: "%" }, { value: -1, unit: "em" }])) // "calc(50% - 1em)"
 * ```
 *
 * @since 0.1.0
 * @category serialising
 */
export const serializeSum = (sum: Sum): string => {
  const [first, ...rest] = sum;
  if (first === undefined) return "0px";
  const head = `${formatNumber(first.value)}${first.unit}`;
  if (!Arr.isReadonlyArrayNonEmpty(rest)) return head;
  return `calc(${rest.reduce(
    (text, term) =>
      `${text} ${term.value < 0 ? "-" : "+"} ${formatNumber(Math.abs(term.value))}${term.unit}`,
    head,
  )})`;
};

/**
 * Parses a `<length-percentage>` from CSS text or a component value: a
 * dimension in a length unit (case-insensitive), a percentage, a unitless
 * zero (as `0px`), or a `calc()` that simplifies to a single unit (see
 * {@link parseSum}; `calc(1in + 10px)` is `106px`). `None` otherwise.
 *
 * @example
 * ```ts
 * import { Length } from "@thomasfosterau/effect-css"
 *
 * console.log(Length.parse("12PT")) // Option.some({ value: 12, unit: "pt" })
 * console.log(Length.parse("50%")) // Option.some({ value: 50, unit: "%" })
 * console.log(Length.parse("0")) // Option.some({ value: 0, unit: "px" })
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (input: string | ComponentValue): Option.Option<Length> =>
  Option.flatMap(parseSum(input), (sum) =>
    sum.length === 1 && sum[0] !== undefined ? Option.some(sum[0]) : Option.none(),
  );

/** A plain `<length-percentage>`: a length dimension, a percentage or a unitless zero. */
const parsePlain = (value: ReturnType<typeof parseComponentValue>): Option.Option<Length> => {
  if (Predicate.isTagged(value, "Dimension")) {
    const unit = Str.toLowerCase(value.unit);
    return isUnit(unit) ? Option.some({ value: value.value, unit }) : Option.none();
  }
  if (Predicate.isTagged(value, "Percentage"))
    return Option.some({ value: value.value, unit: "%" });
  if (Predicate.isTagged(value, "Number") && value.value === 0)
    return Option.some({ value: 0, unit: "px" });
  return Option.none();
};

/**
 * A length in CSS pixels, for an absolute unit; `None` for a relative
 * unit or a percentage, which need a context to resolve.
 *
 * @example
 * ```ts
 * import { Length } from "@thomasfosterau/effect-css"
 *
 * console.log(Length.toPixels({ value: 1, unit: "in" })) // Option.some(96)
 * console.log(Length.toPixels({ value: 2, unit: "em" })) // Option.none()
 * ```
 *
 * @since 0.1.0
 * @category converting
 */
export const toPixels = (length: Length): Option.Option<number> =>
  Option.map(
    Record.get<string, number>(ABSOLUTE_UNITS, length.unit),
    (pixels) => length.value * pixels,
  );

/**
 * Converts a length to another absolute unit; `None` when the length is
 * relative or a percentage.
 *
 * @example
 * ```ts
 * import { Length } from "@thomasfosterau/effect-css"
 *
 * console.log(Length.convert({ value: 72, unit: "pt" }, "in")) // Option.some({ value: 1, unit: "in" })
 * ```
 *
 * @since 0.1.0
 * @category converting
 */
export const convert = (length: Length, unit: AbsoluteUnit): Option.Option<Length> =>
  Option.map(toPixels(length), (pixels) => ({ value: pixels / ABSOLUTE_UNITS[unit], unit }));

/**
 * Serialises a length: the value then the unit (`12pt`, `50%`).
 *
 * @example
 * ```ts
 * import { Length } from "@thomasfosterau/effect-css"
 *
 * console.log(Length.serialize({ value: 1.5, unit: "em" })) // "1.5em"
 * ```
 *
 * @since 0.1.0
 * @category serialising
 */
export const serialize = (length: Length): string => `${length.value}${length.unit}`;
