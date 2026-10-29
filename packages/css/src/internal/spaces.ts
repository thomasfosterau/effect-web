/**
 * Colour space conversions for `color-mix()` resolution: every
 * interpolation space to and from CIE XYZ (D65), with the sample
 * algorithms and matrices of CSS Color 4 §18. Channels are plain numbers
 * here; `none` is handled by the caller. The inverse matrices are the
 * forward ones inverted at double precision, written as literals so that
 * nothing runs at import.
 */

/** Three channels. */
export type Vector = readonly [number, number, number];
type Matrix = readonly [Vector, Vector, Vector];

const multiply = (m: Matrix, v: Vector): Vector => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const mapVector = (v: Vector, f: (x: number) => number): Vector => [f(v[0]), f(v[1]), f(v[2])];

const signed = (value: number, f: (magnitude: number) => number): number =>
  Math.sign(value) * f(Math.abs(value));

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
const XYZ_TO_LINEAR_P3: Matrix = [
  [2.493496911941425, -0.9313836179191235, -0.4027107844507168],
  [-0.8294889695615749, 1.7626640603183465, 0.0236246858419436],
  [0.03584583024378437, -0.07617238926804179, 0.9568845240076872],
];
const XYZ_TO_LINEAR_A98: Matrix = [
  [2.0415879038107456, -0.5650069742788595, -0.3447313507783295],
  [-0.9692436362808797, 1.8759675015077204, 0.041555057407175605],
  [0.01344428063203103, -0.11836239223101822, 1.0151749943912054],
];
const XYZ_D50_TO_LINEAR_PROPHOTO: Matrix = [
  [1.3457868816471585, -0.2555720873797947, -0.05110186497554526],
  [-0.544630705124902, 1.508247742845147, 0.020527447436421407],
  [0.0, 0.0, 1.2119675456389452],
];
const XYZ_TO_LINEAR_REC2020: Matrix = [
  [1.7166511879712674, -0.35567078377639233, -0.25336628137365974],
  [-0.6666843518324893, 1.6164812366349395, 0.015768545813911156],
  [0.01763985744531087, -0.04277061325780854, 0.9421031212354738],
];
const D65_TO_D50: Matrix = [
  [1.0479297925449966, 0.02294687060160972, -0.05019226628920525],
  [0.029627808770055795, 0.9904344267538799, -0.01707379906341881],
  [-0.009243040646204521, 0.015055191490298145, 0.751874281428137],
];
const LMS_TO_OKLAB: Matrix = [
  [0.21045426830931405, 0.7936177747023053, -0.004072043011619287],
  [1.9779985324311686, -2.42859224204858, 0.45059370961741113],
  [0.02590404246554774, 0.7827717124575299, -0.8086757549230776],
];
const XYZ_TO_LMS: Matrix = [
  [0.8190224379967029, 0.36190626005289034, -0.1288737815209879],
  [0.03298365393238843, 0.9292868615863434, 0.036144666350642396],
  [0.04817718935962421, 0.2642395317527308, 0.6335478284694309],
];

/** The D50 white point, as XYZ. */
const D50: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;

const labToXyzD50 = ([l, a, b]: Vector): Vector => {
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > EPSILON ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = l > KAPPA * EPSILON ? f1 ** 3 : l / KAPPA;
  const z = f2 ** 3 > EPSILON ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return [x * D50[0], y * D50[1], z * D50[2]];
};

const xyzD50ToLab = (xyz: Vector): Vector => {
  const [fx, fy, fz] = mapVector([xyz[0] / D50[0], xyz[1] / D50[1], xyz[2] / D50[2]], (value) =>
    value > EPSILON ? Math.cbrt(value) : (KAPPA * value + 16) / 116,
  );
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const oklabToXyz = (lab: Vector): Vector =>
  multiply(
    LMS_TO_XYZ,
    mapVector(multiply(OKLAB_TO_LMS, lab), (value) => value ** 3),
  );

const xyzToOklab = (xyz: Vector): Vector =>
  multiply(LMS_TO_OKLAB, mapVector(multiply(XYZ_TO_LMS, xyz), Math.cbrt));

/** Polar (lightness, chroma, hue in degrees) to rectangular (lightness, a, b). */
const fromPolar = ([l, c, h]: Vector): Vector => [
  l,
  c * Math.cos((h * Math.PI) / 180),
  c * Math.sin((h * Math.PI) / 180),
];

/** Rectangular to polar, the hue in [0, 360). */
const toPolar = ([l, a, b]: Vector): Vector => {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [l, Math.sqrt(a ** 2 + b ** 2), ((hue % 360) + 360) % 360];
};

/** CSS Color 4 §7.1 `hslToRgb`: hue in degrees, saturation and lightness per 1%, to [0, 1]. */
export const hslToSrgb = ([h, s, l]: Vector): Vector => {
  const saturation = s / 100;
  const lightness = l / 100;
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};

/** CSS Color 4 §7.2 `rgbToHsl`. */
const srgbToHsl = ([red, green, blue]: Vector): Vector => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (min + max) / 2;
  const d = max - min;
  // A difference within rounding noise is a grey (a colour converted from another space rarely is exactly).
  const saturation =
    d < 1e-5 || lightness === 0 || lightness === 1
      ? 0
      : (max - lightness) / Math.min(lightness, 1 - lightness);
  const hue = d < 1e-5 ? 0 : hueOf(red, green, blue, max, d);
  // A negative saturation (out of gamut) flips the hue.
  return saturation < 0
    ? [(hue + 180) % 360, -saturation * 100, lightness * 100]
    : [hue, saturation * 100, lightness * 100];
};

const hueOf = (red: number, green: number, blue: number, max: number, d: number): number => {
  const raw =
    max === red
      ? (green - blue) / d + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / d + 2
        : (red - green) / d + 4;
  return (((raw * 60) % 360) + 360) % 360;
};

/** CSS Color 4 §8.1 `hwbToRgb`. */
export const hwbToSrgb = ([h, w, b]: Vector): Vector => {
  const white = w / 100;
  const black = b / 100;
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  return mapVector(hslToSrgb([h, 100, 50]), (channel) => channel * (1 - white - black) + white);
};

/** CSS Color 4 §8.2 `rgbToHwb`. */
const srgbToHwb = (rgb: Vector): Vector => {
  const [hue] = srgbToHsl(rgb);
  const white = Math.min(...rgb);
  const black = 1 - Math.max(...rgb);
  return [hue, white * 100, black * 100];
};

const REC2020_ALPHA = 1.09929682680944;
const REC2020_BETA = 0.018053968510807;

const a98ToLinear = (x: number): number => signed(x, (m) => m ** (563 / 256));
const linearToA98 = (x: number): number => signed(x, (m) => m ** (256 / 563));
const prophotoToLinear = (x: number): number =>
  signed(x, (m) => (m <= 16 / 512 ? m / 16 : m ** 1.8));
const linearToProphoto = (x: number): number =>
  signed(x, (m) => (m >= 1 / 512 ? m ** (1 / 1.8) : 16 * m));
const rec2020ToLinear = (x: number): number =>
  signed(x, (m) =>
    m < REC2020_BETA * 4.5 ? m / 4.5 : ((m + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45),
  );
const linearToRec2020 = (x: number): number =>
  signed(x, (m) => (m > REC2020_BETA ? REC2020_ALPHA * m ** 0.45 - (REC2020_ALPHA - 1) : 4.5 * m));

/** The interpolation spaces `color-mix()` takes, `xyz` as `xyz-d65`. */
export type Space =
  | "srgb"
  | "srgb-linear"
  | "display-p3"
  | "display-p3-linear"
  | "a98-rgb"
  | "prophoto-rgb"
  | "rec2020"
  | "xyz-d50"
  | "xyz-d65"
  | "lab"
  | "oklab"
  | "lch"
  | "oklch"
  | "hsl"
  | "hwb";

interface Conversion {
  readonly toXyz: (channels: Vector) => Vector;
  readonly fromXyz: (xyz: Vector) => Vector;
}

const fromSrgbXyz = (xyz: Vector): Vector =>
  mapVector(multiply(XYZ_TO_LINEAR_SRGB, xyz), linearToSrgb);
const srgbToXyz = (rgb: Vector): Vector =>
  multiply(LINEAR_SRGB_TO_XYZ, mapVector(rgb, srgbToLinear));

/** Each space's channels to and from XYZ D65. */
const CONVERSIONS = {
  srgb: { toXyz: srgbToXyz, fromXyz: fromSrgbXyz },
  "srgb-linear": {
    toXyz: (c) => multiply(LINEAR_SRGB_TO_XYZ, c),
    fromXyz: (xyz) => multiply(XYZ_TO_LINEAR_SRGB, xyz),
  },
  "display-p3": {
    toXyz: (c) => multiply(LINEAR_P3_TO_XYZ, mapVector(c, srgbToLinear)),
    fromXyz: (xyz) => mapVector(multiply(XYZ_TO_LINEAR_P3, xyz), linearToSrgb),
  },
  "display-p3-linear": {
    toXyz: (c) => multiply(LINEAR_P3_TO_XYZ, c),
    fromXyz: (xyz) => multiply(XYZ_TO_LINEAR_P3, xyz),
  },
  "a98-rgb": {
    toXyz: (c) => multiply(LINEAR_A98_TO_XYZ, mapVector(c, a98ToLinear)),
    fromXyz: (xyz) => mapVector(multiply(XYZ_TO_LINEAR_A98, xyz), linearToA98),
  },
  "prophoto-rgb": {
    toXyz: (c) =>
      multiply(D50_TO_D65, multiply(LINEAR_PROPHOTO_TO_XYZ_D50, mapVector(c, prophotoToLinear))),
    fromXyz: (xyz) =>
      mapVector(multiply(XYZ_D50_TO_LINEAR_PROPHOTO, multiply(D65_TO_D50, xyz)), linearToProphoto),
  },
  rec2020: {
    toXyz: (c) => multiply(LINEAR_REC2020_TO_XYZ, mapVector(c, rec2020ToLinear)),
    fromXyz: (xyz) => mapVector(multiply(XYZ_TO_LINEAR_REC2020, xyz), linearToRec2020),
  },
  "xyz-d50": {
    toXyz: (c) => multiply(D50_TO_D65, c),
    fromXyz: (xyz) => multiply(D65_TO_D50, xyz),
  },
  "xyz-d65": { toXyz: (c) => c, fromXyz: (xyz) => xyz },
  lab: {
    toXyz: (c) => multiply(D50_TO_D65, labToXyzD50(c)),
    fromXyz: (xyz) => xyzD50ToLab(multiply(D65_TO_D50, xyz)),
  },
  lch: {
    toXyz: (c) => multiply(D50_TO_D65, labToXyzD50(fromPolar(c))),
    fromXyz: (xyz) => toPolar(xyzD50ToLab(multiply(D65_TO_D50, xyz))),
  },
  oklab: { toXyz: oklabToXyz, fromXyz: xyzToOklab },
  oklch: {
    toXyz: (c) => oklabToXyz(fromPolar(c)),
    fromXyz: (xyz) => toPolar(xyzToOklab(xyz)),
  },
  hsl: {
    toXyz: (c) => srgbToXyz(hslToSrgb(c)),
    fromXyz: (xyz) => srgbToHsl(fromSrgbXyz(xyz)),
  },
  hwb: {
    toXyz: (c) => srgbToXyz(hwbToSrgb(c)),
    fromXyz: (xyz) => srgbToHwb(fromSrgbXyz(xyz)),
  },
} satisfies { readonly [S in Space]: Conversion };

/** Channels from one space to another, through XYZ D65; the same space is no change. */
export const convert = (from: Space, to: Space, channels: Vector): Vector =>
  from === to ? channels : CONVERSIONS[to].fromXyz(CONVERSIONS[from].toXyz(channels));
