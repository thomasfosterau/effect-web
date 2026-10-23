/**
 * CSS Color Level 4 values: parse a `<color>` (named colours, hex,
 * `rgb()` / `hsl()` / `hwb()` in both comma and space syntaxes, `lab()`,
 * `lch()`, `oklab()`, `oklch()`, `color()`, `transparent`, `currentcolor`)
 * into a typed {@link Color}, serialise it as CSS Color 4 does, and
 * convert it to sRGB.
 *
 * @since 0.1.0
 */
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Str from "effect/String";
import { NAMED_COLORS } from "./internal/named-colors.ts";
import { parseComponentValue } from "./syntax.ts";
import type { ComponentValue } from "./token.ts";

/**
 * A channel value, or `none` (a missing component, CSS Color 4 §4.4).
 *
 * @since 0.1.0
 * @category models
 */
export type Channel = number | "none";

/**
 * The predefined colour spaces `color()` takes (CSS Color 4 §10).
 *
 * @since 0.1.0
 * @category models
 */
export type PredefinedSpace =
  | "srgb"
  | "srgb-linear"
  | "display-p3"
  | "a98-rgb"
  | "prophoto-rgb"
  | "rec2020"
  | "xyz-d50"
  | "xyz-d65";

/**
 * The channels of `lab()` and `oklab()`: lightness and the a / b axes.
 *
 * @since 0.1.0
 * @category models
 */
export interface LabChannels {
  readonly lightness: Channel;
  readonly a: Channel;
  readonly b: Channel;
  readonly alpha: Channel;
}

/**
 * The channels of `lch()` and `oklch()`: lightness, chroma and hue (in
 * degrees, normalised to [0, 360)).
 *
 * @since 0.1.0
 * @category models
 */
export interface LchChannels {
  readonly lightness: Channel;
  readonly chroma: Channel;
  readonly hue: Channel;
  readonly alpha: Channel;
}

/**
 * A parsed colour. Named colours, hex, `rgb()`, `hsl()` and `hwb()` all
 * become `Rgb` (red, green and blue from 0 to 255, alpha from 0 to 1;
 * `none` resolved to 0), as CSS Color 4 serialises them. `lab()`, `lch()`,
 * `oklab()` and `oklch()` keep their own space (lightness, and hue in
 * degrees normalised to [0, 360)); `color()` keeps its predefined space.
 * `currentcolor` has no value of its own.
 *
 * @since 0.1.0
 * @category models
 */
export type Color =
  | {
      readonly _tag: "Rgb";
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    }
  | ({ readonly _tag: "Lab" } & LabChannels)
  | ({ readonly _tag: "Oklab" } & LabChannels)
  | ({ readonly _tag: "Lch" } & LchChannels)
  | ({ readonly _tag: "Oklch" } & LchChannels)
  | {
      readonly _tag: "ColorFunction";
      readonly space: PredefinedSpace;
      readonly channels: readonly [Channel, Channel, Channel];
      readonly alpha: Channel;
    }
  | { readonly _tag: "CurrentColor" };

// ── Arguments ──────────────────────────────────────────────────────────

type Arg = ComponentValue;

/** A function's arguments in the space syntax (`a b c [/ alpha]`), or `None`. */
const spaceArgs = (
  args: ReadonlyArray<Arg>,
  count: number,
): Option.Option<{ channels: ReadonlyArray<Arg>; alpha: Option.Option<Arg> }> => {
  if (args.some((arg) => Predicate.isTagged(arg, "Comma"))) return Option.none();
  const slash = args.findIndex((arg) => Predicate.isTagged(arg, "Delim") && arg.value === "/");
  const channels = slash < 0 ? args : args.slice(0, slash);
  const rest = slash < 0 ? [] : args.slice(slash + 1);
  if (channels.length !== count || (slash >= 0 && rest.length !== 1)) return Option.none();
  return Option.some({ channels, alpha: Option.fromNullishOr(rest[0]) });
};

/** A function's arguments in the legacy comma syntax (`a, b, c[, alpha]`), or `None`. */
const commaArgs = (
  args: ReadonlyArray<Arg>,
): Option.Option<{ channels: ReadonlyArray<Arg>; alpha: Option.Option<Arg> }> => {
  const values = args.filter((_, index) => index % 2 === 0);
  const commas = args.filter((_, index) => index % 2 === 1);
  if (!commas.every((arg) => Predicate.isTagged(arg, "Comma"))) return Option.none();
  if (values.length < 3 || values.length > 4 || args.length !== values.length * 2 - 1) {
    return Option.none();
  }
  return Option.some({ channels: values.slice(0, 3), alpha: Option.fromNullishOr(values[3]) });
};

const isNone = (arg: Arg): boolean =>
  Predicate.isTagged(arg, "Ident") && Str.toLowerCase(arg.value) === "none";

/** A `<number>` or `<percentage>` (scaled by `percent` per 1%), or `none` when allowed. */
const numberOrPercentage = (
  arg: Arg,
  percent: number,
  allowNone: boolean,
): Option.Option<Channel> => {
  if (Predicate.isTagged(arg, "Number")) return Option.some(arg.value);
  if (Predicate.isTagged(arg, "Percentage")) return Option.some(arg.value * percent);
  if (allowNone && isNone(arg)) return Option.some("none");
  return Option.none();
};

const ANGLE_UNITS: Readonly<Record<string, number>> = {
  deg: 1,
  grad: 360 / 400,
  rad: 180 / Math.PI,
  turn: 360,
};

/** A `<hue>` in degrees, normalised to [0, 360), or `none` when allowed. */
const hue = (arg: Arg, allowNone: boolean): Option.Option<Channel> => {
  const degrees = Predicate.isTagged(arg, "Number")
    ? Option.some(arg.value)
    : Predicate.isTagged(arg, "Dimension")
      ? Option.map(
          Record.get(ANGLE_UNITS, Str.toLowerCase(arg.unit)),
          (factor) => arg.value * factor,
        )
      : Option.none();
  if (Option.isNone(degrees) && allowNone && isNone(arg)) return Option.some("none");
  return Option.map(degrees, (value) => ((value % 360) + 360) % 360);
};

/** An `<alpha-value>`, clamped to [0, 1]; absent is 1. */
const alphaOf = (arg: Option.Option<Arg>, allowNone: boolean): Option.Option<Channel> =>
  Option.match(arg, {
    onNone: () => Option.some(1),
    onSome: (value) =>
      Option.map(numberOrPercentage(value, 0.01, allowNone), (alpha) =>
        alpha === "none" ? alpha : Math.min(1, Math.max(0, alpha)),
      ),
  });

/** All of `options`, or `None` if any is `None`. */
const all = <A>(options: ReadonlyArray<Option.Option<A>>): Option.Option<ReadonlyArray<A>> =>
  Option.all(options);

const zero = (channel: Channel): number => (channel === "none" ? 0 : channel);

// ── sRGB from HSL and HWB ──────────────────────────────────────────────

/** CSS Color 4 §7.1's `hslToRgb`, saturation and lightness in percent, to [0, 1]. */
const hslToRgb = (h: number, s: number, l: number): readonly [number, number, number] => {
  const saturation = s / 100;
  const lightness = l / 100;
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};

/** CSS Color 4 §8.1's `hwbToRgb`, whiteness and blackness in percent, to [0, 1]. */
const hwbToRgb = (h: number, w: number, b: number): readonly [number, number, number] => {
  const white = w / 100;
  const black = b / 100;
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  const [red, green, blue] = hslToRgb(h, 100, 50);
  const scale = (channel: number) => channel * (1 - white - black) + white;
  return [scale(red), scale(green), scale(blue)];
};

const rgb = (channels: readonly [number, number, number], alpha: Channel): Color => ({
  _tag: "Rgb",
  red: channels[0] * 255,
  green: channels[1] * 255,
  blue: channels[2] * 255,
  alpha: zero(alpha),
});

// ── The functions ──────────────────────────────────────────────────────

const parseRgb = (args: ReadonlyArray<Arg>): Option.Option<Color> => {
  const modern = Option.flatMap(spaceArgs(args, 3), ({ channels, alpha }) =>
    all([...channels.map((arg) => numberOrPercentage(arg, 2.55, true)), alphaOf(alpha, true)]),
  );
  const legacy = Option.flatMap(commaArgs(args), ({ channels, alpha }) => {
    const allOf = (tag: "Number" | "Percentage") =>
      channels.every((arg) => Predicate.isTagged(arg, tag));
    if (!allOf("Number") && !allOf("Percentage")) return Option.none();
    return all([
      ...channels.map((arg) => numberOrPercentage(arg, 2.55, false)),
      alphaOf(alpha, false),
    ]);
  });
  return Option.map(
    Option.orElse(modern, () => legacy),
    ([red, green, blue, alpha]) => ({
      _tag: "Rgb" as const,
      red: zero(red ?? 0),
      green: zero(green ?? 0),
      blue: zero(blue ?? 0),
      alpha: zero(alpha ?? 1),
    }),
  );
};

const parseHsl = (args: ReadonlyArray<Arg>): Option.Option<Color> => {
  const modern = Option.flatMap(spaceArgs(args, 3), ({ channels, alpha }) => {
    const [h, s, l] = channels;
    if (h === undefined || s === undefined || l === undefined) return Option.none();
    return all([
      hue(h, true),
      numberOrPercentage(s, 1, true),
      numberOrPercentage(l, 1, true),
      alphaOf(alpha, true),
    ]);
  });
  const legacy = Option.flatMap(commaArgs(args), ({ channels, alpha }) => {
    const [h, s, l] = channels;
    if (
      h === undefined ||
      !Predicate.isTagged(s, "Percentage") ||
      !Predicate.isTagged(l, "Percentage")
    )
      return Option.none();
    return all([hue(h, false), Option.some(s.value), Option.some(l.value), alphaOf(alpha, false)]);
  });
  return Option.map(
    Option.orElse(modern, () => legacy),
    ([h, s, l, alpha]) => rgb(hslToRgb(zero(h ?? 0), zero(s ?? 0), zero(l ?? 0)), alpha ?? 1),
  );
};

const parseHwb = (args: ReadonlyArray<Arg>): Option.Option<Color> =>
  Option.map(
    Option.flatMap(spaceArgs(args, 3), ({ channels, alpha }) => {
      const [h, w, b] = channels;
      if (h === undefined || w === undefined || b === undefined) return Option.none();
      return all([
        hue(h, true),
        numberOrPercentage(w, 1, true),
        numberOrPercentage(b, 1, true),
        alphaOf(alpha, true),
      ]);
    }),
    ([h, w, b, alpha]) => rgb(hwbToRgb(zero(h ?? 0), zero(w ?? 0), zero(b ?? 0)), alpha ?? 1),
  );

/** `lab()` / `oklab()`: lightness per 1% and a / b per 1%. */
const parseLabLike = (
  tag: "Lab" | "Oklab",
  lightnessPercent: number,
  axisPercent: number,
  args: ReadonlyArray<Arg>,
): Option.Option<Color> =>
  Option.map(
    Option.flatMap(spaceArgs(args, 3), ({ channels, alpha }) => {
      const [l, a, b] = channels;
      if (l === undefined || a === undefined || b === undefined) return Option.none();
      return all([
        numberOrPercentage(l, lightnessPercent, true),
        numberOrPercentage(a, axisPercent, true),
        numberOrPercentage(b, axisPercent, true),
        alphaOf(alpha, true),
      ]);
    }),
    ([lightness, a, b, alpha]) => ({
      _tag: tag,
      lightness: lightness ?? 0,
      a: a ?? 0,
      b: b ?? 0,
      alpha: alpha ?? 1,
    }),
  );

/** `lch()` / `oklch()`: lightness per 1%, chroma per 1%, hue. */
const parseLchLike = (
  tag: "Lch" | "Oklch",
  lightnessPercent: number,
  chromaPercent: number,
  args: ReadonlyArray<Arg>,
): Option.Option<Color> =>
  Option.map(
    Option.flatMap(spaceArgs(args, 3), ({ channels, alpha }) => {
      const [l, c, h] = channels;
      if (l === undefined || c === undefined || h === undefined) return Option.none();
      return all([
        numberOrPercentage(l, lightnessPercent, true),
        numberOrPercentage(c, chromaPercent, true),
        hue(h, true),
        alphaOf(alpha, true),
      ]);
    }),
    ([lightness, chroma, h, alpha]) => ({
      _tag: tag,
      lightness: lightness ?? 0,
      chroma: chroma ?? 0,
      hue: h ?? 0,
      alpha: alpha ?? 1,
    }),
  );

const SPACES: Readonly<Record<string, PredefinedSpace>> = {
  srgb: "srgb",
  "srgb-linear": "srgb-linear",
  "display-p3": "display-p3",
  "a98-rgb": "a98-rgb",
  "prophoto-rgb": "prophoto-rgb",
  rec2020: "rec2020",
  xyz: "xyz-d65",
  "xyz-d50": "xyz-d50",
  "xyz-d65": "xyz-d65",
};

const parseColorFunction = (args: ReadonlyArray<Arg>): Option.Option<Color> => {
  const [first, ...rest] = args;
  if (!Predicate.isTagged(first, "Ident")) return Option.none();
  return Option.flatMap(Record.get(SPACES, Str.toLowerCase(first.value)), (space) =>
    Option.map(
      Option.flatMap(spaceArgs(rest, 3), ({ channels, alpha }) =>
        all([...channels.map((arg) => numberOrPercentage(arg, 0.01, true)), alphaOf(alpha, true)]),
      ),
      ([c1, c2, c3, alpha]): Color => ({
        _tag: "ColorFunction",
        space,
        channels: [c1 ?? 0, c2 ?? 0, c3 ?? 0],
        alpha: alpha ?? 1,
      }),
    ),
  );
};

const FUNCTIONS: Readonly<Record<string, (args: ReadonlyArray<Arg>) => Option.Option<Color>>> = {
  rgb: parseRgb,
  rgba: parseRgb,
  hsl: parseHsl,
  hsla: parseHsl,
  hwb: parseHwb,
  lab: (args) => parseLabLike("Lab", 1, 1.25, args),
  oklab: (args) => parseLabLike("Oklab", 0.01, 0.004, args),
  lch: (args) => parseLchLike("Lch", 1, 1.5, args),
  oklch: (args) => parseLchLike("Oklch", 0.01, 0.004, args),
  color: parseColorFunction,
};

const HEX = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const parseHex = (value: string): Option.Option<Color> => {
  if (!HEX.test(value)) return Option.none();
  const digits =
    value.length <= 4 ? Array.from(value, (digit) => digit + digit) : (value.match(/../g) ?? []);
  const [red = 0, green = 0, blue = 0, alpha = 255] = digits.map((pair) =>
    Number.parseInt(pair, 16),
  );
  return Option.some({ _tag: "Rgb", red, green, blue, alpha: alpha / 255 });
};

const parseKeyword = (value: string): Option.Option<Color> => {
  const name = value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  if (name === "transparent")
    return Option.some({ _tag: "Rgb", red: 0, green: 0, blue: 0, alpha: 0 });
  if (name === "currentcolor") return Option.some({ _tag: "CurrentColor" });
  return Option.map(
    Record.get<string, readonly [number, number, number]>(NAMED_COLORS, name),
    ([red, green, blue]) => ({ _tag: "Rgb" as const, red, green, blue, alpha: 1 }),
  );
};

/**
 * Parses a `<color>` from CSS text or a component value already parsed
 * by `Syntax`. `None` for anything that is not a valid colour.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Color } from "@thomasfosterau/effect-css"
 *
 * console.log(Option.map(Color.parse("hsl(120deg 100% 25% / 50%)"), Color.serialize))
 * // Option.some("rgba(0, 127.5, 0, 0.5)")
 * console.log(Option.map(Color.parse("oklch(70% 0.1 400)"), Color.serialize))
 * // Option.some("oklch(0.7 0.1 40)")
 * console.log(Option.isNone(Color.parse("rgb(1, 2)"))) // true
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (input: string | ComponentValue): Option.Option<Color> => {
  const value = Predicate.isString(input) ? parseComponentValue(input) : input;
  if (Predicate.isTagged(value, "Ident")) return parseKeyword(value.value);
  if (Predicate.isTagged(value, "Hash")) return parseHex(value.value);
  if (!Predicate.isTagged(value, "Func")) return Option.none();
  return Option.flatMap(
    Record.get(
      FUNCTIONS,
      value.name.replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
    ),
    (parseFunction) =>
      parseFunction(value.value.filter((arg) => !Predicate.isTagged(arg, "Whitespace"))),
  );
};

// ── Serialising ────────────────────────────────────────────────────────

/** A number as CSS Color 4 serialises it here: at most six decimals, no trailing zeros. */
const number = (value: Channel): string => {
  if (value === "none") return "none";
  const rounded = Math.round((value + 1e-7) * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
};

const withAlpha = (alpha: Channel): string => (alpha === 1 ? "" : ` / ${number(alpha)}`);

const clampByte = (value: number): number => Math.min(255, Math.max(0, value));

const serializeLab = (color: LabChannels & { readonly _tag: "Lab" | "Oklab" }): string =>
  `${Str.toLowerCase(color._tag)}(${number(color.lightness)} ${number(color.a)} ${number(color.b)}${withAlpha(color.alpha)})`;

const serializeLch = (color: LchChannels & { readonly _tag: "Lch" | "Oklch" }): string =>
  `${Str.toLowerCase(color._tag)}(${number(color.lightness)} ${number(color.chroma)} ${number(color.hue)}${withAlpha(color.alpha)})`;

/**
 * Serialises a colour (CSS Color 4 §15): sRGB colours as `rgb(r, g, b)` or
 * `rgba(r, g, b, a)`, the others in their own function with a space-
 * separated alpha when it is not 1, `currentcolor` as itself.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Color } from "@thomasfosterau/effect-css"
 *
 * console.log(Option.map(Color.parse("#0088"), Color.serialize)) // Option.some("rgba(0, 0, 136, 0.533333)")
 * console.log(Option.map(Color.parse("color(xyz 50% 0 1)"), Color.serialize)) // Option.some("color(xyz-d65 0.5 0 1)")
 * ```
 *
 * @since 0.1.0
 * @category serialising
 */
export const serialize = (color: Color): string =>
  Match.valueTags(color, {
    Rgb: (rgb) => {
      const channels = [rgb.red, rgb.green, rgb.blue].map((value) => number(clampByte(value)));
      return rgb.alpha === 1
        ? `rgb(${channels.join(", ")})`
        : `rgba(${channels.join(", ")}, ${number(rgb.alpha)})`;
    },
    Lab: serializeLab,
    Oklab: serializeLab,
    Lch: serializeLch,
    Oklch: serializeLch,
    ColorFunction: (function_) =>
      `color(${function_.space} ${function_.channels.map(number).join(" ")}${withAlpha(function_.alpha)})`,
    CurrentColor: () => "currentcolor",
  });

// ── Conversion to sRGB ─────────────────────────────────────────────────

type Vector = readonly [number, number, number];
type Matrix = readonly [Vector, Vector, Vector];

const multiply = (m: Matrix, v: Vector): Vector => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const mapVector = (v: Vector, f: (x: number) => number): Vector => [f(v[0]), f(v[1]), f(v[2])];

const signed = (value: number, f: (magnitude: number) => number): number =>
  Math.sign(value) * f(Math.abs(value));

/** The sRGB transfer function and its inverse (CSS Color 4 §10.2). */
const srgbToLinear = (c: number): number =>
  signed(c, (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
const linearToSrgb = (c: number): number =>
  signed(c, (x) => (x > 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x));

const LINEAR_SRGB_TO_XYZ: Matrix = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_LINEAR_SRGB: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D50_TO_D65: Matrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const LINEAR_P3_TO_XYZ: Matrix = [
  [0.48657094864821626, 0.26566769316909294, 0.1982172852343625],
  [0.22897456406974884, 0.6917385218365062, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const LINEAR_A98_TO_XYZ: Matrix = [
  [0.5766690429101308, 0.18555823790654627, 0.18822864623499472],
  [0.29734497525053616, 0.627363566255466, 0.07529145849399789],
  [0.02703136138641237, 0.07068885253582714, 0.9913375368376389],
];
const LINEAR_PROPHOTO_TO_XYZ_D50: Matrix = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LINEAR_REC2020_TO_XYZ: Matrix = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const OKLAB_TO_LMS: Matrix = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ: Matrix = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

/** The D50 white point, as XYZ. */
const D50: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/** CIE Lab (D50) to XYZ D50 (CSS Color 4 §18). */
const labToXyzD50 = (l: number, a: number, b: number): Vector => {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > epsilon ? f0 ** 3 : (116 * f0 - 16) / kappa;
  const y = l > kappa * epsilon ? ((l + 16) / 116) ** 3 : l / kappa;
  const z = f2 ** 3 > epsilon ? f2 ** 3 : (116 * f2 - 16) / kappa;
  return [x * D50[0], y * D50[1], z * D50[2]];
};

const polar = (chroma: number, h: number): readonly [number, number] => [
  chroma * Math.cos((h * Math.PI) / 180),
  chroma * Math.sin((h * Math.PI) / 180),
];

const oklabToXyz = (l: number, a: number, b: number): Vector =>
  multiply(
    LMS_TO_XYZ,
    mapVector(multiply(OKLAB_TO_LMS, [l, a, b]), (value) => value ** 3),
  );

const REC2020_ALPHA = 1.09929682680944;
const REC2020_BETA = 0.018053968510807;

/** Each predefined space's channels to XYZ D65. */
const SPACE_TO_XYZ = {
  srgb: (c) => multiply(LINEAR_SRGB_TO_XYZ, mapVector(c, srgbToLinear)),
  "srgb-linear": (c) => multiply(LINEAR_SRGB_TO_XYZ, c),
  "display-p3": (c) => multiply(LINEAR_P3_TO_XYZ, mapVector(c, srgbToLinear)),
  "a98-rgb": (c) =>
    multiply(
      LINEAR_A98_TO_XYZ,
      mapVector(c, (x) => signed(x, (m) => m ** (563 / 256))),
    ),
  "prophoto-rgb": (c) =>
    multiply(
      D50_TO_D65,
      multiply(
        LINEAR_PROPHOTO_TO_XYZ_D50,
        mapVector(c, (x) => signed(x, (m) => (m <= 16 / 512 ? m / 16 : m ** 1.8))),
      ),
    ),
  rec2020: (c) =>
    multiply(
      LINEAR_REC2020_TO_XYZ,
      mapVector(c, (x) =>
        signed(x, (m) =>
          m < REC2020_BETA * 4.5
            ? m / 4.5
            : ((m + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45),
        ),
      ),
    ),
  "xyz-d50": (c) => multiply(D50_TO_D65, c),
  "xyz-d65": (c) => c,
} satisfies { readonly [S in PredefinedSpace]: (c: Vector) => Vector };

const lchToXyz = (
  lightness: Channel,
  chroma: Channel,
  h: Channel,
  toXyz: (l: number, a: number, b: number) => Vector,
): Vector => {
  const [a, b] = polar(zero(chroma), zero(h));
  return toXyz(zero(lightness), a, b);
};

const labD65 = (l: number, a: number, b: number): Vector =>
  multiply(D50_TO_D65, labToXyzD50(l, a, b));

/** XYZ D65 for a colour, `None` for `currentcolor`. */
const toXyzD65 = (color: Color): Option.Option<Vector> =>
  Match.valueTags(color, {
    Rgb: (rgb) =>
      Option.some(
        multiply(
          LINEAR_SRGB_TO_XYZ,
          mapVector([rgb.red, rgb.green, rgb.blue], (c) => srgbToLinear(c / 255)),
        ),
      ),
    Lab: (lab) => Option.some(labD65(zero(lab.lightness), zero(lab.a), zero(lab.b))),
    Lch: (lch) => Option.some(lchToXyz(lch.lightness, lch.chroma, lch.hue, labD65)),
    Oklab: (lab) => Option.some(oklabToXyz(zero(lab.lightness), zero(lab.a), zero(lab.b))),
    Oklch: (lch) => Option.some(lchToXyz(lch.lightness, lch.chroma, lch.hue, oklabToXyz)),
    ColorFunction: (function_) =>
      Option.some(
        SPACE_TO_XYZ[function_.space]([
          zero(function_.channels[0]),
          zero(function_.channels[1]),
          zero(function_.channels[2]),
        ]),
      ),
    CurrentColor: () => Option.none(),
  });

/**
 * A colour in sRGB, channels and alpha from 0 to 1. Not gamut-mapped: a
 * colour outside sRGB (a saturated `display-p3` or `oklch()` one) has
 * channels below 0 or above 1, for the caller to clip or map.
 *
 * @since 0.1.0
 * @category models
 */
export interface Srgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/**
 * Converts a colour to sRGB through CIE XYZ (CSS Color 4 §18's sample
 * algorithms; Lab and LCH through D50 with Bradford adaptation). A `none`
 * channel counts as 0. `None` for `currentcolor`.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Color } from "@thomasfosterau/effect-css"
 *
 * const red = Option.flatMap(Color.parse("oklch(62.8% 0.2577 29.23)"), Color.toSrgb)
 * console.log(Option.map(red, ({ red }) => Math.round(red * 255))) // Option.some(255)
 * ```
 *
 * @since 0.1.0
 * @category converting
 */
export const toSrgb = (color: Color): Option.Option<Srgb> => {
  if (Predicate.isTagged(color, "Rgb")) {
    return Option.some({
      red: color.red / 255,
      green: color.green / 255,
      blue: color.blue / 255,
      alpha: color.alpha,
    });
  }
  return Option.map(toXyzD65(color), (xyz) => {
    const [red, green, blue] = mapVector(multiply(XYZ_TO_LINEAR_SRGB, xyz), linearToSrgb);
    return { red, green, blue, alpha: "alpha" in color ? zero(color.alpha) : 1 };
  });
};
