import { Font } from "@thomasfosterau/effect-css";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

describe("Font.parseFamily", () => {
  it("parses quoted, unquoted and generic names", () => {
    expect(Font.parseFamily('"Helvetica Neue", Times  New Roman, SERIF')).toStrictEqual(
      Option.some([
        { _tag: "Family", name: "Helvetica Neue" },
        { _tag: "Family", name: "Times New Roman" },
        { _tag: "Generic", name: "serif" },
      ]),
    );
  });

  it("treats a quoted generic keyword as a family name", () => {
    expect(Font.parseFamily('"serif"')).toStrictEqual(
      Option.some([{ _tag: "Family", name: "serif" }]),
    );
  });

  it.each(["", "Arial,", ", serif", "serif Sans", "inherit Foo", "12px", "default"])(
    "rejects %j",
    (input) => {
      expect(Font.parseFamily(input)).toStrictEqual(Option.none());
    },
  );
});

describe("Font.parseWeight", () => {
  it.each([
    ["normal", 400],
    ["BOLD", 700],
    ["bolder", "bolder"],
    ["lighter", "lighter"],
    ["1", 1],
    ["1000", 1000],
    ["350.5", 350.5],
  ] as const)("parses %j", (input, weight) => {
    expect(Font.parseWeight(input)).toStrictEqual(Option.some(weight));
  });

  it.each(["0", "1001", "-1", "heavy", "400 700", "400px"])("rejects %j", (input) => {
    expect(Font.parseWeight(input)).toStrictEqual(Option.none());
  });
});

describe("Font.parseStyle", () => {
  it.each([
    ["normal", { _tag: "Normal" }],
    ["Italic", { _tag: "Italic" }],
    ["oblique", { _tag: "Oblique", angle: 14 }],
    ["oblique -20deg", { _tag: "Oblique", angle: -20 }],
    ["oblique 0.25turn", { _tag: "Oblique", angle: 90 }],
  ] as const)("parses %j", (input, style) => {
    expect(Font.parseStyle(input)).toStrictEqual(Option.some(style));
  });

  it.each(["oblique 91deg", "oblique 10px", "italic 10deg", "slanted", "oblique 10deg 5deg", ""])(
    "rejects %j",
    (input) => {
      expect(Font.parseStyle(input)).toStrictEqual(Option.none());
    },
  );
});

describe("Font.parseSize", () => {
  it.each([
    ["medium", { _tag: "Keyword", keyword: "medium" }],
    ["XXX-Large", { _tag: "Keyword", keyword: "xxx-large" }],
    ["smaller", { _tag: "Keyword", keyword: "smaller" }],
    ["math", { _tag: "Keyword", keyword: "math" }],
    ["12pt", { _tag: "Length", length: { value: 12, unit: "pt" } }],
    ["150%", { _tag: "Length", length: { value: 150, unit: "%" } }],
    ["0", { _tag: "Length", length: { value: 0, unit: "px" } }],
  ] as const)("parses %j", (input, size) => {
    expect(Font.parseSize(input)).toStrictEqual(Option.some(size));
  });

  it.each(["-1px", "12", "huge", "12px 14px"])("rejects %j", (input) => {
    expect(Font.parseSize(input)).toStrictEqual(Option.none());
  });
});

describe("Font.parseLineHeight", () => {
  it.each([
    ["normal", { _tag: "Normal" }],
    ["1.5", { _tag: "Number", value: 1.5 }],
    ["0", { _tag: "Number", value: 0 }],
    ["20px", { _tag: "Length", length: { value: 20, unit: "px" } }],
    ["120%", { _tag: "Length", length: { value: 120, unit: "%" } }],
  ] as const)("parses %j", (input, lineHeight) => {
    expect(Font.parseLineHeight(input)).toStrictEqual(Option.some(lineHeight));
  });

  it.each(["-1", "-2px", "auto"])("rejects %j", (input) => {
    expect(Font.parseLineHeight(input)).toStrictEqual(Option.none());
  });
});

const defaults = {
  _tag: "Font",
  style: { _tag: "Normal" },
  variant: "normal",
  weight: 400,
  width: "normal",
  lineHeight: { _tag: "Normal" },
} as const;

describe("Font.parse", () => {
  it("parses size and family alone, defaulting the rest", () => {
    expect(Font.parse("12px serif")).toStrictEqual(
      Option.some({
        ...defaults,
        size: { _tag: "Length", length: { value: 12, unit: "px" } },
        family: [{ _tag: "Generic", name: "serif" }],
      }),
    );
  });

  it("parses every part, in any leading order", () => {
    expect(
      Font.parse('bold condensed small-caps italic large/1.2 "Fira Sans", sans-serif'),
    ).toStrictEqual(
      Option.some({
        _tag: "Font",
        style: { _tag: "Italic" },
        variant: "small-caps",
        weight: 700,
        width: "condensed",
        size: { _tag: "Keyword", keyword: "large" },
        lineHeight: { _tag: "Number", value: 1.2 },
        family: [
          { _tag: "Family", name: "Fira Sans" },
          { _tag: "Generic", name: "sans-serif" },
        ],
      }),
    );
  });

  it("takes an oblique angle and a numeric weight", () => {
    expect(Font.parse("oblique 10deg 300 1em / 20px Georgia")).toStrictEqual(
      Option.some({
        ...defaults,
        style: { _tag: "Oblique", angle: 10 },
        weight: 300,
        size: { _tag: "Length", length: { value: 1, unit: "em" } },
        lineHeight: { _tag: "Length", length: { value: 20, unit: "px" } },
        family: [{ _tag: "Family", name: "Georgia" }],
      }),
    );
  });

  it("lets normal stand for any leading part", () => {
    expect(Font.parse("normal normal italic 0 a")).toStrictEqual(
      Option.some({
        ...defaults,
        style: { _tag: "Italic" },
        size: { _tag: "Length", length: { value: 0, unit: "px" } },
        family: [{ _tag: "Family", name: "a" }],
      }),
    );
  });

  it.each(["menu", "Status-Bar"])("parses the system font %j", (input) => {
    expect(Font.parse(input)).toStrictEqual(
      Option.some({ _tag: "SystemFont", name: input.toLowerCase() }),
    );
  });

  it.each([
    "serif",
    "12px",
    "bold bold 12px serif",
    "italic oblique 12px serif",
    "normal normal normal normal normal 12px serif",
    "12px/ serif",
    "12px/normal",
    "12px serif,",
    "menu 12px serif",
    "12px inherit",
    "heavy 12px serif",
  ])("rejects %j", (input) => {
    expect(Font.parse(input)).toStrictEqual(Option.none());
  });
});
