/**
 * `<color>` specified-value serialisation against web-platform-tests'
 * valid vectors (`css/css-color/parsing`, BSD-3-Clause; see
 * `fixtures/README.md`), in today's CSS Color 4 / 5 edition.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import { Color } from "@thomasfosterau/effect-css";
import vectors from "./fixtures/wpt-color-valid.json" with { type: "json" };

/** A vector: the input, its expected specified value and the tolerance it gives, if any. */
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

/**
 * Vectors this parser does not cover: `calc()` (and the `infinity` / `NaN`
 * it can produce) needs the math functions, which `Color` does not parse.
 */
const unsupported = ({ input, expected }: Vector): boolean =>
  /calc\(|var\(/u.test(input + expected);

const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/giu;

/** WPT's fuzzy colour comparison: the same text, every number within `epsilon`. */
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

/**
 * The vectors each file has once the unsupported ones are set aside, all
 * of which pass; a change that drops one fails here.
 */
const COUNTS: Readonly<Record<string, number>> = {
  "color-valid-color-function": 250,
  "color-valid-hsl": 35,
  "color-valid-hwb": 28,
  "color-valid-lab": 96,
  "color-valid-rgb": 32,
  "color-valid": 17,
};

describe.each(Record.toEntries(vectors))("WPT %s", (file, entries) => {
  const valid = entries.map(toVector).filter((vector) => !unsupported(vector));

  it("covers every vector without calc()", () => {
    expect(valid.length).toBe(COUNTS[file]);
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
