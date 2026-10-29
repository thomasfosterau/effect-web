/**
 * Helpers the typed-value modules (`Font`, `Text`) share for reading a
 * property value's component values.
 */
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { parseComponentValueList } from "../syntax.ts";
import type { ComponentValue } from "../token.ts";

/** A property value's component values. */
export type Values = ReadonlyArray<ComponentValue>;

/** `values` without whitespace tokens. */
export const significant = (values: Values): Values =>
  values.filter((value) => !Predicate.isTagged(value, "Whitespace"));

/** The component values of `input`, parsing it when it is CSS text. */
export const valuesOf = (input: string | Values): Values =>
  Predicate.isString(input) ? parseComponentValueList(input) : input;

/** The significant component values of `input`. */
export const partsOf = (input: string | Values): Values => significant(valuesOf(input));

/** An identifier's value, lowercased; `None` for anything else. */
export const keyword = (value: ComponentValue): Option.Option<string> =>
  Predicate.isTagged(value, "Ident") ? Option.some(Str.toLowerCase(value.value)) : Option.none();

/** Exactly one significant component value, else `None`. */
export const single = (input: string | Values): Option.Option<ComponentValue> => {
  const parts = partsOf(input);
  const [only] = parts;
  return parts.length === 1 && only !== undefined ? Option.some(only) : Option.none();
};
