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
 * Vectors this parser does not cover: `calc()` and `var()` as a
 * percentage need the math functions and custom properties, which `Color`
 * does not parse.
 */
const unsupported = ({ input }: Vector): boolean => /calc\(|var\(/u.test(input);

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
const VALID_COUNT = 669;

describe("WPT color-valid-color-mix-function", () => {
  it("covers the vectors that need no math functions", () => {
    expect(valid.length).toBe(VALID_COUNT);
  });

  it.each(valid)("$input", ({ input, expected, epsilon }) => {
    const actual = Option.getOrElse(
      Option.map(Color.parse(input), Color.serialize),
      () => "(none)",
    );
    // WPT's fuzzy_test_valid_color tolerance: 0.01 unless the vector gives one.
    expect(
      fuzzyEqual(
        actual,
        expected,
        Option.getOrElse(epsilon, () => 0.01),
      ),
      `${actual} ≈ ${expected}`,
    ).toBe(true);
  });
});

const computed = vectors.computed.map(toVector).filter((vector) => !unsupported(vector));

/** The computed vectors left once the unsupported ones are set aside, all of which pass. */
const COMPUTED_COUNT = 966;

describe("WPT color-computed-color-mix-function", () => {
  it("covers the vectors that need no math functions", () => {
    expect(computed.length).toBe(COMPUTED_COUNT);
  });

  it.each(computed)("$input", ({ input, expected, epsilon }) => {
    const actual = Option.getOrElse(
      Option.map(Option.flatMap(Color.parse(input), Color.resolve), Color.serialize),
      () => "(none)",
    );
    // WPT's fuzzy_test_computed_color tolerance: 0.01 unless the vector gives one.
    expect(
      fuzzyEqual(
        actual,
        expected,
        Option.getOrElse(epsilon, () => 0.01),
      ),
      `${actual} ≈ ${expected}`,
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
            color: { _tag: "Named", name: "red", red: 255, green: 0, blue: 0, alpha: 1 },
            percentage: Option.some(30),
          },
          {
            color: { _tag: "Named", name: "blue", red: 0, green: 0, blue: 255, alpha: 1 },
            percentage: Option.none(),
          },
        ],
      }),
    );
  });

  it("defaults to oklab and leaves the default method out", () => {
    expect(Option.map(Color.parse("color-mix(red, blue)"), Color.serialize)).toStrictEqual(
      Option.some("color-mix(red, blue)"),
    );
  });

  it("reads xyz as xyz-d65 and nests mixes", () => {
    expect(
      Option.map(
        Color.parse("color-mix(in xyz, color-mix(in srgb, red, blue) 20%, white)"),
        Color.serialize,
      ),
    ).toStrictEqual(
      Option.some("color-mix(in xyz-d65, color-mix(in srgb, red, blue) 20%, white 80%)"),
    );
  });

  it("converts a mix to sRGB through its resolved colour", () => {
    expect(
      Option.map(
        Option.flatMap(Color.parse("color-mix(in srgb, red, blue)"), Color.toSrgb),
        ({ red, green, blue, alpha }) =>
          [red, green, blue, alpha].map((channel) => Math.round(channel * 1e6) / 1e6 + 0),
      ),
    ).toStrictEqual(Option.some([0.5, 0, 0.5, 1]));
  });

  it("has no resolved colour when a colour in the mix has no value of its own", () => {
    expect(
      Option.flatMap(Color.parse("color-mix(in srgb, currentcolor, blue)"), Color.resolve),
    ).toStrictEqual(Option.none());
    expect(Option.flatMap(Color.parse("red"), Color.resolve)).toStrictEqual(Color.parse("red"));
  });
});
