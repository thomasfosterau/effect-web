/**
 * CSS Values 4 lengths: parse a `<length>` or `<length-percentage>`
 * (`12px`, `1.5em`, `50%`, a unitless `0`) into a value and a unit, and
 * convert between the absolute units.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Str from "effect/String";
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

/**
 * Parses a `<length-percentage>` from CSS text or a component value: a
 * dimension in a length unit (case-insensitive), a percentage, or a
 * unitless zero (as `0px`). `None` otherwise.
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
export const parse = (input: string | ComponentValue): Option.Option<Length> => {
  const value = Predicate.isString(input) ? parseComponentValue(input) : input;
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
