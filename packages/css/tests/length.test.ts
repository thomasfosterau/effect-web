/**
 * `calc()` in lengths (CSS Values 4 §10): parsing, type checking,
 * simplification into one term per unit, and serialisation.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { Length } from "@thomasfosterau/effect-css";

const sum = (input: string): Option.Option<string> =>
  Option.map(Length.parseSum(input), Length.serializeSum);

describe("Length.parseSum", () => {
  it.each([
    ["calc(1in + 10px)", "106px"],
    ["calc(10px * 2)", "20px"],
    ["calc(2 * 10px)", "20px"],
    ["calc(10px / 4)", "2.5px"],
    ["calc(1em + 1em)", "2em"],
    ["calc(50% - 1em)", "calc(50% - 1em)"],
    ["CALC(1EM + 2PX + 3%)", "calc(3% + 1em + 2px)"],
    ["calc(100% - (2em + 4pt) * 2)", "calc(100% - 4em - 10.666667px)"],
    ["calc(calc(1px + 1px) * 3)", "6px"],
    ["calc((((5px))))", "5px"],
    ["calc(10px - 10px)", "0px"],
    ["calc(  1px  +  2px  )", "3px"],
    ["calc(1px - -1px)", "2px"],
    ["12pt", "12pt"],
    ["50%", "50%"],
    ["0", "0px"],
  ])("%s → %s", (input, expected) => {
    expect(sum(input)).toStrictEqual(Option.some(expected));
  });

  it.each([
    "calc(1px + 2)", // a number added to a length
    "calc(2)", // a bare number
    "calc(1px * 2px)", // a length times a length
    "calc(1px / 0)", // division by zero
    "calc(2 / 1px)", // division by a length
    "calc(1px +2px)", // `+` without whitespace on both sides
    "calc(1px+2px)",
    "calc(1px 2px)", // two operands side by side
    "calc()",
    "calc(1px +)",
    "calc(1deg + 1px)", // not a length unit
    "calc(1px, 2px)",
    "min(1px, 2px)", // another math function
    "12deg",
  ])("rejects %s", (input) => {
    expect(Length.parseSum(input)).toStrictEqual(Option.none());
  });
});

describe("Length.parse with calc()", () => {
  it("takes a calc() that simplifies to one unit, in px for absolute units", () => {
    expect(Length.parse("calc(1in + 10px)")).toStrictEqual(Option.some({ value: 106, unit: "px" }));
    expect(Length.parse("calc(3em / 2)")).toStrictEqual(Option.some({ value: 1.5, unit: "em" }));
  });

  it("rejects a calc() that keeps more than one unit", () => {
    expect(Length.parse("calc(50% - 1em)")).toStrictEqual(Option.none());
  });
});

describe("Length.serializeSum", () => {
  it("writes an empty sum as 0px and negative terms with a minus", () => {
    expect(Length.serializeSum([])).toBe("0px");
    expect(Length.serializeSum([{ value: -2, unit: "px" }])).toBe("-2px");
    expect(
      Length.serializeSum([
        { value: 10, unit: "%" },
        { value: -0.5, unit: "em" },
      ]),
    ).toBe("calc(10% - 0.5em)");
  });
});
