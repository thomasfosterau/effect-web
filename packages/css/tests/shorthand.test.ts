/**
 * The box shorthands expanded to their longhands: the 1 to 4 values rule,
 * `border` and its sides in any order with initial values for what is
 * left out, CSS-wide keywords, `!important`, and what is refused.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { Shorthand, Syntax, Token } from "@thomasfosterau/effect-css";

/** Serialise one component value back to text, for comparison. */
const textOf = (value: Token.ComponentValue): string => {
  if (Predicate.isTagged(value, "Ident")) return value.value;
  if (Predicate.isTagged(value, "Dimension")) return `${value.representation}${value.unit}`;
  if (Predicate.isTagged(value, "Number")) return value.representation;
  if (Predicate.isTagged(value, "Percentage")) return `${value.representation}%`;
  if (Predicate.isTagged(value, "Hash")) return `#${value.value}`;
  if (Predicate.isTagged(value, "Func")) return `${value.name}(…)`;
  return value._tag;
};

/** Serialise a value's component values back to text, for comparison. */
const text = (values: ReadonlyArray<Token.ComponentValue>): string => values.map(textOf).join(" ");

/** Expand the one declaration in `css` to `name: value[!]` strings, or `None`. */
const expanded = (css: string): Option.Option<ReadonlyArray<string>> => {
  const [declaration] = Syntax.parseDeclarationList(css);
  if (!Predicate.isTagged(declaration, "Declaration")) return Option.none();
  return Option.map(Shorthand.expand(declaration), (longhands) =>
    longhands.map((one) => `${one.name}: ${text(one.value)}${one.important ? "!" : ""}`),
  );
};

describe("the 1 to 4 values rule", () => {
  it.each([
    [
      "margin: 1px",
      ["margin-top: 1px", "margin-right: 1px", "margin-bottom: 1px", "margin-left: 1px"],
    ],
    [
      "margin: 1px 2px",
      ["margin-top: 1px", "margin-right: 2px", "margin-bottom: 1px", "margin-left: 2px"],
    ],
    [
      "margin: 1px 2px 3px",
      ["margin-top: 1px", "margin-right: 2px", "margin-bottom: 3px", "margin-left: 2px"],
    ],
    [
      "MARGIN: 1px auto 3% 0",
      ["margin-top: 1px", "margin-right: auto", "margin-bottom: 3%", "margin-left: 0"],
    ],
    [
      "padding: 1em 2em",
      ["padding-top: 1em", "padding-right: 2em", "padding-bottom: 1em", "padding-left: 2em"],
    ],
    ["inset: 0 auto", ["top: 0", "right: auto", "bottom: 0", "left: auto"]],
    [
      "border-width: thin 2px",
      [
        "border-top-width: thin",
        "border-right-width: 2px",
        "border-bottom-width: thin",
        "border-left-width: 2px",
      ],
    ],
    [
      "border-color: red #00f green",
      [
        "border-top-color: red",
        "border-right-color: #00f",
        "border-bottom-color: green",
        "border-left-color: #00f",
      ],
    ],
  ])("%s", (css, longhands) => {
    expect(expanded(css)).toStrictEqual(Option.some(longhands));
  });
});

describe("border", () => {
  it("takes width, style and colour in any order, omitted ones at their initial value", () => {
    expect(expanded("border-top: red 2px")).toStrictEqual(
      Option.some(["border-top-width: 2px", "border-top-style: none", "border-top-color: red"]),
    );
    expect(Option.map(expanded("border: dashed"), (all) => all.length)).toStrictEqual(
      Option.some(12),
    );
    expect(
      Option.map(expanded("border: 1px solid rgb(0 0 0)"), (all) => all.slice(0, 3)),
    ).toStrictEqual(
      Option.some(["border-top-width: 1px", "border-top-style: solid", "border-top-color: rgb(…)"]),
    );
  });

  it("refuses a repeated part, a percentage width or an unknown value", () => {
    expect(expanded("border: solid dashed")).toStrictEqual(Option.none());
    expect(expanded("border: 10%")).toStrictEqual(Option.none());
    expect(expanded("border: 1px solid red blue")).toStrictEqual(Option.none());
    expect(expanded("border: wiggly")).toStrictEqual(Option.none());
  });
});

describe("expand", () => {
  it("keeps !important on every longhand", () => {
    expect(expanded("padding: 0 !important")).toStrictEqual(
      Option.some([
        "padding-top: 0!",
        "padding-right: 0!",
        "padding-bottom: 0!",
        "padding-left: 0!",
      ]),
    );
  });

  it("passes a CSS-wide keyword to every longhand", () => {
    expect(Option.map(expanded("border: inherit"), (all) => [all.length, all[0]])).toStrictEqual(
      Option.some([12, "border-top-width: inherit"]),
    );
  });

  it("refuses var(), bad values, too many values and a non-shorthand", () => {
    expect(expanded("margin: var(--gap)")).toStrictEqual(Option.none());
    expect(expanded("padding: auto")).toStrictEqual(Option.none());
    expect(expanded("margin: 1px 2px 3px 4px 5px")).toStrictEqual(Option.none());
    expect(expanded("margin:")).toStrictEqual(Option.none());
    expect(expanded("color: red")).toStrictEqual(Option.none());
  });

  it("knows its shorthands", () => {
    expect(Shorthand.isShorthand("Border-Left")).toBe(true);
    expect(Shorthand.isShorthand("border-left-width")).toBe(false);
  });
});
