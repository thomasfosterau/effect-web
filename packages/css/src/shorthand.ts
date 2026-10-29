/**
 * Box shorthands (CSS Box 4, CSS Backgrounds 3): expand `margin`,
 * `padding`, `inset`, `border`, `border-top` (and the other sides),
 * `border-width`, `border-style` and `border-color` into their longhand
 * declarations, so a consumer reading a `style` attribute sees one value
 * per property.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import * as Color from "./color.ts";
import * as Length from "./length.ts";
import type { Declaration } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

const SIDES = ["top", "right", "bottom", "left"] as const;

/** A side of the box. */
type Side = (typeof SIDES)[number];

/** The `border-style` keywords (CSS Backgrounds 3 §3.2). */
const BORDER_STYLES: ReadonlyArray<string> = [
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
];

/** The `<line-width>` keywords (CSS Backgrounds 3 §3.3). */
const LINE_WIDTHS: ReadonlyArray<string> = ["thin", "medium", "thick"];

/** The CSS-wide keywords, which a shorthand passes to every longhand as they are. */
const WIDE_KEYWORDS: ReadonlyArray<string> = [
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
];

const ident = (value: ComponentValue): Option.Option<string> =>
  Predicate.isTagged(value, "Ident") ? Option.some(Str.toLowerCase(value.value)) : Option.none();

const isKeyword =
  (keywords: ReadonlyArray<string>) =>
  (value: ComponentValue): boolean =>
    Option.exists(ident(value), (name) => keywords.includes(name));

/** A `<length-percentage>`, `auto` (or, for `margin`, nothing else). */
const isLengthPercentageOrAuto = (value: ComponentValue): boolean =>
  Option.isSome(Length.parse(value)) || isKeyword(["auto"])(value);

/** A `<length-percentage>` (no `auto`: `padding`). */
const isLengthPercentage = (value: ComponentValue): boolean => Option.isSome(Length.parse(value));

/** A `<line-width>`: a non-percentage length or `thin` / `medium` / `thick`. */
const isLineWidth = (value: ComponentValue): boolean =>
  isKeyword(LINE_WIDTHS)(value) ||
  Option.exists(Length.parse(value), (length) => length.unit !== "%");

const isLineStyle = isKeyword(BORDER_STYLES);

const isColor = (value: ComponentValue): boolean => Option.isSome(Color.parse(value));

/** The significant (non-whitespace) component values of a declaration's value. */
const significant = (declaration: Declaration): ReadonlyArray<ComponentValue> =>
  declaration.value.filter((value) => !Predicate.isTagged(value, "Whitespace"));

/** A declaration for `name` with `value`, keeping the shorthand's `!important`. */
const longhand = (
  from: Declaration,
  name: string,
  value: ReadonlyArray<ComponentValue>,
): Declaration => ({ _tag: "Declaration", name, value, important: from.important });

/**
 * The CSS Box "1 to 4 values" rule: top, then right, bottom and left each
 * defaulting to the value opposite or above it.
 */
const fourSides = <A>(values: ReadonlyArray<A>): Option.Option<readonly [A, A, A, A]> => {
  const [top, right = top, bottom = top, left = right, ...extra] = values;
  return top === undefined || right === undefined || Arr.isReadonlyArrayNonEmpty(extra)
    ? Option.none()
    : Option.some([top, right, bottom ?? top, left ?? right]);
};

/** A box shorthand whose 1 to 4 values each pass `valid`: `margin`, `padding`, `inset`, `border-*`. */
const boxShorthand =
  (longhandName: (side: Side) => string, valid: (value: ComponentValue) => boolean) =>
  (declaration: Declaration): Option.Option<ReadonlyArray<Declaration>> => {
    const values = significant(declaration);
    if (!values.every(valid)) return Option.none();
    return Option.map(fourSides(values), (sides) =>
      SIDES.map((side, at) => longhand(declaration, longhandName(side), [sides[at] ?? sides[0]])),
    );
  };

/** What one `border` side is made of; absent parts take their initial value. */
interface BorderParts {
  readonly width: ComponentValue;
  readonly style: ComponentValue;
  readonly color: ComponentValue;
}

const INITIAL: BorderParts = {
  width: { _tag: "Ident", value: "medium" },
  style: { _tag: "Ident", value: "none" },
  color: { _tag: "Ident", value: "currentcolor" },
};

/**
 * `<line-width> || <line-style> || <color>`: each at most once, in any
 * order, at least one.
 */
const borderParts = (values: ReadonlyArray<ComponentValue>): Option.Option<BorderParts> => {
  if (Arr.isReadonlyArrayEmpty(values) || values.length > 3) return Option.none();
  return Arr.reduce(
    values,
    Option.some<{ readonly parts: BorderParts; readonly seen: ReadonlyArray<string> }>({
      parts: INITIAL,
      seen: [],
    }),
    (state, value) =>
      Option.flatMap(state, ({ parts, seen }) => {
        const part = isLineWidth(value)
          ? "width"
          : isLineStyle(value)
            ? "style"
            : isColor(value)
              ? "color"
              : undefined;
        return part === undefined || seen.includes(part)
          ? Option.none()
          : Option.some({ parts: { ...parts, [part]: value }, seen: [...seen, part] });
      }),
  ).pipe(Option.map(({ parts }) => parts));
};

/** `border-<side>` for one side, or `border` for all four. */
const borderShorthand =
  (sides: ReadonlyArray<Side>) =>
  (declaration: Declaration): Option.Option<ReadonlyArray<Declaration>> =>
    Option.map(borderParts(significant(declaration)), (parts) =>
      sides.flatMap((side) => [
        longhand(declaration, `border-${side}-width`, [parts.width]),
        longhand(declaration, `border-${side}-style`, [parts.style]),
        longhand(declaration, `border-${side}-color`, [parts.color]),
      ]),
    );

type Expander = (declaration: Declaration) => Option.Option<ReadonlyArray<Declaration>>;

/** A shorthand: its name, its longhands in order, and how it expands a value. */
interface Entry {
  readonly name: string;
  readonly longhands: ReadonlyArray<string>;
  readonly expand: Expander;
}

const sided = (name: (side: Side) => string): ReadonlyArray<string> => SIDES.map(name);

const borderLonghands = (sides: ReadonlyArray<Side>): ReadonlyArray<string> =>
  sides.flatMap((side) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]);

const box = (
  name: string,
  longhandName: (side: Side) => string,
  valid: (value: ComponentValue) => boolean,
): Entry => ({ name, longhands: sided(longhandName), expand: boxShorthand(longhandName, valid) });

/** The shorthands {@link expand} understands. */
const SHORTHANDS: ReadonlyArray<Entry> = [
  box("margin", (side) => `margin-${side}`, isLengthPercentageOrAuto),
  box("padding", (side) => `padding-${side}`, isLengthPercentage),
  box("inset", (side) => side, isLengthPercentageOrAuto),
  box("border-width", (side) => `border-${side}-width`, isLineWidth),
  box("border-style", (side) => `border-${side}-style`, isLineStyle),
  box("border-color", (side) => `border-${side}-color`, isColor),
  { name: "border", longhands: borderLonghands(SIDES), expand: borderShorthand(SIDES) },
  ...SIDES.map((side): Entry => ({
    name: `border-${side}`,
    longhands: borderLonghands([side]),
    expand: borderShorthand([side]),
  })),
];

/**
 * Whether a property name is one of the shorthands {@link expand}
 * understands (ASCII case-insensitively).
 *
 * @example
 * ```ts
 * import { Shorthand } from "@thomasfosterau/effect-css"
 *
 * console.log(Shorthand.isShorthand("MARGIN")) // true
 * console.log(Shorthand.isShorthand("margin-top")) // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isShorthand = (name: string): boolean =>
  SHORTHANDS.some((entry) => entry.name === Str.toLowerCase(name));

/**
 * Expands a box shorthand declaration into its longhands, keeping
 * `!important`: `margin`, `padding` and `inset` by the 1 to 4 values rule
 * (top, right, bottom, left), `border-width`, `border-style` and
 * `border-color` likewise, and `border` / `border-top` (and the other
 * sides) into each side's `-width`, `-style` and `-color`, an omitted
 * part taking its initial value (`medium`, `none`, `currentcolor`). A
 * CSS-wide keyword (`inherit`, `initial`, …) goes to every longhand.
 *
 * `None` when the declaration is not one of these shorthands, its value is
 * invalid for it, or it holds a `var()` (its longhands are only known once
 * the variable is substituted).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Shorthand, Syntax } from "@thomasfosterau/effect-css"
 *
 * const [margin] = Syntax.parseDeclarationList("margin: 1px 2px")
 * if (margin?._tag === "Declaration") {
 *   const longhands = Option.getOrElse(Shorthand.expand(margin), () => [])
 *   console.log(longhands.map((one) => one.name)) // ["margin-top", "margin-right", "margin-bottom", "margin-left"]
 * }
 * ```
 *
 * @since 0.1.0
 * @category expanding
 */
export const expand = (declaration: Declaration): Option.Option<ReadonlyArray<Declaration>> => {
  const name = Str.toLowerCase(declaration.name);
  const values = significant(declaration);
  if (
    values.some(
      (value) => Predicate.isTagged(value, "Func") && Str.toLowerCase(value.name) === "var",
    )
  ) {
    return Option.none();
  }
  return Option.flatMap(
    Arr.findFirst(SHORTHANDS, (entry) => entry.name === name),
    (entry) => {
      const [only] = values;
      if (values.length === 1 && only !== undefined && isKeyword(WIDE_KEYWORDS)(only)) {
        return Option.some(
          entry.longhands.map((longhandName) => longhand(declaration, longhandName, [only])),
        );
      }
      return entry.expand({ ...declaration, name });
    },
  );
};
