/**
 * CSS Color 4 parsing and serialisation against the css-parsing-tests
 * colour vectors (CC0), plus `rgb()` (which the suite does not cover),
 * `currentcolor` and the conversion to sRGB.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { Color, Length, Syntax } from "@thomasfosterau/effect-css";
import colorFunction from "./fixtures/css-parsing-tests/color_function_4.json" with { type: "json" };
import hex3 from "./fixtures/css-parsing-tests/color_hexadecimal_3.json" with { type: "json" };
import hex4 from "./fixtures/css-parsing-tests/color_hexadecimal_4.json" with { type: "json" };
import hsl3 from "./fixtures/css-parsing-tests/color_hsl_3.json" with { type: "json" };
import hsl4 from "./fixtures/css-parsing-tests/color_hsl_4.json" with { type: "json" };
import hwb4 from "./fixtures/css-parsing-tests/color_hwb_4.json" with { type: "json" };
import keywords3 from "./fixtures/css-parsing-tests/color_keywords_3.json" with { type: "json" };
import keywords4 from "./fixtures/css-parsing-tests/color_keywords_4.json" with { type: "json" };
import lab4 from "./fixtures/css-parsing-tests/color_lab_4.json" with { type: "json" };
import lch4 from "./fixtures/css-parsing-tests/color_lch_4.json" with { type: "json" };
import oklab4 from "./fixtures/css-parsing-tests/color_oklab_4.json" with { type: "json" };
import oklch4 from "./fixtures/css-parsing-tests/color_oklch_4.json" with { type: "json" };

/** The suite's alternating input / expected pairs. */
const pairs = (
  fixture: ReadonlyArray<string | null>,
): ReadonlyArray<readonly [string, string | null]> =>
  fixture.flatMap((input, index) =>
    index % 2 === 0 && input !== null ? [[input, fixture[index + 1] ?? null] as const] : [],
  );

const serialized = (input: string): string | null =>
  Option.getOrNull(Option.map(Color.parse(input), Color.serialize));

describe("css-parsing-tests colour vectors", () => {
  it.each([
    ["color_hexadecimal_3", hex3],
    ["color_hexadecimal_4", hex4],
    ["color_keywords_3", keywords3],
    ["color_keywords_4", keywords4],
    ["color_hsl_3", hsl3],
    ["color_hsl_4", hsl4],
    ["color_hwb_4", hwb4],
    ["color_lab_4", lab4],
    ["color_lch_4", lch4],
    ["color_oklab_4", oklab4],
    ["color_oklch_4", oklch4],
    ["color_function_4", colorFunction],
  ] as const)("%s", (_, fixture) => {
    const cases = pairs(fixture);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.map(([input]) => [input, serialized(input)])).toEqual(cases);
  });
});

describe("rgb()", () => {
  it.each([
    ["rgb(255, 0, 0)", "rgb(255, 0, 0)"],
    ["rgba(100%, 50%, 0%, 0.5)", "rgba(255, 127.5, 0, 0.5)"],
    ["RGB(1 2 3 / 25%)", "rgba(1, 2, 3, 0.25)"],
    ["rgb(10% 20 none)", "rgb(25.5, 20, 0)"],
    ["rgb(300 -5 0)", "rgb(255, 0, 0)"],
  ])("%s → %s", (input, expected) => {
    expect(serialized(input)).toBe(expected);
  });

  it.each(["rgb(255, 0%, 0)", "rgb(1, 2)", "rgb(1 2 3 4)", "rgb(none, 0, 0)", "rgb(1, 2, 3 / 1)"])(
    "rejects %s",
    (input) => {
      expect(serialized(input)).toBeNull();
    },
  );
});

describe("keywords and component values", () => {
  it("parses currentcolor in any case, and serialises it lower-case", () => {
    expect(serialized("CurrentColor")).toBe("currentcolor");
  });

  it("parses a component value already produced by Syntax", () => {
    const [declaration] = Syntax.parseDeclarationList("color: #f00");
    const value = Predicate.isTagged(declaration, "Declaration")
      ? declaration.value.find((v) => !Predicate.isTagged(v, "Whitespace"))
      : undefined;
    expect(
      Option.map(Option.flatMap(Option.fromNullishOr(value), Color.parse), Color.serialize),
    ).toStrictEqual(Option.some("rgb(255, 0, 0)"));
  });
});

describe("toSrgb", () => {
  const srgb = (input: string) =>
    Option.map(Option.flatMap(Color.parse(input), Color.toSrgb), ({ red, green, blue, alpha }) => [
      Math.round(red * 100) / 100 + 0,
      Math.round(green * 100) / 100 + 0,
      Math.round(blue * 100) / 100 + 0,
      alpha,
    ]);

  it.each([
    ["red", [1, 0, 0, 1]],
    ["lab(54.29 80.82 69.89)", [1, 0, 0, 1]],
    ["lch(54.29 106.84 40.85)", [1, 0, 0, 1]],
    ["oklab(0.62796 0.22486 0.12585 / 0.5)", [1, 0, 0, 0.5]],
    ["oklch(0.62796 0.25768 29.234)", [1, 0, 0, 1]],
    ["color(srgb 0 0.5 1)", [0, 0.5, 1, 1]],
    ["color(srgb-linear 0.21404 0.21404 0.21404)", [0.5, 0.5, 0.5, 1]],
    ["color(xyz-d65 0.95046 1 1.08906)", [1, 1, 1, 1]],
    ["color(xyz-d50 0.96422 1 0.82521)", [1, 1, 1, 1]],
    ["color(display-p3 1 1 1)", [1, 1, 1, 1]],
    ["color(display-p3 1 0 0)", [1.09, -0.23, -0.15, 1]],
    ["color(a98-rgb 1 1 1)", [1, 1, 1, 1]],
    ["color(prophoto-rgb 1 1 1)", [1, 1, 1, 1]],
    ["color(rec2020 1 1 1)", [1, 1, 1, 1]],
  ])("%s", (input, expected) => {
    expect(srgb(input)).toStrictEqual(Option.some(expected));
  });

  it("has no sRGB value for currentcolor", () => {
    expect(srgb("currentcolor")).toStrictEqual(Option.none());
  });
});

describe("Length", () => {
  it("parses length units case-insensitively, percentages and a unitless zero", () => {
    expect(Length.parse("12PT")).toStrictEqual(Option.some({ value: 12, unit: "pt" }));
    expect(Length.parse("1.5rem")).toStrictEqual(Option.some({ value: 1.5, unit: "rem" }));
    expect(Length.parse("50%")).toStrictEqual(Option.some({ value: 50, unit: "%" }));
    expect(Length.parse("0")).toStrictEqual(Option.some({ value: 0, unit: "px" }));
  });

  it("rejects other values", () => {
    expect(Length.parse("12")).toStrictEqual(Option.none());
    expect(Length.parse("12deg")).toStrictEqual(Option.none());
    expect(Length.parse("12px 3px")).toStrictEqual(Option.none());
  });

  it("converts between absolute units, and not relative ones", () => {
    expect(Length.toPixels({ value: 1, unit: "in" })).toStrictEqual(Option.some(96));
    expect(Length.toPixels({ value: 12, unit: "pt" })).toStrictEqual(Option.some(16));
    expect(Length.toPixels({ value: 6, unit: "pc" })).toStrictEqual(Option.some(96));
    expect(
      Option.map(
        Length.convert({ value: 25.4, unit: "mm" }, "in"),
        (length) => Math.round(length.value * 1e9) / 1e9,
      ),
    ).toStrictEqual(Option.some(1));
    expect(
      Option.map(
        Length.convert({ value: 40, unit: "q" }, "cm"),
        (length) => Math.round(length.value * 1e9) / 1e9,
      ),
    ).toStrictEqual(Option.some(1));
    expect(Length.toPixels({ value: 2, unit: "em" })).toStrictEqual(Option.none());
    expect(Length.convert({ value: 50, unit: "%" }, "px")).toStrictEqual(Option.none());
    expect(Length.serialize({ value: 1.5, unit: "em" })).toBe("1.5em");
  });
});
