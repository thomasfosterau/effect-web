/**
 * URI Templates (RFC 6570), all four levels: parse a template once, then
 * expand it with variables.
 *
 * A template is literal text and `{…}` expressions. An expression names
 * one or more variables, with an optional operator in front: none (simple
 * string), `+` (reserved), `#` (fragment), `.` (label), `/` (path segment),
 * `;` (path-style parameter), `?` (form-style query) or `&` (query
 * continuation). Each variable may take a prefix modifier (`{var:3}`) or
 * the explode modifier (`{list*}`). A value is a string (numbers and
 * booleans are stringified), a list, or an associative array; `null`,
 * `undefined`, an empty list and an empty object are undefined, and an
 * undefined variable expands to nothing.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import { encodeReserved, encodeUnreserved } from "./internal/encoding.ts";
import { compile, type MatchedValues } from "./internal/match.ts";

/**
 * Why a template was rejected, or could not be expanded.
 *
 * - `UnmatchedBrace` — a `{` without its `}`, or a `}` without its `{`.
 * - `InvalidLiteral` — a character a literal may not contain (space, `"`,
 *   `<`, `>`, `\`, `^`, `` ` ``, `|`, a control character) or a `%`
 *   that does not start a pct-encoded octet.
 * - `ReservedOperator` — one of the operators RFC 6570 reserves for future
 *   use (`=`, `,`, `!`, `@`, `|`).
 * - `InvalidVariable` — a variable name or modifier that is not RFC 6570
 *   syntax (an empty name, a space, `..`, a prefix of `0` or over `9999`,
 *   both modifiers).
 * - `PrefixOnComposite` — at expansion: a prefix modifier on a list or an
 *   associative array, which RFC 6570 §2.4.1 does not define.
 * - `Unmatchable` — from {@link matcher}: a template outside the subset a
 *   URL can be matched back against without guessing.
 *
 * @since 0.1.0
 * @category errors
 */
export type TemplateErrorReason =
  | "UnmatchedBrace"
  | "InvalidLiteral"
  | "ReservedOperator"
  | "InvalidVariable"
  | "PrefixOnComposite"
  | "Unmatchable";

/**
 * A template that is not RFC 6570 syntax, or could not be expanded.
 * `position` is the 0-based offset into the template where the fault is.
 *
 * @since 0.1.0
 * @category errors
 */
export class TemplateError extends Schema.TaggedError<TemplateError>()("TemplateError", {
  reason: Schema.Literals([
    "UnmatchedBrace",
    "InvalidLiteral",
    "ReservedOperator",
    "InvalidVariable",
    "PrefixOnComposite",
    "Unmatchable",
  ]),
  position: Schema.Number,
  message: Schema.String,
}) {}

const templateError = (reason: TemplateErrorReason, position: number, detail: string) =>
  new TemplateError({ reason, position, message: `URI template: ${detail} at ${position}` });

/**
 * An expression's operator: `""` for simple string expansion.
 *
 * @since 0.1.0
 * @category models
 */
export type Operator = "" | "+" | "#" | "." | "/" | ";" | "?" | "&";

/**
 * One variable of an expression: its `name` as written (pct-encoded octets
 * included), and its modifier — `prefix` (`{var:3}`, at most that many
 * characters) or `explode` (`{list*}`).
 *
 * @since 0.1.0
 * @category models
 */
export interface VariableSpec {
  readonly name: string;
  readonly prefix: Option.Option<number>;
  readonly explode: boolean;
}

/**
 * One part of a template: literal text, or an expression and where it
 * starts in the template.
 *
 * @since 0.1.0
 * @category models
 */
export type Part =
  | { readonly _tag: "Literal"; readonly text: string }
  | {
      readonly _tag: "Expression";
      readonly operator: Operator;
      readonly variables: ReadonlyArray<VariableSpec>;
      readonly position: number;
    };

/**
 * A parsed URI template: its `source` text and its {@link Part}s.
 *
 * @since 0.1.0
 * @category models
 */
export interface UriTemplate {
  readonly source: string;
  readonly parts: ReadonlyArray<Part>;
}

/**
 * A variable's value. Numbers and booleans expand as their string form;
 * `null`, `undefined`, `[]` and `{}` are undefined.
 *
 * @since 0.1.0
 * @category models
 */
export type Value =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number | boolean>
  | { readonly [key: string]: string | number | boolean }
  | null
  | undefined;

/**
 * The variables a template is expanded with, by name as written in the
 * template.
 *
 * @since 0.1.0
 * @category models
 */
export type Variables = { readonly [name: string]: Value };

// ---- parsing ----

const TOKENS = /\{([^{}]*)\}|([^{}]+)|([{}])/gu;
// RFC 6570 §2.1 also excludes `'`; the uritemplate-test suite (§2.1
// Literals) expects it to pass through, as every major implementation does.
const LITERAL_FAULT = /[\p{Cc} "<>\\^`|]|%(?![0-9A-Fa-f]{2})/u;
const OPERATORS = "+#./;?&";
const RESERVED_OPERATORS = "=,!@|";
const VARSPEC =
  /^((?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*)(?::([1-9][0-9]{0,3})|(\*))?$/u;

const isOperator = (character: string): character is Exclude<Operator, ""> =>
  character !== "" && OPERATORS.includes(character);

const literal = (text: string, position: number): Result.Result<Part, TemplateError> => {
  const fault = LITERAL_FAULT.exec(text);
  return fault === null
    ? Result.succeed({ _tag: "Literal", text })
    : Result.fail(
        templateError("InvalidLiteral", position + fault.index, `invalid literal "${fault[0]}"`),
      );
};

const variableSpec = (
  spec: string,
  position: number,
): Result.Result<VariableSpec, TemplateError> => {
  const match = VARSPEC.exec(spec);
  const name = match?.[1];
  return match === null || name === undefined
    ? Result.fail(templateError("InvalidVariable", position, `invalid variable "${spec}"`))
    : Result.succeed({
        name,
        prefix: Option.map(Option.fromUndefinedOr(match[2]), Number),
        explode: match[3] === "*",
      });
};

const expression = (body: string, position: number): Result.Result<Part, TemplateError> => {
  const first = body.charAt(0);
  if (first !== "" && RESERVED_OPERATORS.includes(first)) {
    return Result.fail(
      templateError("ReservedOperator", position + 1, `reserved operator "${first}"`),
    );
  }
  const operator: Operator = isOperator(first) ? first : "";
  const list = body.slice(operator.length);
  // Each variable's position: after the `{`, the operator, and the specs before it.
  const specs = list.split(",");
  const offsets = Arr.scan(
    specs,
    position + 1 + operator.length,
    (offset, spec) => offset + spec.length + 1,
  );
  return Result.map(
    Result.all(Arr.map(specs, (spec, index) => variableSpec(spec, offsets[index] ?? position))),
    (variables): Part => ({ _tag: "Expression", operator, variables, position }),
  );
};

const token = (match: RegExpMatchArray): Result.Result<Part, TemplateError> => {
  const position = match.index ?? 0;
  const [, body, text] = match;
  if (body !== undefined) return expression(body, position);
  if (text !== undefined) return literal(text, position);
  return Result.fail(templateError("UnmatchedBrace", position, `unmatched "${match[0]}"`));
};

/**
 * Parses an RFC 6570 template. Fails with a {@link TemplateError} giving
 * the reason and the offset of the first fault.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { UriTemplate } from "@thomasfosterau/effect-uri-template"
 *
 * const parsed = UriTemplate.parse("/search{?q,lang}")
 * console.log(Result.isSuccess(parsed)) // true
 * const broken = UriTemplate.parse("/search{?q")
 * if (Result.isFailure(broken)) console.log(broken.failure.reason, broken.failure.position) // "UnmatchedBrace" 7
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (source: string): Result.Result<UriTemplate, TemplateError> =>
  Result.map(Result.all(Arr.map(Arr.fromIterable(source.matchAll(TOKENS)), token)), (parts) => ({
    source,
    parts,
  }));

/**
 * The names of every variable a template uses, each once, in order of
 * first use.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { UriTemplate } from "@thomasfosterau/effect-uri-template"
 *
 * const template = Result.getOrThrow(UriTemplate.parse("/users{/id}{?fields*,id}"))
 * console.log(UriTemplate.variables(template)) // ["id", "fields"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const variables = (template: UriTemplate): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.flatMap(template.parts, (part) =>
      Predicate.isTagged(part, "Expression")
        ? Arr.map(part.variables, (variable) => variable.name)
        : [],
    ),
  );

// ---- expansion (RFC 6570 Appendix A) ----

interface Behaviour {
  readonly first: string;
  readonly separator: string;
  readonly named: boolean;
  readonly ifEmpty: string;
  readonly encode: (value: string) => string;
}

const BEHAVIOUR = {
  "": { first: "", separator: ",", named: false, ifEmpty: "", encode: encodeUnreserved },
  "+": { first: "", separator: ",", named: false, ifEmpty: "", encode: encodeReserved },
  "#": { first: "#", separator: ",", named: false, ifEmpty: "", encode: encodeReserved },
  ".": { first: ".", separator: ".", named: false, ifEmpty: "", encode: encodeUnreserved },
  "/": { first: "/", separator: "/", named: false, ifEmpty: "", encode: encodeUnreserved },
  ";": { first: ";", separator: ";", named: true, ifEmpty: "", encode: encodeUnreserved },
  "?": { first: "?", separator: "&", named: true, ifEmpty: "=", encode: encodeUnreserved },
  "&": { first: "&", separator: "&", named: true, ifEmpty: "=", encode: encodeUnreserved },
} satisfies { readonly [operator in Operator]: Behaviour };

/** `name=value`, or `name` + `ifEmpty` for an empty value. */
const named = (behaviour: Behaviour, name: string, value: string): string =>
  value === "" ? name + behaviour.ifEmpty : `${name}=${value}`;

const expandString = (behaviour: Behaviour, spec: VariableSpec, value: string): string => {
  const truncated = Option.match(spec.prefix, {
    onNone: () => value,
    onSome: (length) => Array.from(value).slice(0, length).join(""),
  });
  const encoded = behaviour.encode(truncated);
  return behaviour.named ? named(behaviour, spec.name, encoded) : encoded;
};

const expandList = (
  behaviour: Behaviour,
  spec: VariableSpec,
  items: ReadonlyArray<string>,
): string => {
  const encoded = Arr.map(items, behaviour.encode);
  if (spec.explode) {
    return Arr.map(encoded, (item) =>
      behaviour.named ? named(behaviour, spec.name, item) : item,
    ).join(behaviour.separator);
  }
  const joined = encoded.join(",");
  return behaviour.named ? `${spec.name}=${joined}` : joined;
};

const expandPairs = (
  behaviour: Behaviour,
  spec: VariableSpec,
  pairs: ReadonlyArray<readonly [string, string]>,
): string => {
  const encoded = Arr.map(
    pairs,
    ([key, value]) => [behaviour.encode(key), behaviour.encode(value)] as const,
  );
  if (spec.explode) {
    return Arr.map(encoded, ([key, value]) =>
      behaviour.named ? named(behaviour, key, value) : `${key}=${value}`,
    ).join(behaviour.separator);
  }
  const joined = Arr.flatMap(encoded, (pair) => pair).join(",");
  return behaviour.named ? `${spec.name}=${joined}` : joined;
};

const isList = (value: Value): value is ReadonlyArray<string | number | boolean> =>
  Array.isArray(value);

/** A composite value's expansion: a prefix modifier on one is an error. */
const composite = (
  spec: VariableSpec,
  position: number,
  expansion: () => string,
): Result.Result<Option.Option<string>, TemplateError> =>
  Option.isSome(spec.prefix)
    ? Result.fail(
        templateError("PrefixOnComposite", position, `prefix on composite value "${spec.name}"`),
      )
    : Result.succeed(Option.some(expansion()));

const UNDEFINED: Result.Result<Option.Option<string>, TemplateError> = Result.succeed(
  Option.none(),
);

/** One variable's expansion; `None` when it is undefined. */
const expandVariable = (
  behaviour: Behaviour,
  spec: VariableSpec,
  value: Value,
  position: number,
): Result.Result<Option.Option<string>, TemplateError> => {
  if (value === null || value === undefined) return UNDEFINED;
  if (isList(value)) {
    return Arr.match(value, {
      onEmpty: () => UNDEFINED,
      onNonEmpty: (items) =>
        composite(spec, position, () => expandList(behaviour, spec, Arr.map(items, String))),
    });
  }
  if (!Predicate.isObject(value)) {
    return Result.succeed(Option.some(expandString(behaviour, spec, String(value))));
  }
  return Arr.match(Record.toEntries(value), {
    onEmpty: () => UNDEFINED,
    onNonEmpty: (pairs) =>
      composite(spec, position, () =>
        expandPairs(
          behaviour,
          spec,
          Arr.map(pairs, ([key, item]) => [key, String(item)] as const),
        ),
      ),
  });
};

const expandPart = (part: Part, values: Variables): Result.Result<string, TemplateError> => {
  if (Predicate.isTagged(part, "Literal")) return Result.succeed(encodeReserved(part.text));
  const behaviour = BEHAVIOUR[part.operator];
  return Result.map(
    Result.all(
      Arr.map(part.variables, (spec) =>
        expandVariable(behaviour, spec, values[spec.name], part.position),
      ),
    ),
    (expanded) => {
      const defined = Arr.getSomes(expanded);
      return Arr.isReadonlyArrayNonEmpty(defined)
        ? behaviour.first + defined.join(behaviour.separator)
        : "";
    },
  );
};

/**
 * Expands a template with `values` (RFC 6570 §3). Fails with a
 * `PrefixOnComposite` {@link TemplateError} for a prefix modifier on a
 * list or associative array; every other template expands.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { UriTemplate } from "@thomasfosterau/effect-uri-template"
 *
 * const template = Result.getOrThrow(UriTemplate.parse("https://api.example/users{/id}{?fields*}"))
 * console.log(Result.getOrThrow(UriTemplate.expand(template, { id: "42", fields: ["name", "email"] })))
 * // "https://api.example/users/42?fields=name&fields=email"
 * ```
 *
 * @since 0.1.0
 * @category expansion
 */
export const expand = (
  template: UriTemplate,
  values: Variables,
): Result.Result<string, TemplateError> =>
  Result.map(Result.all(Arr.map(template.parts, (part) => expandPart(part, values))), (parts) =>
    parts.join(""),
  );

/**
 * The decoded side of {@link UriTemplateFromString}: a {@link UriTemplate}.
 *
 * @since 0.1.0
 * @category models
 */
export type UriTemplateFromString = typeof UriTemplateFromString.Type;

/**
 * A template as its source string: decodes by {@link parse}, failing on a
 * malformed template, and encodes back to the source.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { UriTemplate } from "@thomasfosterau/effect-uri-template"
 *
 * const template = Schema.decodeUnknownSync(UriTemplate.UriTemplateFromString)("{/path*}")
 * console.log(template.parts.length) // 1
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const UriTemplateFromString: Schema.Codec<UriTemplate, string> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare(
      (input): input is UriTemplate =>
        Predicate.hasProperty(input, "source") &&
        Predicate.isString(input.source) &&
        Predicate.hasProperty(input, "parts") &&
        Array.isArray(input.parts),
      { expected: "a parsed URI template" },
    ),
    {
      decode: SchemaGetter.transformEffect((source: string) =>
        Result.match(parse(source), {
          onSuccess: Effect.succeed,
          onFailure: (error) =>
            Effect.fail(new SchemaIssue.InvalidValue({ message: error.message }, source)),
        }),
      ),
      encode: SchemaGetter.transform((template: UriTemplate) => template.source),
    },
  ),
);

// ---- matching (the inverse) ----

/**
 * The variables {@link match} recovers from a URL: each one the URL
 * defines, a string, a list of strings or a record of them. It is a
 * {@link Variables}, so it expands straight back.
 *
 * @since 0.1.0
 * @category models
 */
export type Matched = MatchedValues;

/**
 * A template compiled for matching URLs back to their variables; make one
 * with {@link matcher}.
 *
 * @since 0.1.0
 * @category models
 */
export interface Matcher {
  readonly template: UriTemplate;
  readonly match: (url: string) => Option.Option<Matched>;
}

/**
 * Compiles a template for {@link match}: recovering the variables a URL was
 * expanded from, for routing. RFC 6570 §1.4 warns that the inverse is
 * ambiguous in general, so only an unambiguous subset compiles; anything
 * else fails `Unmatchable` here, with the expression's position, rather
 * than guessing at match time. A template is refused when it has:
 *
 * - a prefix modifier (`{var:3}`), which drops what it truncates;
 * - several variables in one unnamed expression (`{x,y}`, `{/a,b}`),
 *   where an undefined one would shift the rest — named ones (`;`, `?`,
 *   `&`) are fine;
 * - explode anywhere but `/`, `.`, `?` and `&` (`{;list*}`, `{keys*}`);
 * - two expressions with no literal between them, when the first one's
 *   values could contain the second one's leading character (`{x}{y}`,
 *   `{x}{.ext}`) — `{/id}{?q}` is fine;
 * - a `?` / `&` expression before another part, or a variable used twice.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { UriTemplate } from "@thomasfosterau/effect-uri-template"
 *
 * const parsed = Result.getOrThrow(UriTemplate.parse("/x{a:3}"))
 * const refused = UriTemplate.matcher(parsed)
 * if (Result.isFailure(refused)) console.log(refused.failure.reason) // "Unmatchable"
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const matcher = (template: UriTemplate): Result.Result<Matcher, TemplateError> =>
  Result.mapBoth(compile(template.parts), {
    onFailure: (refusal) => templateError("Unmatchable", refusal.position, refusal.detail),
    onSuccess: (compiled) => ({ template, match: compiled.match }),
  });

/**
 * The variables `url` was expanded from; `None` when it does not match.
 *
 * - Values of `U` operators are percent-decoded, and a raw `,` (which a `U`
 *   value never contains) separates a list; `+` and `#` values are kept as
 *   written. An exploded `/` or `.` expression, or a repeated `?` / `&`
 *   name, gives a list.
 * - Query variables (`?`, `&`) are read by name, in any order. An exploded
 *   one with no parameter of its own name (`{?keys*}` → `?a=1&b=2`) takes
 *   the parameters no other variable names, as a record; otherwise
 *   parameters the template does not name are ignored.
 * - An undefined variable is absent from the result.
 *
 * For a URL the template itself expanded, expanding the result reproduces
 * the URL: `expand(template, match(url)) === url`.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import * as Result from "effect/Result"
 * import { UriTemplate } from "@thomasfosterau/effect-uri-template"
 *
 * const users = Result.getOrThrow(
 *   Result.flatMap(UriTemplate.parse("/users{/id}{?fields*,lang}"), UriTemplate.matcher),
 * )
 * console.log(UriTemplate.match(users, "/users/42?lang=en&fields=name&fields=email"))
 * // { _id: "Option", _tag: "Some", value: { id: "42", fields: ["name", "email"], lang: "en" } }
 * console.log(Option.isNone(UriTemplate.match(users, "/teams/42"))) // true
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const match = (matcher: Matcher, url: string): Option.Option<Matched> => matcher.match(url);
