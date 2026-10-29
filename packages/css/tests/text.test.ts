import { Color, Text } from "@thomasfosterau/effect-css";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

describe("Text.parseAlign", () => {
  it.each(["start", "end", "left", "right", "center", "justify", "match-parent", "justify-all"])(
    "parses %j",
    (input) => {
      expect(Text.parseAlign(input.toUpperCase())).toStrictEqual(Option.some(input));
    },
  );

  it.each(["middle", "left right", "", "10px"])("rejects %j", (input) => {
    expect(Text.parseAlign(input)).toStrictEqual(Option.none());
  });
});

describe("Text.parseVerticalAlign", () => {
  it("parses a keyword", () => {
    expect(Text.parseVerticalAlign("Text-Top")).toStrictEqual(
      Option.some({ _tag: "Keyword", keyword: "text-top" }),
    );
  });

  it("parses a negative length and a percentage", () => {
    expect(Text.parseVerticalAlign("-2px")).toStrictEqual(
      Option.some({ _tag: "Length", length: { value: -2, unit: "px" } }),
    );
    expect(Text.parseVerticalAlign("50%")).toStrictEqual(
      Option.some({ _tag: "Length", length: { value: 50, unit: "%" } }),
    );
  });

  it.each(["center", "top bottom", "", "3"])("rejects %j", (input) => {
    expect(Text.parseVerticalAlign(input)).toStrictEqual(Option.none());
  });
});

describe("Text.parseDecorationLine", () => {
  it.each([
    ["none", []],
    ["underline", ["underline"]],
    ["Line-Through underline blink", ["line-through", "underline", "blink"]],
  ] as const)("parses %j", (input, line) => {
    expect(Text.parseDecorationLine(input)).toStrictEqual(Option.some(line));
  });

  it.each(["", "none underline", "underline underline", "wavy"])("rejects %j", (input) => {
    expect(Text.parseDecorationLine(input)).toStrictEqual(Option.none());
  });
});

describe("Text.parseDecorationStyle", () => {
  it.each(["solid", "double", "dotted", "dashed", "wavy"])("parses %j", (input) => {
    expect(Text.parseDecorationStyle(input)).toStrictEqual(Option.some(input));
  });

  it.each(["groove", "solid wavy"])("rejects %j", (input) => {
    expect(Text.parseDecorationStyle(input)).toStrictEqual(Option.none());
  });
});

describe("Text.parseDecorationThickness", () => {
  it.each([
    ["auto", { _tag: "Auto" }],
    ["From-Font", { _tag: "FromFont" }],
    ["0.1em", { _tag: "Length", length: { value: 0.1, unit: "em" } }],
    ["10%", { _tag: "Length", length: { value: 10, unit: "%" } }],
  ] as const)("parses %j", (input, thickness) => {
    expect(Text.parseDecorationThickness(input)).toStrictEqual(Option.some(thickness));
  });

  it.each(["thick", "1px 2px", ""])("rejects %j", (input) => {
    expect(Text.parseDecorationThickness(input)).toStrictEqual(Option.none());
  });
});

describe("Text.parseDecoration", () => {
  it("defaults every omitted longhand", () => {
    expect(Text.parseDecoration("underline")).toStrictEqual(
      Option.some({
        line: ["underline"],
        style: "solid",
        color: Option.none(),
        thickness: { _tag: "Auto" },
      }),
    );
    expect(Text.parseDecoration("none")).toStrictEqual(
      Option.some({ line: [], style: "solid", color: Option.none(), thickness: { _tag: "Auto" } }),
    );
  });

  it("parses every longhand in any order", () => {
    expect(Text.parseDecoration("2px red wavy underline overline")).toStrictEqual(
      Option.some({
        line: ["underline", "overline"],
        style: "wavy",
        color: Color.parse("red"),
        thickness: { _tag: "Length", length: { value: 2, unit: "px" } },
      }),
    );
  });

  it("reads currentcolor as the initial colour", () => {
    expect(Text.parseDecoration("dotted currentColor")).toStrictEqual(
      Option.some({ line: [], style: "dotted", color: Option.none(), thickness: { _tag: "Auto" } }),
    );
  });

  it.each([
    "",
    "none underline",
    "underline none",
    "solid dashed",
    "red blue",
    "1px 2px",
    "currentcolor red",
    "underline sparkly",
  ])("rejects %j", (input) => {
    expect(Text.parseDecoration(input)).toStrictEqual(Option.none());
  });
});
