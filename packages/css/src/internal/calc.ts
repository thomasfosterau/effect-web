/**
 * `calc()` over lengths and percentages (CSS Values 4 §10): parse the
 * expression from component values, type-check it (§10.9: `+` and `-`
 * between like types, `*` with a number on one side, `/` by a non-zero
 * number) and simplify it (§10.10) into one term per unit, the absolute
 * units folded into `px`.
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Str from "effect/String";
import type { ComponentValue } from "../token.ts";

/** A simplified value: a coefficient per unit; `""` is a bare number. */
export type Terms = Readonly<Record<string, number>>;

/** A unit's canonical form and factor: an absolute unit becomes `px`. */
export type Canonical = (unit: string) => Option.Option<readonly [string, number]>;

const isNumber = (terms: Terms): boolean => {
  const units = Record.keys(terms);
  return units.length === 1 && units[0] === "";
};

const add = (left: Terms, right: Terms, sign: 1 | -1): Option.Option<Terms> => {
  if (isNumber(left) !== isNumber(right)) return Option.none();
  return Option.some(
    Record.reduce(right, { ...left }, (sum, value, unit) => ({
      ...sum,
      [unit]: (sum[unit] ?? 0) + sign * value,
    })),
  );
};

const scale = (terms: Terms, factor: number): Terms => Record.map(terms, (value) => value * factor);

const multiply = (left: Terms, right: Terms): Option.Option<Terms> => {
  if (isNumber(left)) return Option.some(scale(right, left[""] ?? 0));
  if (isNumber(right)) return Option.some(scale(left, right[""] ?? 0));
  return Option.none();
};

const divide = (left: Terms, right: Terms): Option.Option<Terms> => {
  const divisor = right[""] ?? 0;
  return isNumber(right) && divisor !== 0 ? Option.some(scale(left, 1 / divisor)) : Option.none();
};

const isDelim = (value: Option.Option<ComponentValue>, delim: string): boolean =>
  Option.exists(value, (token) => Predicate.isTagged(token, "Delim") && token.value === delim);

/** A recursive-descent parser over one parenthesised level's values, whitespace removed. */
const expression = (
  values: ReadonlyArray<ComponentValue>,
  canonical: Canonical,
): Option.Option<Terms> => {
  let at = 0;
  const peek = (offset: number): Option.Option<ComponentValue> => Arr.get(values, at + offset);

  const leaf = (token: Option.Option<ComponentValue>): Option.Option<Terms> => {
    if (Option.isNone(token)) return Option.none();
    const value = token.value;
    if (Predicate.isTagged(value, "Number")) return Option.some({ "": value.value });
    if (Predicate.isTagged(value, "Percentage")) return Option.some({ "%": value.value });
    if (Predicate.isTagged(value, "Dimension")) {
      return Option.map(canonical(Str.toLowerCase(value.unit)), ([unit, factor]) => ({
        [unit]: value.value * factor,
      }));
    }
    if (Predicate.isTagged(value, "Block") && value.associated === "(") {
      return evaluate(value.value, canonical);
    }
    if (Predicate.isTagged(value, "Func") && Str.toLowerCase(value.name) === "calc") {
      return evaluate(value.value, canonical);
    }
    return Option.none();
  };

  const product = (): Option.Option<Terms> => {
    let result = leaf(peek(0));
    at += 1;
    // oxlint-disable-next-line effect/imperative-loops -- the grammar's left-associative operator loop.
    while (Option.isSome(result) && (isDelim(peek(0), "*") || isDelim(peek(0), "/"))) {
      const operator = peek(0);
      const right = leaf(peek(1));
      at += 2;
      const left = result.value;
      result = Option.flatMap(right, (value) =>
        isDelim(operator, "*") ? multiply(left, value) : divide(left, value),
      );
    }
    return result;
  };

  let result = product();
  // oxlint-disable-next-line effect/imperative-loops -- the grammar's left-associative operator loop.
  while (Option.isSome(result) && (isDelim(peek(0), "+") || isDelim(peek(0), "-"))) {
    const sign = isDelim(peek(0), "+") ? 1 : -1;
    at += 1;
    const left = result.value;
    result = Option.flatMap(product(), (right) => add(left, right, sign));
  }
  return at === values.length ? result : Option.none();
};

/**
 * Evaluates the contents of `calc(…)` or `(…)`. `+` and `-` must be
 * surrounded by whitespace (§10.1); a sign written against a number is
 * part of the number, which leaves two operands side by side and fails.
 */
export const evaluate = (
  values: ReadonlyArray<ComponentValue>,
  canonical: Canonical,
): Option.Option<Terms> => {
  const isSpace = (index: number): boolean =>
    Option.exists(Arr.get(values, index), (value) => Predicate.isTagged(value, "Whitespace"));
  const spaced = values.every(
    (value, index) =>
      (!isDelim(Option.some(value), "+") && !isDelim(Option.some(value), "-")) ||
      (isSpace(index - 1) && isSpace(index + 1)),
  );
  if (!spaced) return Option.none();
  return Arr.match(
    values.filter((value) => !Predicate.isTagged(value, "Whitespace")),
    {
      onEmpty: () => Option.none(),
      onNonEmpty: (tokens) => expression(tokens, canonical),
    },
  );
};
