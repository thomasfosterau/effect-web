/**
 * The tokenizer and parser against the css-parsing-tests suite
 * (`tests/fixtures/css-parsing-tests`, CC0; see that directory's README),
 * through a converter to the suite's JSON representation of the AST.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { Syntax, Token } from "@thomasfosterau/effect-css";

type ComponentValue = Token.ComponentValue;
import componentValueList from "./fixtures/css-parsing-tests/component_value_list.json" with { type: "json" };
import declarationList from "./fixtures/css-parsing-tests/declaration_list.json" with { type: "json" };
import oneComponentValue from "./fixtures/css-parsing-tests/one_component_value.json" with { type: "json" };
import oneDeclaration from "./fixtures/css-parsing-tests/one_declaration.json" with { type: "json" };
import oneRule from "./fixtures/css-parsing-tests/one_rule.json" with { type: "json" };
import ruleList from "./fixtures/css-parsing-tests/rule_list.json" with { type: "json" };
import stylesheet from "./fixtures/css-parsing-tests/stylesheet.json" with { type: "json" };

type Json = null | boolean | number | string | ReadonlyArray<Json>;

/** `-0` reads as `0`: the suite's JSON cannot tell them apart. */
const num = (value: number): number => value + 0;

const numeric = (
  kind: string,
  token: { value: number; representation: string; isInteger: boolean },
) => [kind, token.representation, num(token.value), token.isInteger ? "integer" : "number"];

/** A component value in the suite's representation, plus the error item it records after an unterminated string or URL. */
const toJsonItems = (value: ComponentValue): ReadonlyArray<Json> => {
  const json = toJson(value);
  if (Predicate.isTagged(value, "String") && value.unterminated)
    return [json, ["error", "eof-in-string"]];
  if (Predicate.isTagged(value, "Url") && value.unterminated)
    return [json, ["error", "eof-in-url"]];
  return [json];
};

const BLOCK_NAMES = { "(": "()", "[": "[]", "{": "{}" } as const;

/** A component value in the suite's representation (its README, "Component values"). */
const toJson = (value: ComponentValue): Json =>
  Match.valueTags(value, {
    Ident: (value) => ["ident", value.value],
    AtKeyword: (value) => ["at-keyword", value.value],
    Hash: (value) => ["hash", value.value, value.type],
    String: (value) => ["string", value.value],
    BadString: () => ["error", "bad-string"],
    Url: (value) => ["url", value.value],
    BadUrl: () => ["error", "bad-url"],
    Delim: (value) => value.value,
    Number: (value) => numeric("number", value),
    Percentage: (value) => numeric("percentage", value),
    Dimension: (value) => [...numeric("dimension", value), value.unit],
    UnicodeRange: (value) => ["unicode-range", value.start, value.end],
    Whitespace: () => " ",
    CDO: () => "<!--",
    CDC: () => "-->",
    Colon: () => ":",
    Semicolon: () => ";",
    Comma: () => ",",
    IncludeMatch: () => "~=",
    DashMatch: () => "|=",
    PrefixMatch: () => "^=",
    SuffixMatch: () => "$=",
    SubstringMatch: () => "*=",
    Column: () => "||",
    CloseSquare: () => ["error", "]"],
    CloseParen: () => ["error", ")"],
    CloseCurly: () => ["error", "}"],
    Func: (value) => ["function", value.name, ...value.value.flatMap(toJsonItems)],
    Block: (value) => [BLOCK_NAMES[value.associated], ...value.value.flatMap(toJsonItems)],
  });

const list = (values: ReadonlyArray<ComponentValue>): Json => values.flatMap(toJsonItems);

const item = (
  value: Syntax.Declaration | Syntax.AtRule | Syntax.QualifiedRule | Syntax.SyntaxError,
): Json =>
  Match.valueTags(value, {
    Declaration: (value) => ["declaration", value.name, list(value.value), value.important],
    AtRule: (value) => [
      "at-rule",
      value.name,
      list(value.prelude),
      Option.getOrNull(Option.map(value.block, list)),
    ],
    QualifiedRule: (value) => ["qualified rule", list(value.prelude), list(value.block)],
    SyntaxError: (value) => ["error", value.kind],
  });

const one = (value: ComponentValue | Syntax.SyntaxError): Json =>
  Predicate.isTagged(value, "SyntaxError") ? ["error", value.kind] : toJson(value);

/** The suite's alternating input / expected pairs. */
const pairs = (fixture: ReadonlyArray<unknown>): ReadonlyArray<readonly [string, unknown]> =>
  fixture.flatMap((input, index) =>
    index % 2 === 0 && Predicate.isString(input) ? [[input, fixture[index + 1]] as const] : [],
  );

describe("css-parsing-tests", () => {
  it.each([
    [
      "component_value_list",
      componentValueList,
      (css: string) => list(Syntax.parseComponentValueList(css)),
    ],
    [
      "one_component_value",
      oneComponentValue,
      (css: string) => one(Syntax.parseComponentValue(css)),
    ],
    [
      "declaration_list",
      declarationList,
      (css: string) => Syntax.parseDeclarationList(css).map(item),
    ],
    ["one_declaration", oneDeclaration, (css: string) => item(Syntax.parseDeclaration(css))],
    ["one_rule", oneRule, (css: string) => item(Syntax.parseRule(css))],
    ["rule_list", ruleList, (css: string) => Syntax.parseRuleList(css).map(item)],
    ["stylesheet", stylesheet, (css: string) => Syntax.parseStylesheet(css).map(item)],
  ] as const)("%s", (_, fixture, run) => {
    const cases = pairs(fixture);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.map(([input]) => [input, run(input)])).toEqual(cases);
  });
});

describe("error offsets", () => {
  it("reports where an invalid declaration starts", () => {
    const [, error] = Syntax.parseDeclarationList("a: b; 42; c: d");
    expect(error).toEqual({ _tag: "SyntaxError", kind: "invalid", offset: 6 });
  });

  it("reports extra input after one rule", () => {
    expect(Syntax.parseRule("a {} b")).toEqual({
      _tag: "SyntaxError",
      kind: "extra-input",
      offset: 5,
    });
  });
});
