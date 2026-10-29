/**
 * `color-mix()` resolution (CSS Color 5 §3.2, CSS Color 4 §12): convert
 * each colour into the interpolation space, carrying missing (`none`)
 * components forward to their analogues, and interpolate with
 * premultiplied alpha and the hue method, two colours at a time.
 */
import * as Option from "effect/Option";
import { CONVERSIONS, type Space, type Vector } from "./spaces.ts";

/** A channel, or `none` (a missing component). */
export type Channel = number | "none";

/** A colour in one of the interpolation spaces. */
export interface Working {
  readonly space: Space;
  readonly channels: readonly [Channel, Channel, Channel];
  readonly alpha: Channel;
}

/** How hues interpolate (CSS Color 4 §12.4). */
export type HueMethod = "shorter" | "longer" | "increasing" | "decreasing";

/** The analogous-component categories of CSS Color 4 §12.2, per channel. */
type Category =
  | "red"
  | "green"
  | "blue"
  | "lightness"
  | "colorfulness"
  | "hue"
  | "opponent-a"
  | "opponent-b"
  | "x"
  | "y"
  | "z"
  | "whiteness"
  | "blackness";

type Categories = readonly [Category, Category, Category];

const RGB: Categories = ["red", "green", "blue"];
const XYZ: Categories = ["x", "y", "z"];
const LAB: Categories = ["lightness", "opponent-a", "opponent-b"];
const LCH: Categories = ["lightness", "colorfulness", "hue"];

const CATEGORIES = {
  srgb: RGB,
  "srgb-linear": RGB,
  "display-p3": RGB,
  "display-p3-linear": RGB,
  "a98-rgb": RGB,
  "prophoto-rgb": RGB,
  rec2020: RGB,
  "xyz-d50": XYZ,
  "xyz-d65": XYZ,
  lab: LAB,
  oklab: LAB,
  lch: LCH,
  oklch: LCH,
  hsl: ["hue", "colorfulness", "lightness"],
  hwb: ["hue", "whiteness", "blackness"],
} satisfies { readonly [S in Space]: Categories };

/** The index of a space's hue channel, if it is polar. */
const hueIndex = (space: Space): number => {
  const categories: Categories = CATEGORIES[space];
  return categories.indexOf("hue");
};

const zero = (channel: Channel): number => (channel === "none" ? 0 : channel);

const numbers = (channels: readonly [Channel, Channel, Channel]): Vector => [
  zero(channels[0]),
  zero(channels[1]),
  zero(channels[2]),
];

/**
 * Whether a polar colour's hue is powerless (CSS Color 4 §4.4): no
 * chroma, no saturation, or white and black filling the colour. A chroma
 * or saturation within rounding noise of 0 counts, since a grey converted
 * from another space rarely lands on 0 exactly.
 */
const isAchromatic = (space: Space, channels: Vector): boolean => {
  if (space === "hsl") return Math.abs(channels[1]) < 1e-4;
  if (space === "hwb") return channels[1] + channels[2] >= 100 - 1e-4;
  if (space === "lch") return channels[1] < 1e-4;
  if (space === "oklch") return channels[1] < 4e-6;
  return false;
};

/**
 * The target channels missing because a pair of source channels that
 * together make them is missing: a Lab-like colour's `a` and `b` (or an
 * LCH-like colour's chroma) make the other's chroma and hue (or `a` and
 * `b`); `hwb()`'s whiteness and blackness make `hsl()`'s saturation and
 * lightness, and the other way round.
 */
const pairMissing = (color: Working, target: Space): ReadonlyArray<number> => {
  const source: Categories = CATEGORIES[color.space];
  const targetCategories: Categories = CATEGORIES[target];
  const [, second, third] = color.channels;
  const isLab = (categories: Categories) => categories[1] === "opponent-a";
  const isLch = (categories: Categories) => categories === LCH;
  if (isLab(source) && isLch(targetCategories) && second === "none" && third === "none")
    return [1, 2];
  if (isLch(source) && isLab(targetCategories) && second === "none") return [1, 2];
  const polar = (space: Space) => space === "hsl" || space === "hwb";
  return polar(color.space) && polar(target) && second === "none" && third === "none" ? [1, 2] : [];
};

/**
 * `color` in `target`: converted through XYZ, a component missing in
 * `color` missing in its analogue, and an achromatic colour's hue missing.
 */
export const convert = (color: Working, target: Space): Working => {
  if (color.space === target) return color;
  const converted = CONVERSIONS[target].fromXyz(
    CONVERSIONS[color.space].toXyz(numbers(color.channels)),
  );
  const source: Categories = CATEGORIES[color.space];
  const targetCategories: Categories = CATEGORIES[target];
  const hue = hueIndex(target);
  const achromatic = isAchromatic(target, converted);
  const missingPair = pairMissing(color, target);
  const channel = (index: number): Channel => {
    if (missingPair.includes(index)) return "none";
    const analogue = source.indexOf(targetCategories[index] ?? "x");
    if (analogue >= 0 && color.channels[analogue] === "none") return "none";
    return index === hue && achromatic ? "none" : (converted[index] ?? 0);
  };
  return { space: target, channels: [channel(0), channel(1), channel(2)], alpha: color.alpha };
};

/** Both values with a missing one taken from the other; `None` when both are missing. */
const filled = (a: Channel, b: Channel): Option.Option<readonly [number, number]> =>
  a === "none" && b === "none"
    ? Option.none()
    : Option.some([a === "none" ? zero(b) : a, b === "none" ? zero(a) : b]);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hues adjusted for the method (CSS Color 4 §12.4), each in [0, 360) first. */
const fixHues = (a: number, b: number, method: HueMethod): readonly [number, number] => {
  const h1 = ((a % 360) + 360) % 360;
  const h2 = ((b % 360) + 360) % 360;
  const d = h2 - h1;
  if (method === "shorter") {
    if (d > 180) return [h1 + 360, h2];
    return d < -180 ? [h1, h2 + 360] : [h1, h2];
  }
  if (method === "longer") {
    if (d > 0 && d < 180) return [h1 + 360, h2];
    return d > -180 && d <= 0 ? [h1, h2 + 360] : [h1, h2];
  }
  if (method === "increasing") return d < 0 ? [h1, h2 + 360] : [h1, h2];
  return d > 0 ? [h1 + 360, h2] : [h1, h2];
};

/** One channel of a pairwise mix, premultiplied by its colour's alpha unless it is the hue. */
const mixChannel = (
  values: Option.Option<readonly [number, number]>,
  alphas: readonly [number, number],
  isHue: boolean,
  t: number,
  method: HueMethod,
): Channel =>
  Option.match(values, {
    onNone: (): Channel => "none",
    onSome: (pair) => mixValues(pair, alphas, isHue, t, method),
  });

const mixValues = (
  values: readonly [number, number],
  alphas: readonly [number, number],
  isHue: boolean,
  t: number,
  method: HueMethod,
): number => {
  if (isHue) {
    const [h1, h2] = fixHues(values[0], values[1], method);
    return ((lerp(h1, h2, t) % 360) + 360) % 360;
  }
  const premultiplied = lerp(values[0] * alphas[0], values[1] * alphas[1], t);
  const alpha = lerp(alphas[0], alphas[1], t);
  return alpha === 0 ? premultiplied : premultiplied / alpha;
};

/** Two colours in the same space, `t` of the way from `a` to `b`. */
const mixPair = (a: Working, b: Working, t: number, method: HueMethod): Working => {
  const alphas = filled(a.alpha, b.alpha);
  const [alphaA, alphaB] = Option.getOrElse(alphas, (): readonly [number, number] => [1, 1]);
  const hue = hueIndex(a.space);
  const channel = (index: 0 | 1 | 2): Channel =>
    mixChannel(
      filled(a.channels[index], b.channels[index]),
      [alphaA, alphaB],
      index === hue,
      t,
      method,
    );
  return {
    space: a.space,
    channels: [channel(0), channel(1), channel(2)],
    alpha: Option.isNone(alphas) ? "none" : lerp(alphaA, alphaB, t),
  };
};

/** One colour of a mix, already in the interpolation space, with its percentage (0 to 100). */
export interface Part {
  readonly color: Working;
  readonly percentage: number;
}

/**
 * The mix of `parts`, two at a time, each step weighted by the
 * percentages so far (equal halves while they are all 0%). The result's
 * alpha is scaled by the total percentage when it is under 100%.
 */
export const mix = (parts: readonly [Part, ...ReadonlyArray<Part>], method: HueMethod): Working => {
  const [first, ...rest] = parts;
  const { color, total } = rest.reduce(
    (state, part) => {
      const sum = state.total + part.percentage;
      const t = sum === 0 ? 0.5 : part.percentage / sum;
      return { color: mixPair(state.color, part.color, t, method), total: sum };
    },
    { color: first.color, total: first.percentage },
  );
  const scale = Math.min(1, total / 100);
  return scale === 1 || color.alpha === "none" ? color : { ...color, alpha: color.alpha * scale };
};
