/**
 * `color-mix()` parsing and specified-value serialisation against the
 * web-platform-tests vectors (`css/css-color/parsing`, BSD-3-Clause; see
 * `fixtures/README.md`).
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { Color } from "@thomasfosterau/effect-css";
import vectors from "./fixtures/wpt-color-mix.json" with { type: "json" };

/**
 * Vectors this parser does not cover, by reason:
 *
 * - `calc()` and `var()` as a percentage need the math functions and
 *   custom properties, which `Color` does not parse.
 * - `hsl()` and `hwb()` serialise as `rgb()` (the 2021 edition the
 *   package's colour serialisation follows, a `none` channel as 0), so a
 *   specified value that keeps one, `none` and all, is not written back.
 * - The css-parsing-tests suite this package follows pins `lab()`-family
 *   lightness unclamped (`oklab(100 …)` stays 100), where WPT clamps it.
 * - That suite also pins `rgb()` channels with their decimals
 *   (`rgb(45.9, 56.1, 45.9)`); WPT rounds them to integers, which only the
 *   two vectors with no tolerance tell apart.
 */
const unsupported = ({ input, expected, epsilon }: Vector): boolean =>
  /calc\(|var\(/u.test(input) ||
  /(?:hsl|hwb)\(/u.test(expected) ||
  /oklab\(100 |oklch\(100 /u.test(input) ||
  (Option.isNone(epsilon) &&
    /rgb\(\d+, \d+, \d+\)/u.test(expected) &&
    /(?:hsl|hwb)\(/u.test(input));

/** A `valid` entry: the input, its expected specified value and the tolerance it gives, if any. */
interface Vector {
  readonly input: string;
  readonly expected: string;
  readonly epsilon: Option.Option<number>;
}

const toVector = (entry: ReadonlyArray<string | number | null>): Vector => {
  const [input, expected, epsilon] = entry;
  return {
    input: String(input),
    expected: String(expected),
    epsilon: Predicate.isNumber(epsilon) ? Option.some(epsilon) : Option.none(),
  };
};

/** Named colours in `expected`, written the way `Color.serialize` writes them (it resolves names). */
const resolveNames = (expected: string): string =>
  expected.replace(/(?<=[(,]\s*)([a-z]+)(?=\s*(?:\d+(?:\.\d+)?%\s*)?[,)])/gu, (name) =>
    Option.getOrElse(Option.map(Color.parse(name), Color.serialize), () => name),
  );

const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/giu;

/** `actual` matches `expected` with every number within `epsilon`. */
const fuzzyEqual = (actual: string, expected: string, epsilon: number): boolean => {
  const actualNumbers = actual.match(NUMBER) ?? [];
  const expectedNumbers = expected.match(NUMBER) ?? [];
  return (
    actual.replace(NUMBER, "#") === expected.replace(NUMBER, "#") &&
    actualNumbers.length === expectedNumbers.length &&
    actualNumbers.every(
      (one, index) => Math.abs(Number(one) - Number(expectedNumbers[index])) <= epsilon,
    )
  );
};

const valid = vectors.valid.map(toVector).filter((vector) => !unsupported(vector));

/** The vectors left once the unsupported ones are set aside; a change that drops one fails here. */
const VALID_COUNT = 644;

describe("WPT color-valid-color-mix-function", () => {
  it("covers the vectors that need no math functions", () => {
    expect(valid.length).toBe(VALID_COUNT);
  });

  it.each(valid)("$input", ({ input, expected, epsilon }) => {
    const actual = Option.getOrElse(
      Option.map(Color.parse(input), Color.serialize),
      () => "(none)",
    );
    const resolved = resolveNames(expected);
    // WPT's fuzzy_test_valid_color tolerance: 0.01 unless the vector gives one.
    expect(
      fuzzyEqual(
        actual,
        resolved,
        Option.getOrElse(epsilon, () => 0.01),
      ),
      `${actual} ≈ ${resolved}`,
    ).toBe(true);
  });
});

describe("WPT color-invalid-color-mix-function", () => {
  it.each(vectors.invalid)("%s", (input) => {
    expect(Color.parse(input)).toStrictEqual(Option.none());
  });
});

describe("Color.parse color-mix()", () => {
  it("keeps the method and the colours as written", () => {
    expect(Color.parse("color-mix(in lch longer hue, red 30%, blue)")).toStrictEqual(
      Option.some({
        _tag: "ColorMix",
        space: "lch",
        hue: "longer",
        colors: [
          {
            color: { _tag: "Rgb", red: 255, green: 0, blue: 0, alpha: 1 },
            percentage: Option.some(30),
          },
          {
            color: { _tag: "Rgb", red: 0, green: 0, blue: 255, alpha: 1 },
            percentage: Option.none(),
          },
        ],
      }),
    );
  });

  it("defaults to oklab and leaves the default method out", () => {
    expect(Option.map(Color.parse("color-mix(red, blue)"), Color.serialize)).toStrictEqual(
      Option.some("color-mix(rgb(255, 0, 0), rgb(0, 0, 255))"),
    );
  });

  it("reads xyz as xyz-d65 and nests mixes", () => {
    expect(
      Option.map(
        Color.parse("color-mix(in xyz, color-mix(in srgb, red, blue) 20%, white)"),
        Color.serialize,
      ),
    ).toStrictEqual(
      Option.some(
        "color-mix(in xyz-d65, color-mix(in srgb, rgb(255, 0, 0), rgb(0, 0, 255)) 20%, rgb(255, 255, 255) 80%)",
      ),
    );
  });

  it("does not resolve a mix to sRGB", () => {
    expect(
      Option.flatMap(Color.parse("color-mix(in srgb, red, blue)"), Color.toSrgb),
    ).toStrictEqual(Option.none());
  });
});
