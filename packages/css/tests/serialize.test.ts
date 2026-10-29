/**
 * Serialisation: CSSOM's identifier, string and URL rules, the CSS
 * Syntax 3 §9 comment rule between tokens, declarations as a `style`
 * attribute, and the round trip (parse, serialise, parse again) over every
 * input of the vendored css-parsing-tests suite.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import { Serialize, Syntax, type Token } from "@thomasfosterau/effect-css";

type ComponentValue = Token.ComponentValue;
import componentValueList from "./fixtures/css-parsing-tests/component_value_list.json" with { type: "json" };
import declarationList from "./fixtures/css-parsing-tests/declaration_list.json" with { type: "json" };
import oneComponentValue from "./fixtures/css-parsing-tests/one_component_value.json" with { type: "json" };
import stylesheet from "./fixtures/css-parsing-tests/stylesheet.json" with { type: "json" };

/** The suite's inputs: the even entries of its alternating input / expected list. */
const inputs = (fixture: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  fixture.filter((input, index): input is string => index % 2 === 0 && Predicate.isString(input));

const isWhitespace = (value: ComponentValue): boolean => Predicate.isTagged(value, "Whitespace");

/**
 * Component values as serialisation keeps them: the `unterminated` flags
 * cleared (it closes what the input left open) and each run of whitespace
 * tokens as one (comments are dropped).
 */
const terminated = (values: ReadonlyArray<ComponentValue>): ReadonlyArray<ComponentValue> =>
  values
    .filter((value, index) => {
      const previous = values[index - 1];
      return !(isWhitespace(value) && previous !== undefined && isWhitespace(previous));
    })
    .map((value): ComponentValue => {
      if (Predicate.isTagged(value, "String") || Predicate.isTagged(value, "Url")) {
        return { ...value, unterminated: false };
      }
      if (Predicate.isTagged(value, "Func") || Predicate.isTagged(value, "Block")) {
        return { ...value, value: terminated(value.value) };
      }
      return value;
    });

/** Values without their leading and trailing whitespace. */
const trim = (values: ReadonlyArray<ComponentValue>): ReadonlyArray<ComponentValue> => {
  const start = values.findIndex((value) => !isWhitespace(value));
  const end = values.findLastIndex((value) => !isWhitespace(value));
  return start < 0 ? [] : values.slice(start, end + 1);
};

describe("Serialize.identifier", () => {
  it.each([
    ["color", "color"],
    ["-webkit-box", "-webkit-box"],
    ["--custom", "--custom"],
    ["1st", "\\31 st"],
    ["-2x", "-\\32 x"],
    ["-", "\\-"],
    ["a b", "a\\ b"],
    ["a.b", "a\\.b"],
    ["\u0000x", "�x"],
    ["tab\there", "tab\\9 here"],
    ["\u007F", "\\7f "],
    ["café", "café"],
    ["_x", "_x"],
    ["", ""],
  ])("serialises %j as %j", (input, output) => {
    expect(Serialize.identifier(input)).toBe(output);
  });
});

describe("Serialize.string", () => {
  it.each([
    ["", '""'],
    ["plain", '"plain"'],
    ['a"b', '"a\\"b"'],
    ["a\\b", '"a\\\\b"'],
    ["line\nbreak", '"line\\a break"'],
    ["\u0000", '"�"'],
    ["it's", '"it\'s"'],
  ])("serialises %j as %j", (input, output) => {
    expect(Serialize.string(input)).toBe(output);
  });

  it("serialises a URL as a string in url()", () => {
    expect(Serialize.url('a b".png')).toBe('url("a b\\".png")');
  });
});

describe("Serialize.componentValues", () => {
  const roundTrip = (css: string): string =>
    Serialize.componentValues(Syntax.parseComponentValueList(css));

  it.each([
    ["a  b", "a b"],
    ["rgb( 0 ,1 )", "rgb( 0 ,1 )"],
    ["[a] {b} (c)", "[a] {b} (c)"],
    ["+.5e1 10% 1.0px", "+.5e1 10% 1.0px"],
    ["#fff #1a", "#fff #1a"],
    ['url(a.png) url( "b" ) url(a\\(b)', 'url(a.png) url( "b" ) url(a\\(b)'],
    ["@media", "@media"],
    ["U+0-7F u+1F600", "U+0-7F U+1F600"],
    ["a ~= b |= c ^= $= *= ||", "a ~= b |= c ^= $= *= ||"],
    ["<!-- -->", "<!-- -->"],
  ])("serialises %j as %j", (input, output) => {
    expect(roundTrip(input)).toBe(output);
  });

  it("escapes a unit's e when it would read as an exponent", () => {
    expect(roundTrip("1\\65 3")).toBe("1\\65 3");
  });

  it("puts an empty comment between tokens that would otherwise merge", () => {
    expect(roundTrip("a/**/b")).toBe("a/**/b");
    expect(roundTrip("1/**/2")).toBe("1/**/2");
    expect(roundTrip("a/**/(b)")).toBe("a/**/(b)");
    expect(roundTrip("a/**/-")).toBe("a/**/-");
    expect(roundTrip("//**/*")).toBe("//**/*");
    expect(roundTrip("1/**/%")).toBe("1/**/%");
    expect(roundTrip("#/**/-")).toBe("#/**/-");
    expect(roundTrip("a b")).toBe("a b");
  });
});

describe("Serialize.declaration", () => {
  it("writes a style attribute", () => {
    expect(
      Serialize.declarationList(
        Syntax.parseDeclarationList(
          "  color:red ;; Margin : 0  auto !IMPORTANT ; bad ; --x: { a } ",
        ),
      ),
    ).toBe("color: red; Margin: 0 auto !important; --x: { a };");
  });
});

describe("round trip over css-parsing-tests", () => {
  it.each([
    ...inputs(componentValueList),
    ...inputs(oneComponentValue),
    ...inputs(declarationList),
    ...inputs(stylesheet),
  ])("%j", (input) => {
    const parsed = Syntax.parseComponentValueList(input);
    const reparsed = Syntax.parseComponentValueList(Serialize.componentValues(parsed));
    expect(terminated(reparsed)).toStrictEqual(terminated(parsed));
  });

  it.each(inputs(declarationList))("declaration list %j", (input) => {
    // The suite's parser edition keeps the whitespace around a value; the serialiser trims it.
    const declarations = (css: string) =>
      Syntax.parseDeclarationList(css).flatMap((one) =>
        Predicate.isTagged(one, "Declaration")
          ? [{ ...one, value: terminated(trim(one.value)) }]
          : [],
      );
    const parsed = declarations(input);
    const reparsed = declarations(Serialize.declarationList(Syntax.parseDeclarationList(input)));
    expect(reparsed).toStrictEqual(parsed);
  });
});
