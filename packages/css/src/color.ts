/**
 * CSS Color Level 4 values: parse a `<color>` (named colours, hex,
 * `rgb()` / `hsl()` / `hwb()` in both comma and space syntaxes, `lab()`,
 * `lch()`, `oklab()`, `oklch()`, `color()`, `transparent`, `currentcolor`)
 * into a typed {@link Color}, serialise it as CSS Color 4 does, and
 * convert it to sRGB. From CSS Color 5: `device-cmyk()`, `color()` in a
 * custom (`--name`) colour space, `light-dark()` and `color-mix()`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Str from "effect/String";
import * as Mix from "./internal/mix.ts";
import { NAMED_COLORS } from "./internal/named-colors.ts";
import * as Spaces from "./internal/spaces.ts";
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
  | "display-p3-linear"
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
 * The channels of `hsl()`: hue in degrees (normalised to [0, 360)),
 * saturation and lightness per 1% (`50%` is 50), alpha from 0 to 1.
 *
 * @since 0.1.0
 * @category models
 */
export interface HslChannels {
  readonly hue: Channel;
  readonly saturation: Channel;
  readonly lightness: Channel;
  readonly alpha: Channel;
}

/**
 * The channels of `hwb()`: hue in degrees (normalised to [0, 360)),
 * whiteness and blackness per 1%, alpha from 0 to 1.
 *
 * @since 0.1.0
 * @category models
 */
export interface HwbChannels {
  readonly hue: Channel;
  readonly whiteness: Channel;
  readonly blackness: Channel;
  readonly alpha: Channel;
}

/**
 * The colour spaces `color-mix()` interpolates in (CSS Color 4 §12.1):
 * the rectangular ones and the polar ones, which take a hue method.
 * `xyz` is `xyz-d65`.
 *
 * @since 0.1.0
 * @category models
 */
export type InterpolationSpace =
  | PredefinedSpace
  | "lab"
  | "oklab"
  | "hsl"
  | "hwb"
  | "lch"
  | "oklch";

/**
 * How hues interpolate in a polar space (CSS Color 4 §12.4); `shorter`
 * is the default.
 *
 * @since 0.1.0
 * @category models
 */
export type HueMethod = "shorter" | "longer" | "increasing" | "decreasing";

/**
 * One colour of a `color-mix()`, with its percentage (0 to 100) when
 * one was given.
 *
 * @since 0.1.0
 * @category models
 */
export interface MixComponent {
  readonly color: Color;
  readonly percentage: Option.Option<number>;
}

/**
 * A parsed colour. Hex and `rgb()` become `Rgb` (red, green and blue from 0
 * to 255, alpha from 0 to 1); an `rgb()` with a `none` channel is
 * `color(srgb …)` instead (a `ColorFunction`), which keeps it, as CSS Color
 * 4 serialises it. A named colour (`transparent` included) is `Named`: its
 * lowercased name and its sRGB value.
 * `hsl()` is `Hsl` and `hwb()` is `Hwb`, their channels as written (hue in
 * degrees normalised to [0, 360), the others per 1%) with `none` kept, so a
 * `color-mix()` can carry a missing component forward. `lab()`, `lch()`,
 * `oklab()` and `oklch()` keep their own space (lightness, and hue in
 * degrees normalised to [0, 360)); `color()` keeps its predefined space.
 * `currentcolor` has no value of its own. From CSS Color 5:
 * `device-cmyk()` is `DeviceCmyk` (each channel clamped to [0, 1]); a
 * `color()` in a custom colour space (`--name`, defined by an
 * `@color-profile` rule) is `CustomColor`, its channels as written (a
 * percentage per 1%); `light-dark()` is `LightDark`, both colours kept,
 * since which one applies depends on the used colour scheme;
 * `color-mix()` is `ColorMix`, its interpolation method and colours as
 * written (a mix is resolved at computed-value time, not here).
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
  | {
      readonly _tag: "Named";
      readonly name: string;
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    }
  | ({ readonly _tag: "Hsl" } & HslChannels)
  | ({ readonly _tag: "Hwb" } & HwbChannels)
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
  | {
      readonly _tag: "DeviceCmyk";
      readonly cyan: Channel;
      readonly magenta: Channel;
      readonly yellow: Channel;
      readonly black: Channel;
      readonly alpha: Channel;
    }
  | {
      readonly _tag: "CustomColor";
      readonly space: string;
      readonly channels: ReadonlyArray<Channel>;
      readonly alpha: Channel;
    }
  | { readonly _tag: "LightDark"; readonly light: Color; readonly dark: Color }
  | {
      readonly _tag: "ColorMix";
      readonly space: InterpolationSpace;
      readonly hue: HueMethod;
      readonly colors: ReadonlyArray<MixComponent>;
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
  count = 3,
): Option.Option<{ channels: ReadonlyArray<Arg>; alpha: Option.Option<Arg> }> => {
  const values = args.filter((_, index) => index % 2 === 0);
  const commas = args.filter((_, index) => index % 2 === 1);
  if (!commas.every((arg) => Predicate.isTagged(arg, "Comma"))) return Option.none();
  if (values.length < count || values.length > count + 1 || args.length !== values.length * 2 - 1) {
    return Option.none();
  }
  return Option.some({
    channels: values.slice(0, count),
    alpha: Option.fromNullishOr(values[count]),
  });
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

/** An `hsl()` or `hwb()` colour as `Rgb`, `none` channels as 0. */
const toRgb = (
  color: ({ readonly _tag: "Hsl" } & HslChannels) | ({ readonly _tag: "Hwb" } & HwbChannels),
) =>
  Predicate.isTagged(color, "Hsl")
    ? rgb(
        Spaces.hslToSrgb([
          zero(color.hue),
          // CSS Color 4 §7: a negative saturation is 0%, lightness is within [0%, 100%].
          Math.max(0, zero(color.saturation)),
          Math.min(100, Math.max(0, zero(color.lightness))),
        ]),
        color.alpha,
      )
    : rgb(
        Spaces.hwbToSrgb([zero(color.hue), zero(color.whiteness), zero(color.blackness)]),
        color.alpha,
      );

const rgb = (
  channels: readonly [number, number, number],
  alpha: Channel,
): Extract<Color, { readonly _tag: "Rgb" }> => ({
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
    ([red = 0, green = 0, blue = 0, alpha = 1]): Color => {
      // A missing channel survives only in `color(srgb …)` (CSS Color 4 §15.2).
      if ([red, green, blue, alpha].includes("none")) {
        const unit = (channel: Channel): Channel => (channel === "none" ? channel : channel / 255);
        return {
          _tag: "ColorFunction",
          space: "srgb",
          channels: [unit(red), unit(green), unit(blue)],
          alpha,
        };
      }
      return {
        _tag: "Rgb",
        red: zero(red),
        green: zero(green),
        blue: zero(blue),
        alpha: zero(alpha),
      };
    },
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
    ([hue = 0, saturation = 0, lightness = 0, alpha = 1]): Color => ({
      _tag: "Hsl",
      hue,
      saturation,
      lightness,
      alpha,
    }),
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
    ([hue = 0, whiteness = 0, blackness = 0, alpha = 1]): Color => ({
      _tag: "Hwb",
      hue,
      whiteness,
      blackness,
      alpha,
    }),
  );

/** Lightness clamped to [0, `max`] at parse time (CSS Color 4 §9.2, §9.3). */
const clampLightness = (lightness: Channel, max: number): Channel =>
  lightness === "none" ? lightness : Math.min(max, Math.max(0, lightness));

/** A negative chroma is 0 (CSS Color 4 §9.3). */
const clampChroma = (chroma: Channel): Channel =>
  chroma === "none" ? chroma : Math.max(0, chroma);

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
      lightness: clampLightness(lightness ?? 0, lightnessPercent * 100),
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
      lightness: clampLightness(lightness ?? 0, lightnessPercent * 100),
      chroma: clampChroma(chroma ?? 0),
      hue: h ?? 0,
      alpha: alpha ?? 1,
    }),
  );

const SPACES: Readonly<Record<string, PredefinedSpace>> = {
  srgb: "srgb",
  "srgb-linear": "srgb-linear",
  "display-p3": "display-p3",
  "display-p3-linear": "display-p3-linear",
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
  if (first.value.startsWith("--") && first.value.length > 2) {
    return parseCustomColor(first.value, rest);
  }
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

const clampUnit = (channel: Channel): Channel =>
  channel === "none" ? channel : Math.min(1, Math.max(0, channel));

/**
 * `device-cmyk()` (CSS Color 5 §8): four numbers or percentages (or
 * `none`) in the space syntax, or four numbers in the legacy comma syntax,
 * each clamped to [0, 1].
 */
const parseDeviceCmyk = (args: ReadonlyArray<Arg>): Option.Option<Color> => {
  const modern = Option.flatMap(spaceArgs(args, 4), ({ channels, alpha }) =>
    all([...channels.map((arg) => numberOrPercentage(arg, 0.01, true)), alphaOf(alpha, true)]),
  );
  const legacy = Option.flatMap(commaArgs(args, 4), ({ channels, alpha }) =>
    channels.every((arg) => Predicate.isTagged(arg, "Number"))
      ? all([...channels.map((arg) => numberOrPercentage(arg, 1, false)), alphaOf(alpha, false)])
      : Option.none(),
  );
  return Option.map(
    Option.orElse(modern, () => legacy),
    ([cyan = 0, magenta = 0, yellow = 0, black = 0, alpha = 1]) => ({
      _tag: "DeviceCmyk" as const,
      cyan: clampUnit(cyan),
      magenta: clampUnit(magenta),
      yellow: clampUnit(yellow),
      black: clampUnit(black),
      alpha,
    }),
  );
};

/**
 * `color()` in a custom colour space (CSS Color 5 §10): a `<dashed-ident>`
 * then one or more numbers or percentages (or `none`), as written.
 */
const parseCustomColor = (space: string, rest: ReadonlyArray<Arg>): Option.Option<Color> => {
  const slash = rest.findIndex((arg) => Predicate.isTagged(arg, "Delim") && arg.value === "/");
  const count = slash < 0 ? rest.length : slash;
  if (count === 0) return Option.none();
  return Option.map(
    Option.flatMap(spaceArgs(rest, count), ({ channels, alpha }) =>
      Option.all([
        all(channels.map((arg) => numberOrPercentage(arg, 0.01, true))),
        alphaOf(alpha, true),
      ]),
    ),
    ([channels, alpha]): Color => ({ _tag: "CustomColor", space, channels, alpha }),
  );
};

/** The arguments split at top-level commas, each without surrounding whitespace. */
const commaSeparated = (args: ReadonlyArray<Arg>): ReadonlyArray<ReadonlyArray<Arg>> =>
  args.reduce<ReadonlyArray<ReadonlyArray<Arg>>>(
    (groups, arg) =>
      Predicate.isTagged(arg, "Comma")
        ? [...groups, []]
        : [...groups.slice(0, -1), [...(groups.at(-1) ?? []), arg]],
    [[]],
  );

/** `light-dark()` (CSS Color 5 §11): two colours, separated by a comma. */
const parseLightDark = (args: ReadonlyArray<Arg>): Option.Option<Color> => {
  const groups = commaSeparated(args);
  if (groups.length !== 2 || groups.some((group) => group.length !== 1)) return Option.none();
  const [light, dark] = groups.flat();
  if (light === undefined || dark === undefined) return Option.none();
  return Option.map(Option.all([parse(light), parse(dark)]), ([lightColor, darkColor]) => ({
    _tag: "LightDark" as const,
    light: lightColor,
    dark: darkColor,
  }));
};

const POLAR_SPACES: ReadonlyArray<InterpolationSpace> = ["hsl", "hwb", "lch", "oklch"];
const MIX_SPACES: ReadonlyArray<InterpolationSpace> = ["lab", "oklab", ...POLAR_SPACES];
const HUE_METHODS: ReadonlyArray<HueMethod> = ["shorter", "longer", "increasing", "decreasing"];

/** The lowercased identifier at `index` in `group`, if there is one. */
const keywordAt = (group: ReadonlyArray<Arg>, index: number): Option.Option<string> =>
  Option.flatMap(Arr.get(group, index), (arg) =>
    Predicate.isTagged(arg, "Ident") ? Option.some(Str.toLowerCase(arg.value)) : Option.none(),
  );

const interpolationSpace = (name: string): Option.Option<InterpolationSpace> =>
  Option.orElse(Record.get(SPACES, name), () => Arr.findFirst(MIX_SPACES, (one) => one === name));

const hueMethod = (name: string): Option.Option<HueMethod> =>
  Arr.findFirst(HUE_METHODS, (one) => one === name);

/** `in <space> [<hue-method> hue]`, the hue method only for a polar space. */
const interpolationMethod = (
  group: ReadonlyArray<Arg>,
): Option.Option<{ readonly space: InterpolationSpace; readonly hue: HueMethod }> => {
  if (!Option.exists(keywordAt(group, 0), (name) => name === "in") || group.length > 4) {
    return Option.none();
  }
  return Option.flatMap(Option.flatMap(keywordAt(group, 1), interpolationSpace), (space) => {
    if (group.length === 2) return Option.some({ space, hue: "shorter" as const });
    const polar = POLAR_SPACES.includes(space);
    return polar && Option.exists(keywordAt(group, 3), (name) => name === "hue")
      ? Option.map(Option.flatMap(keywordAt(group, 2), hueMethod), (hue) => ({ space, hue }))
      : Option.none();
  });
};

/** A percentage from 0% to 100%. */
const mixPercentage = (arg: Arg): Option.Option<number> =>
  Predicate.isTagged(arg, "Percentage") && arg.value >= 0 && arg.value <= 100
    ? Option.some(arg.value)
    : Option.none();

/** `<color> <percentage>?` or `<percentage> <color>`. */
const mixComponent = (group: ReadonlyArray<Arg>): Option.Option<MixComponent> => {
  const [first, second, ...rest] = group;
  if (first === undefined || Arr.isReadonlyArrayNonEmpty(rest)) return Option.none();
  if (second === undefined)
    return Option.map(parse(first), (color) => ({ color, percentage: Option.none() }));
  const leading = Predicate.isTagged(first, "Percentage");
  return Option.map(
    Option.all([parse(leading ? second : first), mixPercentage(leading ? first : second)]),
    ([color, percentage]) => ({ color, percentage: Option.some(percentage) }),
  );
};

/**
 * `color-mix()` (CSS Color 5 §3): an optional interpolation method
 * (`oklab` by default), then one or more colours, each with an optional
 * percentage from 0% to 100%.
 */
const parseColorMix = (args: ReadonlyArray<Arg>): Option.Option<Color> => {
  const groups = commaSeparated(args);
  const [head = []] = groups;
  const method = interpolationMethod(head);
  const colors = Option.isSome(method) ? groups.slice(1) : groups;
  if (Arr.isReadonlyArrayEmpty(colors)) return Option.none();
  const { space, hue } = Option.getOrElse(method, () => ({
    space: "oklab" as const,
    hue: "shorter" as const,
  }));
  return Option.map(all(colors.map(mixComponent)), (components) => ({
    _tag: "ColorMix" as const,
    space,
    hue,
    colors: components,
  }));
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
  "device-cmyk": parseDeviceCmyk,
  "light-dark": parseLightDark,
  "color-mix": parseColorMix,
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
    return Option.some({ _tag: "Named", name, red: 0, green: 0, blue: 0, alpha: 0 });
  if (name === "currentcolor") return Option.some({ _tag: "CurrentColor" });
  return Option.map(
    Record.get<string, readonly [number, number, number]>(NAMED_COLORS, name),
    ([red, green, blue]) => ({ _tag: "Named" as const, name, red, green, blue, alpha: 1 }),
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
 * // Option.some("rgba(0, 128, 0, 0.5)")
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

/** A legacy sRGB colour (CSS Color 4 §15.2): `rgb()` / `rgba()`, each channel a clamped, rounded integer. */
const serializeRgb = (rgb: {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}): string => {
  const channels = [rgb.red, rgb.green, rgb.blue].map((value) =>
    String(Math.round(Number(clampByte(value).toFixed(6)))),
  );
  return rgb.alpha === 1
    ? `rgb(${channels.join(", ")})`
    : `rgba(${channels.join(", ")}, ${number(rgb.alpha)})`;
};

const hasNone = (channels: ReadonlyArray<Channel>): boolean => channels.includes("none");

/** A channel per 1%, written as a percentage; `none` as itself. */
const percent = (channel: Channel): string =>
  channel === "none" ? channel : `${number(channel)}%`;

const serializeLab = (color: LabChannels & { readonly _tag: "Lab" | "Oklab" }): string =>
  `${Str.toLowerCase(color._tag)}(${number(color.lightness)} ${number(color.a)} ${number(color.b)}${withAlpha(color.alpha)})`;

const serializeLch = (color: LchChannels & { readonly _tag: "Lch" | "Oklch" }): string =>
  `${Str.toLowerCase(color._tag)}(${number(color.lightness)} ${number(color.chroma)} ${number(color.hue)}${withAlpha(color.alpha)})`;

/**
 * The percentages a mix serialises with (CSS Color 5 §3.3): a missing one
 * takes an equal share of what the given ones leave of 100%, and all are
 * left out when they are all equal and sum to 100%.
 */
/** Each colour's percentage, a missing one taking an equal share of what the given ones leave of 100%. */
const fillPercentages = (colors: ReadonlyArray<MixComponent>): ReadonlyArray<number> => {
  const given = colors.flatMap(({ percentage }) =>
    Option.isSome(percentage) ? [percentage.value] : [],
  );
  const missing = colors.length - given.length;
  const share =
    missing === 0 ? 0 : Math.max(0, 100 - given.reduce((sum, one) => sum + one, 0)) / missing;
  return colors.map(({ percentage }) => Option.getOrElse(percentage, () => share));
};

const mixPercentages = (
  colors: ReadonlyArray<MixComponent>,
): ReadonlyArray<Option.Option<number>> => {
  const filled = fillPercentages(colors);
  const [first = 0] = filled;
  const sum = filled.reduce((total, one) => total + one, 0);
  const defaults =
    filled.every((one) => Math.abs(one - first) < 1e-9) && Math.abs(sum - 100) < 1e-9;
  return filled.map((one) => (defaults ? Option.none() : Option.some(one)));
};

const serializeMix = (mix: {
  readonly space: InterpolationSpace;
  readonly hue: HueMethod;
  readonly colors: ReadonlyArray<MixComponent>;
}): string => {
  const method =
    mix.space === "oklab" && mix.hue === "shorter"
      ? []
      : [`in ${mix.space}${mix.hue === "shorter" ? "" : ` ${mix.hue} hue`}`];
  const percentages = mixPercentages(mix.colors);
  const colors = mix.colors.map(({ color }, index) =>
    Option.match(percentages[index] ?? Option.none(), {
      onNone: () => serialize(color),
      onSome: (percentage) => `${serialize(color)} ${number(percentage)}%`,
    }),
  );
  return `color-mix(${[...method, ...colors].join(", ")})`;
};

/**
 * Serialises a colour's specified value as today's CSS Color 4 does (§15):
 * a named colour as its name; hex, `rgb()`, `hsl()` and `hwb()` as
 * `rgb(r, g, b)` or `rgba(r, g, b, a)`, each channel rounded to an integer
 * and clamped to [0, 255]; but an `rgb()` with a `none` channel as
 * `color(srgb …)`, and an `hsl()` or `hwb()` with one in its own
 * function, so the `none` survives. The other functions use their own
 * function with a space-separated alpha when it is not 1, and
 * `currentcolor` is written as itself. Numbers print with at most six
 * decimals. CSS Color 5:
 * `device-cmyk()` as `color(device-cmyk c m y k)`, a custom space as
 * `color(--name …)`, `light-dark()` with each colour serialised, and
 * `color-mix()` as specified (CSS Color 5 §3.3): the method left out when
 * it is the default `in oklab`, a `shorter hue` left out, and the
 * percentages filled in where missing and left out when they are the
 * default (all equal, summing to 100%).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Color } from "@thomasfosterau/effect-css"
 *
 * console.log(Option.map(Color.parse("#0088"), Color.serialize)) // Option.some("rgba(0, 0, 136, 0.533333)")
 * console.log(Option.map(Color.parse("Red"), Color.serialize)) // Option.some("red")
 * console.log(Option.map(Color.parse("hsl(none 50% 50%)"), Color.serialize)) // Option.some("hsl(none 50% 50%)")
 * console.log(Option.map(Color.parse("color(xyz 50% 0 1)"), Color.serialize)) // Option.some("color(xyz-d65 0.5 0 1)")
 * ```
 *
 * @since 0.1.0
 * @category serialising
 */
export const serialize = (color: Color): string =>
  Match.valueTags(color, {
    Rgb: serializeRgb,
    Named: (named) => named.name,
    Hsl: (hsl) =>
      hasNone([hsl.hue, hsl.saturation, hsl.lightness, hsl.alpha])
        ? `hsl(${number(hsl.hue)} ${percent(hsl.saturation)} ${percent(hsl.lightness)}${withAlpha(hsl.alpha)})`
        : serializeRgb(toRgb(hsl)),
    Hwb: (hwb) =>
      hasNone([hwb.hue, hwb.whiteness, hwb.blackness, hwb.alpha])
        ? `hwb(${number(hwb.hue)} ${percent(hwb.whiteness)} ${percent(hwb.blackness)}${withAlpha(hwb.alpha)})`
        : serializeRgb(toRgb(hwb)),
    Lab: serializeLab,
    Oklab: serializeLab,
    Lch: serializeLch,
    Oklch: serializeLch,
    ColorFunction: (function_) =>
      `color(${function_.space} ${function_.channels.map(number).join(" ")}${withAlpha(function_.alpha)})`,
    DeviceCmyk: (cmyk) =>
      `color(device-cmyk ${[cmyk.cyan, cmyk.magenta, cmyk.yellow, cmyk.black].map(number).join(" ")}${withAlpha(cmyk.alpha)})`,
    CustomColor: (custom) =>
      `color(${custom.space} ${custom.channels.map(number).join(" ")}${withAlpha(custom.alpha)})`,
    LightDark: (lightDark) =>
      `light-dark(${serialize(lightDark.light)}, ${serialize(lightDark.dark)})`,
    ColorMix: serializeMix,
    CurrentColor: () => "currentcolor",
  });

// ── Conversion to sRGB ─────────────────────────────────────────────────

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
 * channel counts as 0. `device-cmyk()` converts naively (CSS Color 5
 * §8.1, no colour profile). `None` for `currentcolor`, a custom colour
 * space (its profile is a stylesheet's `@color-profile`), `light-dark()`
 * (which colour applies depends on the used colour scheme) and
 * `color-mix()` (not resolved here).
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
  if (Predicate.isTagged(color, "Hsl") || Predicate.isTagged(color, "Hwb")) {
    return toSrgb(toRgb(color));
  }
  if (Predicate.isTagged(color, "Rgb") || Predicate.isTagged(color, "Named")) {
    return Option.some({
      red: color.red / 255,
      green: color.green / 255,
      blue: color.blue / 255,
      alpha: color.alpha,
    });
  }
  return Option.map(working(color), ({ space, channels, alpha }) => {
    const [red, green, blue] = Spaces.convert(space, "srgb", [
      zero(channels[0]),
      zero(channels[1]),
      zero(channels[2]),
    ]);
    return { red, green, blue, alpha: zero(alpha) };
  });
};

// ── Resolving color-mix() ──────────────────────────────────────────────

/** A colour's own space and channels (`none` kept), or `None` for one with no value of its own. */
const working = (color: Color): Option.Option<Mix.Working> =>
  Match.valueTags(color, {
    Rgb: (rgb) => Option.some(srgbWorking(rgb)),
    Named: (named) => Option.some(srgbWorking(named)),
    Hsl: (hsl) =>
      Option.some<Mix.Working>({
        space: "hsl",
        channels: [hsl.hue, hsl.saturation, hsl.lightness],
        alpha: hsl.alpha,
      }),
    Hwb: (hwb) =>
      Option.some<Mix.Working>({
        space: "hwb",
        channels: [hwb.hue, hwb.whiteness, hwb.blackness],
        alpha: hwb.alpha,
      }),
    Lab: (lab) => Option.some(labWorking("lab", lab)),
    Oklab: (lab) => Option.some(labWorking("oklab", lab)),
    Lch: (lch) => Option.some(lchWorking("lch", lch)),
    Oklch: (lch) => Option.some(lchWorking("oklch", lch)),
    ColorFunction: (function_) =>
      Option.some<Mix.Working>({
        space: function_.space,
        channels: function_.channels,
        alpha: function_.alpha,
      }),
    // Naive CMYK to sRGB (CSS Color 5 §8.1), without a colour profile.
    DeviceCmyk: (cmyk) => {
      const black = zero(cmyk.black);
      const channel = (ink: Channel): number => 1 - Math.min(1, zero(ink) * (1 - black) + black);
      return Option.some<Mix.Working>({
        space: "srgb",
        channels: [channel(cmyk.cyan), channel(cmyk.magenta), channel(cmyk.yellow)],
        alpha: cmyk.alpha,
      });
    },
    ColorMix: (mix) => Option.flatMap(resolveMix(mix), working),
    CustomColor: () => Option.none(),
    LightDark: () => Option.none(),
    CurrentColor: () => Option.none(),
  });

const srgbWorking = (rgb: {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}): Mix.Working => ({
  space: "srgb",
  channels: [rgb.red / 255, rgb.green / 255, rgb.blue / 255],
  alpha: rgb.alpha,
});

const labWorking = (space: "lab" | "oklab", lab: LabChannels): Mix.Working => ({
  space,
  channels: [lab.lightness, lab.a, lab.b],
  alpha: lab.alpha,
});

const lchWorking = (space: "lch" | "oklch", lch: LchChannels): Mix.Working => ({
  space,
  channels: [lch.lightness, lch.chroma, lch.hue],
  alpha: lch.alpha,
});

/**
 * A mixed colour as a `Color` in its interpolation space. A mix in `hsl`
 * or `hwb` with no missing component is written as `color(srgb …)`, as
 * CSS Color 5 serialises it; one with a missing component keeps its space,
 * so the `none` survives.
 */
const fromWorking = ({ space, channels, alpha }: Mix.Working): Color => {
  const [c1, c2, c3] = channels;
  if (space === "lab" || space === "oklab") {
    return { _tag: space === "lab" ? "Lab" : "Oklab", lightness: c1, a: c2, b: c3, alpha };
  }
  if (space === "lch" || space === "oklch") {
    return { _tag: space === "lch" ? "Lch" : "Oklch", lightness: c1, chroma: c2, hue: c3, alpha };
  }
  if (space === "hsl" || space === "hwb") {
    return [c1, c2, c3, alpha].includes("none")
      ? polarSrgb(space, channels, alpha)
      : {
          _tag: "ColorFunction",
          space: "srgb",
          channels: Mix.toSpace({ space, channels, alpha }, "srgb").channels,
          alpha,
        };
  }
  return { _tag: "ColorFunction", space, channels, alpha };
};

const polarSrgb = (
  space: "hsl" | "hwb",
  [hue, second, third]: readonly [Channel, Channel, Channel],
  alpha: Channel,
): Color =>
  space === "hsl"
    ? { _tag: "Hsl", hue, saturation: second, lightness: third, alpha }
    : { _tag: "Hwb", hue, whiteness: second, blackness: third, alpha };

/** A `color-mix()` resolved to a colour, or `None` when a colour in it has no value of its own. */
const resolveMix = (mix: {
  readonly space: InterpolationSpace;
  readonly hue: HueMethod;
  readonly colors: ReadonlyArray<MixComponent>;
}): Option.Option<Color> => {
  const percentages = fillPercentages(mix.colors);
  return Option.flatMap(Option.all(mix.colors.map(({ color }) => working(color))), (colors) => {
    const parts = colors.map((color, index) => ({
      color: Mix.toSpace(color, mix.space),
      percentage: percentages[index] ?? 0,
    }));
    return Arr.isReadonlyArrayNonEmpty(parts)
      ? Option.some(fromWorking(Mix.mix(parts, mix.hue)))
      : Option.none();
  });
};

/**
 * Resolves every `color-mix()` in a colour to the colour it computes to
 * (CSS Color 5 §3.2): each colour converted to the interpolation space,
 * a missing component carried forward to its analogue (and an achromatic
 * colour's hue treated as missing), then interpolated with premultiplied
 * alpha and the hue method, two colours at a time. The result is in the
 * interpolation space (`color(srgb …)` for `srgb`, `hsl` and `hwb`). Any
 * other colour comes back as it is. `None` for a mix of a colour with no
 * value of its own (`currentcolor`, `light-dark()`, a custom colour
 * space).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Color } from "@thomasfosterau/effect-css"
 *
 * const mixed = Option.flatMap(Color.parse("color-mix(in srgb, red 25%, blue)"), Color.resolve)
 * console.log(Option.map(mixed, Color.serialize)) // Option.some("color(srgb 0.25 0 0.75)")
 * ```
 *
 * @since 0.1.0
 * @category converting
 */
export const resolve = (color: Color): Option.Option<Color> =>
  Predicate.isTagged(color, "ColorMix") ? resolveMix(color) : Option.some(color);
