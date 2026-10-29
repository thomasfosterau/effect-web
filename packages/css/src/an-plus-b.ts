/**
 * The `An+B` microsyntax (CSS Syntax 3 §6): the argument of `:nth-child()`
 * and its relatives, `odd`, `even`, `3`, `-n+2`, `2n + 1`, parsed into
 * its `[A, B]` pair as the specification's grammar reads it from tokens,
 * escapes and comments included.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { parseComponentValueList } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

/**
 * An `An+B` value: the step `a` and the offset `b`; it selects the indices
 * `a·n + b` for every integer `n ≥ 0`.
 *
 * @since 0.1.0
 * @category models
 */
export type AnPlusB = readonly [a: number, b: number];

/** After the `An` part: nothing more, a `-` already read (`n-`), or an optional `±B`. */
type Tail = "-" | "±";

const isWhitespace = (value: ComponentValue): boolean => Predicate.isTagged(value, "Whitespace");

const integer = (
  value: Option.Option<ComponentValue>,
): Option.Option<{ value: number; signed: boolean }> =>
  Option.flatMap(value, (token) =>
    Predicate.isTagged(token, "Number") && token.isInteger
      ? Option.some({
          value: token.value,
          signed: token.representation.startsWith("+") || token.representation.startsWith("-"),
        })
      : Option.none(),
  );

/** An `n` unit or ident (`n`, `n-`, `n-3`) after the coefficient `a`. */
const nPart = (
  a: number,
  name: string,
): Option.Option<{
  readonly a: number;
  readonly b: Option.Option<number>;
  readonly tail: Tail;
}> => {
  const lower = Str.toLowerCase(name);
  if (lower === "n") return Option.some({ a, b: Option.none(), tail: "±" });
  if (lower === "n-") return Option.some({ a, b: Option.none(), tail: "-" });
  const digits = /^n-([0-9]+)$/.exec(lower);
  return digits === null
    ? Option.none()
    : Option.some({ a, b: Option.some(-Number(digits[1])), tail: "±" });
};

/** The `An` part from the first one or two tokens, and how many it took. */
const head = (
  values: ReadonlyArray<ComponentValue>,
): Option.Option<{
  readonly a: number;
  readonly b: Option.Option<number>;
  readonly tail: Tail;
  readonly used: number;
}> => {
  const [first, second] = values;
  if (Predicate.isTagged(first, "Dimension") && first.isInteger) {
    return Option.map(nPart(first.value, first.unit), (part) => ({ ...part, used: 1 }));
  }
  if (Predicate.isTagged(first, "Ident")) {
    const name = Str.toLowerCase(first.value);
    return name.startsWith("-")
      ? Option.map(nPart(-1, name.slice(1)), (part) => ({ ...part, used: 1 }))
      : Option.map(nPart(1, name), (part) => ({ ...part, used: 1 }));
  }
  // `+n…`: a `+` delim directly followed (no whitespace) by an ident not starting with `-`.
  if (
    Predicate.isTagged(first, "Delim") &&
    first.value === "+" &&
    Predicate.isTagged(second, "Ident") &&
    !second.value.startsWith("-")
  ) {
    return Option.map(nPart(1, second.value), (part) => ({ ...part, used: 2 }));
  }
  return Option.none();
};

/** The optional `±B` after a complete `An`, whitespace already removed. */
const offsetAfter = (rest: ReadonlyArray<ComponentValue>, tail: Tail): Option.Option<number> => {
  const [first, second, ...more] = rest;
  if (first === undefined) return tail === "±" ? Option.some(0) : Option.none();
  if (tail === "-") {
    return second === undefined
      ? Option.flatMap(integer(Option.some(first)), (int) =>
          int.signed ? Option.none() : Option.some(-int.value),
        )
      : Option.none();
  }
  if (second === undefined) {
    return Option.flatMap(integer(Option.some(first)), (int) =>
      int.signed ? Option.some(int.value) : Option.none(),
    );
  }
  if (!Arr.isReadonlyArrayEmpty(more) || !Predicate.isTagged(first, "Delim")) return Option.none();
  const sign = first.value === "+" ? 1 : first.value === "-" ? -1 : 0;
  return sign === 0
    ? Option.none()
    : Option.flatMap(integer(Option.some(second)), (int) =>
        int.signed ? Option.none() : Option.some(sign * int.value),
      );
};

/**
 * Parses `An+B` (§6.1) from CSS text or component values: `odd`, `even`,
 * an integer, or `An` with an optional `+ B` / `- B`, case-insensitive,
 * with whitespace allowed around the sign but not inside `+n` or a number.
 * `None` for anything else.
 *
 * @example
 * ```ts
 * import { AnPlusB } from "@thomasfosterau/effect-css"
 *
 * console.log(AnPlusB.parse("2n + 1")) // Option.some([2, 1])
 * console.log(AnPlusB.parse("even")) // Option.some([2, 0])
 * console.log(AnPlusB.parse("-n+3")) // Option.some([-1, 3])
 * console.log(AnPlusB.parse("+ n")) // Option.none()
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (input: string | ReadonlyArray<ComponentValue>): Option.Option<AnPlusB> => {
  const values = Predicate.isString(input) ? parseComponentValueList(input) : input;
  const start = values.findIndex((value) => !isWhitespace(value));
  const end = values.findLastIndex((value) => !isWhitespace(value));
  const trimmed = start < 0 ? [] : values.slice(start, end + 1);
  const [only] = trimmed;
  if (trimmed.length === 1 && Predicate.isTagged(only, "Ident")) {
    const keyword = Str.toLowerCase(only.value);
    if (keyword === "odd") return Option.some([2, 1]);
    if (keyword === "even") return Option.some([2, 0]);
  }
  if (trimmed.length === 1) {
    const b = Option.flatMap(integer(Option.fromUndefinedOr(only)), (int) =>
      Option.some(int.value),
    );
    if (Option.isSome(b)) return Option.some([0, b.value]);
  }
  return Option.flatMap(head(trimmed), ({ a, b, tail, used }) => {
    const rest = trimmed.slice(used).filter((value) => !isWhitespace(value));
    return Option.match(b, {
      onSome: (value) =>
        Arr.isReadonlyArrayEmpty(rest) ? Option.some([a, value] as const) : Option.none(),
      onNone: () => Option.map(offsetAfter(rest, tail), (value) => [a, value] as const),
    });
  });
};
