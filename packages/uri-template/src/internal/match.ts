/**
 * The RFC 6570 inverse over an unambiguous subset of templates: compile a
 * template's parts into one anchored regular expression plus, for trailing
 * query expressions, a by-name reading of the query string.
 *
 * Every refusal is decided here, at compile time, with the position of the
 * expression it concerns; matching itself never fails, it only misses.
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import type { Operator, Part, VariableSpec } from "../uri-template.ts";
import { encodeReserved } from "./encoding.ts";

/** What a match recovers: each defined variable, a string, a list or a record of strings. */
export type MatchedValues = {
  readonly [name: string]: string | ReadonlyArray<string> | { readonly [key: string]: string };
};

/** Why a template cannot be matched, and where. */
export interface Refusal {
  readonly position: number;
  readonly detail: string;
}

/** A compiled template. */
export interface Compiled {
  readonly match: (url: string) => Option.Option<MatchedValues>;
}

type Expression = Extract<Part, { readonly _tag: "Expression" }>;
type Value = MatchedValues[string];

/**
 * One variable read from the URL: `None` when the URL is malformed (a bad
 * pct-encoding), `Some(None)` when the variable is absent.
 */
type Read = Option.Option<Option.Option<Value>>;

/** How one variable is read from its capture groups. */
interface Reader {
  readonly name: string;
  readonly groups: number;
  readonly read: (groups: ReadonlyArray<string | undefined>) => Read;
}

interface Step {
  readonly source: string;
  readonly readers: ReadonlyArray<Reader>;
}

// A `U` value: unreserved characters, pct-encoded octets, and `,` (a raw
// comma is never part of a `U` value, so it separates a list). Under the `.`
// operator a raw `.` is the separator, so it cannot be part of a value.
const U = "(?:[A-Za-z0-9\\-._~,]|%[0-9A-Fa-f]{2})";
const U_NO_DOT = "(?:[A-Za-z0-9\\-_~,]|%[0-9A-Fa-f]{2})";
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu;

const escape = (text: string): string => text.replace(REGEX_SPECIAL, "\\$&");

/** An absent variable. A function, not a constant: no module-scope work. */
const absent = (): Read => Option.some(Option.none());
const present = (value: Option.Option<Value>): Read => Option.map(value, Option.some);
const decode = (value: string): Option.Option<string> =>
  Option.liftThrowable(decodeURIComponent)(value);
const decodeAll = (values: ReadonlyArray<string>): Option.Option<Value> =>
  Option.all(Arr.map(values, decode));

/** A `U` capture: absent, a string, or (with a raw `,`) a list; decoded. */
const readUnreserved = (value: string | undefined): Read =>
  value === undefined
    ? absent()
    : present(value.includes(",") ? decodeAll(value.split(",")) : decode(value));

/** A `+` capture, kept as written; absent when empty (as `{+x}` expands an undefined `x`). */
const readReserved = (value: string | undefined): Read =>
  value === undefined || value === "" ? absent() : Option.some(Option.some(value));

/** A `#` capture, kept as written: `#` alone is an empty value, no `#` an absent one. */
const readFragment = (value: string | undefined): Read =>
  value === undefined ? absent() : Option.some(Option.some(value));

/** An exploded list, separated (and introduced) by `separator`. */
const readExploded =
  (separator: string) =>
  (value: string | undefined): Read =>
    value === undefined || value === ""
      ? absent()
      : present(decodeAll(value.slice(1).split(separator)));

const step = (
  spec: VariableSpec,
  source: string,
  read: (value: string | undefined) => Read,
): Step => ({
  source,
  readers: [{ name: spec.name, groups: 1, read: ([value]) => read(value) }],
});

/**
 * Each unnamed operator's capture and reading, unexploded. `;`, `?` and `&`
 * are named and read elsewhere; they never reach this table.
 */
const UNNAMED = {
  "+": ["([^?#]*?)", readReserved],
  "#": ["(?:#(.*?))?", readFragment],
  ".": [`(?:\\.(${U_NO_DOT}*))?`, readUnreserved],
  "/": [`(?:/(${U}*))?`, readUnreserved],
  // An empty simple expansion reads as undefined, never as `""`.
  "": [`(${U}*)`, (value: string | undefined) => readUnreserved(value === "" ? undefined : value)],
  ";": [`(${U}*)`, readUnreserved],
  "?": [`(${U}*)`, readUnreserved],
  "&": [`(${U}*)`, readUnreserved],
} satisfies {
  readonly [operator in Operator]: readonly [string, (value: string | undefined) => Read];
};

/** The step for one unnamed, single-variable expression. */
const unnamed = (operator: Operator, spec: VariableSpec): Step => {
  if (spec.explode) {
    return operator === "/"
      ? step(spec, `((?:/${U}*)*)`, readExploded("/"))
      : step(spec, `((?:\\.${U_NO_DOT}*)*)`, readExploded("."));
  }
  const [source, read] = UNNAMED[operator];
  return step(spec, source, read);
};

/** The step for a `;` expression: each name, then an optional value. */
const pathStyle = (expression: Expression): Step => ({
  source: Arr.map(expression.variables, (spec) => `(?:;(${escape(spec.name)})(?:=(${U}*))?)?`).join(
    "",
  ),
  readers: Arr.map(expression.variables, (spec) => ({
    name: spec.name,
    groups: 2,
    read: ([name, value]) => (name === undefined ? absent() : readUnreserved(value ?? "")),
  })),
});

const toStep = (part: Part): Step => {
  if (Predicate.isTagged(part, "Literal"))
    return { source: escape(encodeReserved(part.text)), readers: [] };
  if (part.operator === ";") return pathStyle(part);
  // `refuseExpression` has left exactly one variable in an unnamed expression.
  return Option.match(Arr.head(part.variables), {
    onNone: () => ({ source: "", readers: [] }),
    onSome: (spec) => unnamed(part.operator, spec),
  });
};

const isExpression = (part: Part): part is Expression => Predicate.isTagged(part, "Expression");
const isQuery = (part: Part): part is Expression =>
  isExpression(part) && (part.operator === "?" || part.operator === "&");

// ---- refusals ----

const EXPLODABLE: ReadonlyArray<Operator> = ["/", ".", "?", "&"];
const NAMED: ReadonlyArray<Operator> = [";", "?", "&"];

/** The refusal for one expression on its own, if any. */
const refuseExpression = (expression: Expression): Option.Option<Refusal> => {
  const refuse = (detail: string) => Option.some({ position: expression.position, detail });
  if (Arr.some(expression.variables, (spec) => Option.isSome(spec.prefix))) {
    return refuse("a prefix modifier drops what it truncates");
  }
  if (
    Arr.some(expression.variables, (spec) => spec.explode) &&
    !EXPLODABLE.includes(expression.operator)
  ) {
    return refuse(`explode under "${expression.operator}" cannot tell a list from a record`);
  }
  if (
    !NAMED.includes(expression.operator) &&
    Arr.isReadonlyArrayNonEmpty(expression.variables.slice(1))
  ) {
    return refuse("several unnamed variables: an undefined one would shift the rest");
  }
  return Option.none();
};

/** Whether `next` may directly follow `previous`, with no literal between them. */
const mayAdjoin = (previous: Operator, next: Operator): boolean => {
  if (next === "" || next === "+" || previous === "#") return false;
  if (previous === "+") return next === "?" || next === "&" || next === "#";
  // A `U` value holds a raw `.`, except under the `.` operator.
  return next !== "." || previous === ".";
};

const refuseRepeated = (expressions: ReadonlyArray<Expression>): Option.Option<Refusal> => {
  const names = Arr.flatMap(expressions, (expression) =>
    Arr.map(expression.variables, (spec) => spec.name),
  );
  return Arr.findFirst(expressions, (expression) =>
    Arr.some(
      expression.variables,
      (spec) => names.indexOf(spec.name) !== names.lastIndexOf(spec.name),
    )
      ? Option.some({ position: expression.position, detail: "a variable used twice" })
      : Option.none(),
  );
};

const refuseMisplacedQuery = (parts: ReadonlyArray<Part>): Option.Option<Refusal> =>
  Option.flatMap(Arr.findFirstIndex(parts, isQuery), (first) => {
    const query = parts[first];
    return Arr.some(parts.slice(first), (part) => !isQuery(part)) &&
      query !== undefined &&
      isExpression(query)
      ? Option.some({
          position: query.position,
          detail: "a query expression must come after every other part",
        })
      : Option.none();
  });

const refuseAdjacent = (parts: ReadonlyArray<Part>): Option.Option<Refusal> =>
  Arr.findFirst(parts, (part, index) => {
    const previous = parts[index - 1];
    return isExpression(part) &&
      previous !== undefined &&
      isExpression(previous) &&
      !mayAdjoin(previous.operator, part.operator)
      ? Option.some({
          position: part.position,
          detail: "two expressions with no literal between them",
        })
      : Option.none();
  });

const refusalOf = (parts: ReadonlyArray<Part>): Option.Option<Refusal> => {
  const expressions = Arr.filter(parts, isExpression);
  return Option.firstSomeOf([
    Arr.findFirst(expressions, refuseExpression),
    refuseRepeated(expressions),
    refuseMisplacedQuery(parts),
    refuseAdjacent(parts),
  ]);
};

// ---- matching ----

/** `a=1&b&c=` → `[["a", "1"], ["b", ""], ["c", ""]]`. */
const pairsOf = (query: string): ReadonlyArray<readonly [string, string]> =>
  Arr.map(
    Arr.filter(query.split("&"), (pair) => pair !== ""),
    (pair) => {
      const at = pair.indexOf("=");
      return at < 0 ? ([pair, ""] as const) : ([pair.slice(0, at), pair.slice(at + 1)] as const);
    },
  );

/** Every pair named `name`, decoded. */
const valuesNamed = (
  pairs: ReadonlyArray<readonly [string, string]>,
  name: string,
): ReadonlyArray<string> =>
  Arr.map(
    Arr.filter(pairs, ([key]) => key === name),
    ([, value]) => value,
  );

/** The pairs no query variable names, decoded, as a record; `None` when there are none. */
const leftovers = (
  pairs: ReadonlyArray<readonly [string, string]>,
  specs: ReadonlyArray<VariableSpec>,
): Read => {
  const unclaimed = Arr.filter(pairs, ([key]) => !Arr.some(specs, (spec) => spec.name === key));
  if (!Arr.isReadonlyArrayNonEmpty(unclaimed)) return absent();
  return present(
    Option.map(
      Option.all(Arr.map(unclaimed, ([key, value]) => Option.all([decode(key), decode(value)]))),
      (entries) => Record.fromEntries(entries),
    ),
  );
};

/**
 * One query variable, by name: the first value, or every one when exploded.
 * An exploded variable with no pair of its own name takes the pairs no
 * variable names, as a record (`{?keys*}` → `?a=1&b=2`), when it is the
 * first such variable.
 */
const readQueryVariable = (
  pairs: ReadonlyArray<readonly [string, string]>,
  specs: ReadonlyArray<VariableSpec>,
  spec: VariableSpec,
): Read => {
  const values = valuesNamed(pairs, spec.name);
  if (Arr.isReadonlyArrayNonEmpty(values)) {
    return spec.explode ? present(decodeAll(values)) : readUnreserved(values[0]);
  }
  const takesLeftovers = Option.exists(
    Arr.findFirst(
      specs,
      (other) => other.explode && !Arr.isReadonlyArrayNonEmpty(valuesNamed(pairs, other.name)),
    ),
    (first) => first === spec,
  );
  return takesLeftovers ? leftovers(pairs, specs) : absent();
};

const entry = (name: string, read: Read): Option.Option<Option.Option<readonly [string, Value]>> =>
  Option.map(
    read,
    Option.map((value) => [name, value] as const),
  );

/**
 * Compiles a template's parts for matching; a {@link Refusal} when the
 * template is outside the matchable subset.
 */
export const compile = (parts: ReadonlyArray<Part>): Result.Result<Compiled, Refusal> => {
  const refusal = refusalOf(parts);
  if (Option.isSome(refusal)) return Result.fail(refusal.value);
  const split = Option.getOrElse(Arr.findFirstIndex(parts, isQuery), () => parts.length);
  const steps = Arr.map(parts.slice(0, split), toStep);
  const queries = Arr.filter(parts.slice(split), isExpression);
  const readers = Arr.flatMap(steps, (one) => one.readers);
  const groupCount = Arr.reduce(readers, 0, (count, reader) => count + reader.groups);
  const lead = Option.match(Arr.head(queries), {
    onNone: () => "",
    onSome: (query) => `(?:${query.operator === "&" ? "&" : "\\?"}(.*))?`,
  });
  const pattern = new RegExp(`^${Arr.map(steps, (one) => one.source).join("")}${lead}$`, "u");
  const offsets = Arr.scan(readers, 0, (offset, reader) => offset + reader.groups);
  const querySpecs = Arr.flatMap(queries, (query) => query.variables);
  return Result.succeed({
    match: (url) =>
      Option.flatMap(Option.fromNullishOr(pattern.exec(url)), (found) => {
        const groups = found.slice(1);
        const pairs = pairsOf(groups[groupCount] ?? "");
        const reads = [
          ...Arr.map(readers, (reader, index) => {
            const start = offsets[index] ?? 0;
            return entry(reader.name, reader.read(groups.slice(start, start + reader.groups)));
          }),
          ...Arr.map(querySpecs, (spec) =>
            entry(spec.name, readQueryVariable(pairs, querySpecs, spec)),
          ),
        ];
        return Option.map(Option.all(reads), (entries) =>
          Record.fromEntries(Arr.getSomes(entries)),
        );
      }),
  });
};
