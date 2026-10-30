# @thomasfosterau/effect-css

## 0.1.0

### Minor Changes

- [#179](https://github.com/thomasfosterau/effect-web/pull/179) [`b795806`](https://github.com/thomasfosterau/effect-web/commit/b795806a8832b8133adc98258da971b53303aa6b) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Syntax.parseBlockContents` parses a block's contents with CSS nesting (declarations, at-rules and nested qualified rules in order), and the new `AnPlusB` module parses the `An+B` microsyntax of `:nth-child()` into `[a, b]`. Both are checked against css-parsing-tests' `blocks_contents.json` and `An+B.json`.

- [#181](https://github.com/thomasfosterau/effect-web/pull/181) [`a8b893a`](https://github.com/thomasfosterau/effect-web/commit/a8b893a844ec8245db65a55e50bf2128c2cfc70e) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - New `Shorthand` module: `Shorthand.expand` expands `margin`, `padding`, `inset`, `border`, `border-top` (and the other sides), `border-width`, `border-style` and `border-color` declarations into their longhands (the 1 to 4 values rule; `border` parts in any order, omitted ones at their initial value; CSS-wide keywords to every longhand; `!important` kept), and `Shorthand.isShorthand` names them.

- [#176](https://github.com/thomasfosterau/effect-web/pull/176) [`4436681`](https://github.com/thomasfosterau/effect-web/commit/44366815d3942a69b0b14a85da766f8ef96bd3bf) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Color` parses CSS Color 5's `device-cmyk()` (new `DeviceCmyk` variant, serialised as `color(device-cmyk …)`, converted to sRGB naively), `color()` in a custom `--name` colour space (new `CustomColor` variant) and `light-dark()` (new `LightDark` variant holding both colours). Checked against css-parsing-tests' `color_functions_5.json`. Code that matches every `Color` tag exhaustively needs the three new cases.

- [#190](https://github.com/thomasfosterau/effect-web/pull/190) [`c1d82b2`](https://github.com/thomasfosterau/effect-web/commit/c1d82b2d9d04737ed0e7da8137ee187ea0a8f6f1) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Color.resolve` computes a `color-mix()` to the colour it stands for (CSS Color 5 §3.2):

  - Each colour is converted to the interpolation space.
  - A missing component is carried forward to its analogue, and an achromatic colour's hue is treated as missing.
  - The colours are interpolated two at a time, with premultiplied alpha and the hue method. Alpha is scaled when the percentages sum to under 100%.

  The result is in the interpolation space: `color(srgb …)` for `srgb`, `hsl` and `hwb`, or the space's own function. `Color.toSrgb` now converts a mix through its resolved colour, where it returned `None` before. A mix that contains `currentcolor`, `light-dark()` or a custom colour space still has no resolved colour.

- [#185](https://github.com/thomasfosterau/effect-web/pull/185) [`088d597`](https://github.com/thomasfosterau/effect-web/commit/088d5971054f4ae404ac92d9afe74e6be85e6df6) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Color.parse` reads Color 5's `color-mix()` into a `ColorMix` colour: the interpolation method (`oklab` by default, a hue method on a polar space) and each colour with its optional percentage. `Color.serialize` writes its specified value as CSS Color 5 does. A mix is not resolved yet, so `Color.toSrgb` returns `None` for it. `color()` also takes the `display-p3-linear` space.

- [`d9a68a7`](https://github.com/thomasfosterau/effect-web/commit/d9a68a721e12bfeee644d94b553cb259a41a5506) Thanks [@claude](https://github.com/claude)! - Typed font and text values. `Font.parse` reads the `font` shorthand into its longhands (style, variant, weight, width, size, line height and family list), or a system font; `Font.parseFamily`, `parseWeight`, `parseStyle`, `parseSize` and `parseLineHeight` read the longhands. `Text.parseAlign`, `parseVerticalAlign` and `parseDecoration` (with `parseDecorationLine`, `parseDecorationStyle` and `parseDecorationThickness`) read `text-align`, `vertical-align` and `text-decoration`.

- [#187](https://github.com/thomasfosterau/effect-web/pull/187) [`0cbdad8`](https://github.com/thomasfosterau/effect-web/commit/0cbdad87acadb3392ef9db283294f37ff83dc41c) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Breaking: `Color.parse` returns `hsl()` and `hwb()` colours as the new `Hsl` and `Hwb` variants (exported channel types `HslChannels` and `HwbChannels`), not as `Rgb`. Their channels are kept as written, `none` included, so a `color-mix()` can carry a missing component forward. `Color.serialize` and `Color.toSrgb` give the same results as before. Code that matched on `_tag: "Rgb"` for an `hsl()` or `hwb()` input must handle the new tags.

- [`633d034`](https://github.com/thomasfosterau/effect-web/commit/633d034c6a6871a77b8eafa8690bb780dd647c87) Thanks [@claude](https://github.com/claude)! - `Length` takes `calc()`: `Length.parseSum` parses a `calc()` of lengths and percentages (CSS Values 4 §10: `+`, `-`, `*` by a number, `/` by a non-zero number, nested parentheses) into a simplified `Sum`, one term per unit with the absolute units folded into `px`, and `Length.serializeSum` writes it back. `Length.parse` accepts a `calc()` that simplifies to a single unit.

- [#167](https://github.com/thomasfosterau/effect-web/pull/167) [`18d055f`](https://github.com/thomasfosterau/effect-web/commit/18d055fd1e3ce85bc7dc5694d66d5c7605c6fff8) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - New package `@thomasfosterau/effect-css`: the CSS Syntax Level 3 tokenizer and parser (`Syntax.parseDeclarationList` for `style` attributes, `parseStylesheet`, `parseRuleList`, `parseRule`, `parseDeclaration`, `parseComponentValue`, `parseComponentValueList`) with recoverable, positioned `SyntaxError`s; `Color`, CSS Color 4 `<color>` parsing (named, hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`), serialisation and conversion to sRGB; and `Length`, CSS Values 4 lengths with absolute-unit conversion. Checked against the css-parsing-tests suite.

- [#188](https://github.com/thomasfosterau/effect-web/pull/188) [`6387a89`](https://github.com/thomasfosterau/effect-web/commit/6387a899e316e6f2344e973c6ee28a52c1764208) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Breaking: `Color.serialize` writes today's CSS Color 4 / 5 specified values, not the 2021 edition's.

  - A named colour keeps its name (`red`, `transparent`) through a new `Named` variant of `Color`. It no longer becomes `Rgb`.
  - Hex, `rgb()`, `hsl()` and `hwb()` print `rgb()` / `rgba()` with integer channels (`rgba(255, 128, 0, 0.5)`, not `127.5`).
  - An `rgb()` with a `none` channel parses to `color(srgb …)` and keeps it there. An `hsl()` or `hwb()` with one prints as itself (`hsl(none 50% 50%)`).
  - `lab()` / `lch()` / `oklab()` / `oklch()` lightness is clamped at parse time, and a negative chroma is 0.

- [`31f88de`](https://github.com/thomasfosterau/effect-web/commit/31f88de3110575a00ec41b8be95789ad9592b6d0) Thanks [@claude](https://github.com/claude)! - `Serialize` writes parsed CSS back as text: `identifier`, `string` and `url` by CSSOM's rules, `componentValues` by CSS Syntax 3 §9 (numbers keep their written form, and `/**/` goes between tokens that would otherwise merge), and `declaration` / `declarationList` as CSSOM writes a `style` attribute.
