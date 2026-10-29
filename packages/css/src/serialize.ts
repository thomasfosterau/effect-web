/**
 * Serialisation back to CSS text: identifiers, strings and URLs by
 * CSSOM's rules, component values by CSS Syntax 3 §9 (with an empty
 * comment between two tokens that would otherwise run together), and
 * declarations and declaration lists as CSSOM writes a `style` attribute.
 * Parsing the output gives back what was serialised.
 *
 * @since 0.1.0
 */
/* oxlint-disable effect/avoid-direct-tag-checks, effect/prefer-match-over-switch -- CSS Syntax 3 §9 serialises token by token: one token-type dispatch per token, as the tokenizer and parser do (see syntax.ts). */
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import type { AtRule, Declaration, QualifiedRule, SyntaxError } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

const escapeCodePoint = (codePoint: number): string => `\\${codePoint.toString(16)} `;

const isDigit = (codePoint: number): boolean => codePoint >= 0x30 && codePoint <= 0x39;

const isControl = (codePoint: number): boolean =>
  (codePoint >= 0x1 && codePoint <= 0x1f) || codePoint === 0x7f;

/** A code point that may stand unescaped in a name: a letter, digit, `-`, `_` or non-ASCII. */
const isNameCodePoint = (codePoint: number): boolean =>
  codePoint >= 0x80 ||
  codePoint === 0x2d ||
  codePoint === 0x5f ||
  isDigit(codePoint) ||
  (codePoint >= 0x41 && codePoint <= 0x5a) ||
  (codePoint >= 0x61 && codePoint <= 0x7a);

/** One code point of a name, escaped where it must be. */
const nameCodePoint = (codePoint: number): string => {
  if (codePoint === 0) return "�";
  if (isControl(codePoint)) return escapeCodePoint(codePoint);
  const char = String.fromCodePoint(codePoint);
  return isNameCodePoint(codePoint) ? char : `\\${char}`;
};

const codePointsOf = (value: string): ReadonlyArray<number> =>
  Array.from(value, (char) => char.codePointAt(0) ?? 0);

/** One code point of an identifier at `index`, given the first code point. */
const identifierCodePoint = (
  codePoint: number,
  index: number,
  first: number,
  length: number,
): string => {
  if (codePoint !== 0 && isDigit(codePoint) && (index === 0 || (index === 1 && first === 0x2d))) {
    return escapeCodePoint(codePoint);
  }
  if (index === 0 && codePoint === 0x2d && length === 1) return "\\-";
  return nameCodePoint(codePoint);
};

/**
 * Serialises an identifier (CSSOM §2.1, "serialize an identifier"):
 * escapes what would not tokenize back as the same identifier, a leading
 * digit and a lone `-` included, and replaces NUL with U+FFFD.
 *
 * @example
 * ```ts
 * import { strictEqual } from "node:assert"
 * import { Serialize } from "@thomasfosterau/effect-css"
 *
 * strictEqual(Serialize.identifier("1st"), "\\31 st")
 * strictEqual(Serialize.identifier("a b"), "a\\ b")
 * ```
 *
 * @since 0.1.0
 * @category serialisation
 */
export const identifier = (value: string): string => {
  const codePoints = codePointsOf(value);
  const [first = 0] = codePoints;
  return codePoints
    .map((codePoint, index) => identifierCodePoint(codePoint, index, first, codePoints.length))
    .join("");
};

/** A name with no leading-character rule: a hash's value, a dimension's unit tail. */
const name = (value: string): string => codePointsOf(value).map(nameCodePoint).join("");

const stringCodePoint = (codePoint: number): string => {
  if (codePoint === 0) return "�";
  if (isControl(codePoint)) return escapeCodePoint(codePoint);
  const char = String.fromCodePoint(codePoint);
  return codePoint === 0x22 || codePoint === 0x5c ? `\\${char}` : char;
};

/**
 * Serialises a string (CSSOM §2.1, "serialize a string"): double-quoted,
 * with `"` and `\` escaped, control characters escaped as code points and
 * NUL replaced with U+FFFD.
 *
 * @example
 * ```ts
 * import { strictEqual } from "node:assert"
 * import { Serialize } from "@thomasfosterau/effect-css"
 *
 * strictEqual(Serialize.string('say "hi"'), '"say \\"hi\\""')
 * ```
 *
 * @since 0.1.0
 * @category serialisation
 */
export const string = (value: string): string =>
  `"${codePointsOf(value).map(stringCodePoint).join("")}"`;

/**
 * Serialises a URL (CSSOM §2.1, "serialize a URL"): `url(` and the URL
 * as a string.
 *
 * @example
 * ```ts
 * import { strictEqual } from "node:assert"
 * import { Serialize } from "@thomasfosterau/effect-css"
 *
 * strictEqual(Serialize.url("a.png"), 'url("a.png")')
 * ```
 *
 * @since 0.1.0
 * @category serialisation
 */
export const url = (value: string): string => `url(${string(value)})`;

/** One code point of an unquoted URL token, escaped where the tokenizer would end or reject it. */
const urlCodePoint = (codePoint: number): string => {
  if (codePoint === 0) return "\uFFFD";
  if (isControl(codePoint) || codePoint === 0x20) return escapeCodePoint(codePoint);
  const char = String.fromCodePoint(codePoint);
  return URL_SPECIAL.includes(char) ? `\\${char}` : char;
};

const URL_SPECIAL: ReadonlyArray<string> = ['"', "'", "(", ")", "\\"];

/** A dimension's unit, its `e` escaped where it would read as an exponent. */
const unit = (value: string): string => {
  const escaped = identifier(value);
  return /^[eE]-?[0-9]/u.test(value)
    ? `${escapeCodePoint(value.codePointAt(0) ?? 0)}${escaped.slice(1)}`
    : escaped;
};

const hex = (value: number): string => Str.toUpperCase(value.toString(16));

const CLOSING = { "[": "]", "(": ")", "{": "}" } as const;

/** One component value's text, without the comment rule between neighbours. */
const valueText = (value: ComponentValue): string => {
  switch (value._tag) {
    case "Ident":
      return identifier(value.value);
    case "AtKeyword":
      return `@${identifier(value.value)}`;
    case "Hash":
      return `#${value.type === "id" ? identifier(value.value) : name(value.value)}`;
    case "String":
      return string(value.value);
    case "Url":
      return `url(${codePointsOf(value.value).map(urlCodePoint).join("")})`;
    case "Delim":
      return value.value === "\\" ? "\\\n" : value.value;
    case "Number":
      return value.representation;
    case "Percentage":
      return `${value.representation}%`;
    case "Dimension":
      return `${value.representation}${unit(value.unit)}`;
    case "UnicodeRange":
      return value.start === value.end
        ? `U+${hex(value.start)}`
        : `U+${hex(value.start)}-${hex(value.end)}`;
    case "Func":
      return `${identifier(value.name)}(${componentValues(value.value)})`;
    case "Block":
      return `${value.associated}${componentValues(value.value)}${CLOSING[value.associated]}`;
    case "BadString":
      return '"\n';
    case "BadUrl":
      return "url(()";
    case "Whitespace":
      return " ";
    case "CDO":
      return "<!--";
    case "CDC":
      return "-->";
    case "Colon":
      return ":";
    case "Semicolon":
      return ";";
    case "Comma":
      return ",";
    case "IncludeMatch":
      return "~=";
    case "DashMatch":
      return "|=";
    case "PrefixMatch":
      return "^=";
    case "SuffixMatch":
      return "$=";
    case "SubstringMatch":
      return "*=";
    case "Column":
      return "||";
    case "CloseSquare":
      return "]";
    case "CloseParen":
      return ")";
    case "CloseCurly":
      return "}";
  }
};

/** The kind of token at one edge of a component value, for the comment rule. */
type Edge =
  | "ident"
  | "function"
  | "url"
  | "at-keyword"
  | "hash"
  | "number"
  | "percentage"
  | "dimension"
  | "cdc"
  | "unicode-range"
  | "("
  | "other"
  | `delim:${string}`;

const tokenEdge = (value: ComponentValue): Edge => {
  switch (value._tag) {
    case "Ident":
      return "ident";
    case "Url":
    case "BadUrl":
      return "url";
    case "AtKeyword":
      return "at-keyword";
    case "Hash":
      return "hash";
    case "Number":
      return "number";
    case "Percentage":
      return "percentage";
    case "Dimension":
      return "dimension";
    case "CDC":
      return "cdc";
    case "UnicodeRange":
      return "unicode-range";
    case "Delim":
      return `delim:${value.value}`;
    default:
      return "other";
  }
};

const firstEdge = (value: ComponentValue): Edge => {
  if (Predicate.isTagged(value, "Func")) return "function";
  if (Predicate.isTagged(value, "Block")) return value.associated === "(" ? "(" : "other";
  return tokenEdge(value);
};

/** A function or block ends in its closing token. */
const lastEdge = (value: ComponentValue): Edge =>
  Predicate.isTagged(value, "Func") || Predicate.isTagged(value, "Block")
    ? "other"
    : tokenEdge(value);

const IDENT_LIKE: ReadonlyArray<Edge> = ["ident", "function", "url"];
const NUMERIC: ReadonlyArray<Edge> = ["number", "percentage", "dimension"];

/** What may not follow each token without a comment between (CSS Syntax 3 §9, the table). */
const AFTER_IDENT: ReadonlyArray<Edge> = [...IDENT_LIKE, "delim:-", ...NUMERIC, "cdc", "("];
const AFTER_KEYWORD: ReadonlyArray<Edge> = [...IDENT_LIKE, "delim:-", ...NUMERIC, "cdc"];

const needsComment = (previous: Edge, next: Edge): boolean => {
  switch (previous) {
    case "ident":
      return AFTER_IDENT.includes(next);
    case "at-keyword":
    case "hash":
    case "dimension":
      return AFTER_KEYWORD.includes(next);
    case "delim:#":
    case "delim:-":
      return [...IDENT_LIKE, ...NUMERIC, "delim:-"].includes(next);
    case "number":
      return [...IDENT_LIKE, ...NUMERIC, "delim:%"].includes(next);
    case "delim:@":
      return [...IDENT_LIKE, "delim:-"].includes(next);
    case "delim:.":
    case "delim:+":
      return NUMERIC.includes(next);
    case "delim:/":
      return next === "delim:*";
    // The 2014 tokens this parser keeps: `||`, the attribute matchers and unicode-range.
    case "delim:|":
      return next === "delim:|" || next === "delim:=";
    case "delim:~":
    case "delim:^":
    case "delim:$":
    case "delim:*":
      return next === "delim:=";
    case "unicode-range":
      return [...IDENT_LIKE, ...NUMERIC, "delim:?", "delim:-"].includes(next);
    default:
      return false;
  }
};

/**
 * Serialises component values (CSS Syntax 3 §9): each token's text, with
 * `/**\/` between two tokens that would otherwise tokenize as one (an
 * identifier then a number, a `/` then a `*`, …). Numbers keep the
 * representation they were written with.
 *
 * @example
 * ```ts
 * import { strictEqual } from "node:assert"
 * import { Serialize, Syntax } from "@thomasfosterau/effect-css"
 *
 * strictEqual(Serialize.componentValues(Syntax.parseComponentValueList("rgb( 0 , 1 )  12.0px")), "rgb( 0 , 1 ) 12.0px")
 * ```
 *
 * @since 0.1.0
 * @category serialisation
 */
export const componentValues = (values: ReadonlyArray<ComponentValue>): string =>
  values
    .map((value, index) => {
      const previous = index > 0 ? values[index - 1] : undefined;
      const comment = previous !== undefined && needsComment(lastEdge(previous), firstEdge(value));
      return `${comment ? "/**/" : ""}${valueText(value)}`;
    })
    .join("");

const trimWhitespace = (values: ReadonlyArray<ComponentValue>): ReadonlyArray<ComponentValue> => {
  const start = values.findIndex((value) => !Predicate.isTagged(value, "Whitespace"));
  const end = values.findLastIndex((value) => !Predicate.isTagged(value, "Whitespace"));
  return start < 0 ? [] : values.slice(start, end + 1);
};

/**
 * Serialises a declaration as CSSOM writes one into a `style` attribute:
 * `name: value;`, with ` !important` before the semicolon when it is
 * important and the value's leading and trailing whitespace dropped. The
 * name keeps its case (a custom property's is significant).
 *
 * @example
 * ```ts
 * import { strictEqual } from "node:assert"
 * import { Serialize, Syntax } from "@thomasfosterau/effect-css"
 *
 * const [declaration] = Syntax.parseDeclarationList("color:red  !IMPORTANT")
 * if (declaration?._tag === "Declaration") {
 *   strictEqual(Serialize.declaration(declaration), "color: red !important;")
 * }
 * ```
 *
 * @since 0.1.0
 * @category serialisation
 */
export const declaration = (value: Declaration): string =>
  `${identifier(value.name)}: ${componentValues(trimWhitespace(value.value))}${value.important ? " !important" : ""};`;

/**
 * Serialises a declaration list as a `style` attribute: each declaration,
 * separated by single spaces. Anything that is not a declaration (a
 * `SyntaxError`, a nested rule) is left out.
 *
 * @example
 * ```ts
 * import { strictEqual } from "node:assert"
 * import { Serialize, Syntax } from "@thomasfosterau/effect-css"
 *
 * strictEqual(
 *   Serialize.declarationList(Syntax.parseDeclarationList("color:red;;margin : 0 auto;")),
 *   "color: red; margin: 0 auto;",
 * )
 * ```
 *
 * @since 0.1.0
 * @category serialisation
 */
export const declarationList = (
  values: ReadonlyArray<Declaration | AtRule | QualifiedRule | SyntaxError>,
): string =>
  values
    .flatMap((value) => (Predicate.isTagged(value, "Declaration") ? [declaration(value)] : []))
    .join(" ");
