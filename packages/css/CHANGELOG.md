# @thomasfosterau/effect-css

## 0.1.0

### Minor Changes

- [#167](https://github.com/thomasfosterau/effect-web/pull/167) [`18d055f`](https://github.com/thomasfosterau/effect-web/commit/18d055fd1e3ce85bc7dc5694d66d5c7605c6fff8) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - New package `@thomasfosterau/effect-css`: the CSS Syntax Level 3 tokenizer and parser (`Syntax.parseDeclarationList` for `style` attributes, `parseStylesheet`, `parseRuleList`, `parseRule`, `parseDeclaration`, `parseComponentValue`, `parseComponentValueList`) with recoverable, positioned `SyntaxError`s; `Color`, CSS Color 4 `<color>` parsing (named, hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`), serialisation and conversion to sRGB; and `Length`, CSS Values 4 lengths with absolute-unit conversion. Checked against the css-parsing-tests suite.
