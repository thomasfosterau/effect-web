/**
 * `color-mix()` resolution (CSS Color 5 §3.2, CSS Color 4 §12): convert
 * each colour into the interpolation space, carrying missing (`none`)
 * components forward to their analogues, and interpolate with
 * premultiplied alpha and the hue method, two colours at a time.
 */
import * as Option from "effect/Option";
import { convert as convertChannels, type Space, type Vector } from "./spaces.ts";

/** A channel, or `none` (a missing component). */
export type MixChannel = number | "none";

/** A colour in one of the interpolation spaces. */
export interface Working {
  readonly space: Space;
  readonly channels: readonly [MixChannel, MixChannel, MixChannel];
  readonly alpha: MixChannel;
}

/** How hues interpolate (CSS Color 4 §12.4). */
export type HueInterpolation = "shorter" | "longer" | "increasing" | "decreasing";

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

const zero = (channel: MixChannel): number => (channel === "none" ? 0 : channel);

const numbers = (channels: readonly [MixChannel, MixChannel, MixChannel]): Vector => [
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
export const toSpace = (color: Working, target: Space): Working => {
  if (color.space === target) return color;
  const converted = convertChannels(color.space, target, numbers(color.channels));
  const source: Categories = CATEGORIES[color.space];
  const targetCategories: Categories = CATEGORIES[target];
  const hue = hueIndex(target);
  const achromatic = isAchromatic(target, converted);
  const missingPair = pairMissing(color, target);
  const channel = (index: number): MixChannel => {
    if (missingPair.includes(index)) return "none";
    const analogue = source.indexOf(targetCategories[index] ?? "x");
    if (analogue >= 0 && color.channels[analogue] === "none") return "none";
    return index === hue && achromatic ? "none" : (converted[index] ?? 0);
  };
  return { space: target, channels: [channel(0), channel(1), channel(2)], alpha: color.alpha };
};

/** Both values with a missing one taken from the other; `None` when both are missing. */
const filled = (a: MixChannel, b: MixChannel): Option.Option<readonly [number, number]> =>
  a === "none" && b === "none"
    ? Option.none()
    : Option.some([a === "none" ? zero(b) : a, b === "none" ? zero(a) : b]);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Which hue each method moves up a turn, given the difference `d` from
 * the first hue to the second (CSS Color 4 §12.4): `1` the first, `2` the
 * second, `0` neither.
 */
const HUE_FIXUPS = {
  shorter: (d: number) => (d > 180 ? 1 : d < -180 ? 2 : 0),
  longer: (d: number) => (d > 0 && d < 180 ? 1 : d > -180 && d <= 0 ? 2 : 0),
  increasing: (d: number) => (d < 0 ? 2 : 0),
  decreasing: (d: number) => (d > 0 ? 1 : 0),
} satisfies { readonly [M in HueInterpolation]: (d: number) => 0 | 1 | 2 };

/** Hues adjusted for the method, each in [0, 360) first. */
const fixHues = (a: number, b: number, method: HueInterpolation): readonly [number, number] => {
  const h1 = ((a % 360) + 360) % 360;
  const h2 = ((b % 360) + 360) % 360;
  const fixup = HUE_FIXUPS[method](h2 - h1);
  return [fixup === 1 ? h1 + 360 : h1, fixup === 2 ? h2 + 360 : h2];
};

/** One channel of a pairwise mix, premultiplied by its colour's alpha unless it is the hue. */
const mixChannel = (
  values: Option.Option<readonly [number, number]>,
  alphas: readonly [number, number],
  isHue: boolean,
  t: number,
  method: HueInterpolation,
): MixChannel =>
  Option.match(values, {
    onNone: (): MixChannel => "none",
    onSome: (pair) => mixValues(pair, alphas, isHue, t, method),
  });

const mixValues = (
  values: readonly [number, number],
  alphas: readonly [number, number],
  isHue: boolean,
  t: number,
  method: HueInterpolation,
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
const mixPair = (a: Working, b: Working, t: number, method: HueInterpolation): Working => {
  const alphas = filled(a.alpha, b.alpha);
  const [alphaA, alphaB] = Option.getOrElse(alphas, (): readonly [number, number] => [1, 1]);
  const hue = hueIndex(a.space);
  const channel = (index: 0 | 1 | 2): MixChannel =>
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
export const mix = (
  parts: readonly [Part, ...ReadonlyArray<Part>],
  method: HueInterpolation,
): Working => {
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
