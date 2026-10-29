# @thomasfosterau/effect-css

CSS for [Effect](https://effect.website): the [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/) tokenizer and parser (a `style` attribute's declarations, stylesheets, rules, component values) with error recovery, typed [CSS Color 4](https://www.w3.org/TR/css-color-4/) colours with conversion to sRGB, and [CSS Values 4](https://www.w3.org/TR/css-values-4/) lengths. Checked against the [css-parsing-tests](https://github.com/SimonSapin/css-parsing-tests) suite.

```sh
pnpm add @thomasfosterau/effect-css effect
```

```ts
import * as Option from "effect/Option";
import { Color, Length, Syntax } from "@thomasfosterau/effect-css";

for (const item of Syntax.parseDeclarationList(
  "color: oklch(70% 0.1 200); margin-left: 12pt !important",
)) {
  if (item._tag !== "Declaration") continue; // a SyntaxError: { kind, offset }
  const [value] = item.value.filter((component) => component._tag !== "Whitespace");
  if (value === undefined) continue;
  if (item.name === "color") Color.parse(value).pipe(Option.flatMap(Color.toSrgb)); // Option.some({ red, green, blue, alpha })
  if (item.name === "margin-left") Length.parse(value).pipe(Option.flatMap(Length.toPixels)); // Option.some(16)
}
```

## `Syntax`

| Export | Specification entry point |
| --- | --- |
| `parseDeclarationList(css)` | Parse a list of declarations (a `style` attribute): `Declaration`s and `AtRule`s, with `SyntaxError` items for what was skipped. |
| `parseStylesheet(css)`, `parseRuleList(css)` | A stylesheet (CDO / CDC skipped at the top level) or a list of rules: `QualifiedRule`s and `AtRule`s, block contents as component values. |
| `parseRule(css)`, `parseDeclaration(css)`, `parseComponentValue(css)` | Exactly one, or a `SyntaxError` (`empty`, `invalid`, `extra-input`). |
| `parseBlockContents(css)` | A block's contents with CSS nesting (the editor's draft's "parse a block's contents"): `Declaration`s, `AtRule`s and nested `QualifiedRule`s in order; something like `a:hover {…}` that is not a declaration is a rule. |
| `parseComponentValueList(css)` | The input as component values: tokens, `Func`s and `Block`s. |

A `SyntaxError` carries `offset`, the code-point offset in the preprocessed input (CRLF counted as one). The token and component-value types are in `Token`.

The parsers take text, not bytes. To parse a stylesheet fetched as bytes, decode it first, for example with [`@thomasfosterau/effect-encoding`](https://www.npmjs.com/package/@thomasfosterau/effect-encoding). Pass it the encoding Syntax 3 §3.2 would pick: the protocol's `charset`, then an `@charset` rule, then the referring document's encoding, then UTF-8. A byte-order mark overrides that encoding, which is the decoder's default BOM sniff.

```ts
import * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-encoding";
import { Syntax } from "@thomasfosterau/effect-css";

const bytes = new Uint8Array([
  0x70, 0x20, 0x7b, 0x20, 0x63, 0x6f, 0x6c, 0x6f, 0x72, 0x3a, 0x20, 0x72, 0x65, 0x64, 0x20, 0x7d,
]);
const rules = await Effect.runPromise(
  Effect.map(Encoding.decode(bytes, { encoding: "UTF-8" }), Syntax.parseStylesheet),
);
```

## `AnPlusB`

`AnPlusB.parse(cssOrComponentValues)` reads the `An+B` microsyntax (Syntax 3 §6) of `:nth-child()` and its relatives into `[a, b]`: `odd`, `even`, an integer, or `An` with an optional `+ B` / `- B` (`2n+1`, `-n + 3`, `+N-2`), case-insensitive, whitespace allowed around the sign but not inside `+n` or a number.

## `Color`

`Color.parse(cssOrComponentValue)` takes named colours, `transparent`, `currentcolor`, hex (3, 4, 6, 8 digits), `rgb()` / `rgba()` / `hsl()` / `hsla()` in both comma and space syntaxes, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` and `color()` in the predefined spaces (`srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz`, `xyz-d50`, `xyz-d65`), with `none` and angle units. The result is a tagged `Color` (a named colour is `Named`, keeping its name; `hsl()` and `hwb()` keep their own channels, `none` included, as `Hsl` and `Hwb`); `Color.serialize` prints its specified value as today's CSS Color 4 does: a named colour as its name, hex, `rgb()`, `hsl()` and `hwb()` as `rgb()` / `rgba()` with integer channels, except that a `none` channel stays (`rgb()` as `color(srgb …)`, `hsl()` and `hwb()` as themselves), and `lab()`-family lightness clamped, and `Color.toSrgb` converts it to sRGB (0 to 1, not gamut-mapped). From [CSS Color 5](https://www.w3.org/TR/css-color-5/): `device-cmyk()` (space and legacy comma syntaxes, channels clamped to [0, 1], serialised as `color(device-cmyk …)`, converted to sRGB naively), `color()` in a custom `--name` space (channels kept as written, no sRGB without its `@color-profile`) `light-dark()` (both colours kept; no sRGB, since which applies depends on the used colour scheme) and `color-mix()` (an optional `in <space> [<method> hue]`, `oklab` by default, then one or more colours with optional percentages from 0% to 100%; kept as written and serialised as its specified value, with the default method left out and the percentages filled in, or left out when all equal and summing to 100%; not yet resolved to a colour, so no sRGB, see [#184](https://github.com/thomasfosterau/effect-web/issues/184)). The `color-mix()` vectors of web-platform-tests' `css/css-color/parsing` (valid and invalid) run in `tests/color-mix.test.ts`.

## `Length`

`Length.parse` takes a dimension in a length unit (absolute `px cm mm q in pt pc`, and the font- and viewport-relative ones), a percentage, or a unitless `0`; `toPixels` and `convert` handle the absolute units (1in = 96px = 72pt), `serialize` prints it back. `parse` also takes a `calc()` that simplifies to one unit (`calc(1in + 10px)` is `106px`); `parseSum` returns any `calc()` of lengths and percentages simplified to one term per unit (CSS Values 4 §10: `+` and `-` with whitespace around them, `*` by a number, `/` by a non-zero number, nested parentheses), with the absolute units folded into `px`, and `serializeSum` writes it back (`calc(50% - 1em)`).

## `Shorthand`

`Shorthand.expand(declaration)` expands a box shorthand into its longhands, keeping `!important`: `margin`, `padding` and `inset` by the 1 to 4 values rule, `border-width` / `-style` / `-color` likewise, and `border` / `border-top` (and the other sides) into each side's `-width`, `-style` and `-color`, in any order, with an omitted part at its initial value (`medium`, `none`, `currentcolor`). A CSS-wide keyword goes to every longhand. `None` for an invalid value or one holding `var()`. `Shorthand.isShorthand(name)` says whether a property is one of these.

## `Font`

`Font.parse` reads the `font` shorthand (CSS Fonts 4 §2.8): optional style (an oblique angle included), `small-caps`, weight and width keywords in any order, each at most once and `normal` standing for any of them, then the size, an optional `/ line-height` and the family list; or a system font keyword (`caption`, `menu`, …) alone. What it leaves out takes its initial value. `parseFamily`, `parseWeight` (`normal` is 400, `bold` 700, or 1 to 1000, `bolder`, `lighter`), `parseStyle`, `parseSize` and `parseLineHeight` read the longhands. A family name made of identifiers may not start with a generic or CSS-wide keyword; quote it.

```ts
import * as Option from "effect/Option";
import { Font } from "@thomasfosterau/effect-css";

const font = Font.parse('italic bold 12px/1.5 "Fira Sans", serif');
// Option.some({ _tag: "Font", style: { _tag: "Italic" }, weight: 700, lineHeight: { _tag: "Number", value: 1.5 }, … })
```

## `Text`

`Text.parseAlign` (`text-align`), `parseVerticalAlign` (a keyword, or a length or percentage), and `text-decoration`: `parseDecoration` reads the shorthand (a line, a style, a colour and a thickness, each at most once and in any order, with `currentcolor` as `None`), and `parseDecorationLine`, `parseDecorationStyle` and `parseDecorationThickness` the longhands.

## `Serialize`

Writes parsed CSS back as text. `identifier`, `string` and `url` follow CSSOM's rules (`Serialize.identifier("1st")` is `\31 st`); `componentValues` follows CSS Syntax 3 §9, keeping each number's written form and putting `/**/` between two tokens that would otherwise tokenize as one; `declaration` and `declarationList` write a `style` attribute the way CSSOM does (`color: red; margin: 0 auto !important;`). Parsing the output gives back the same component values, less comments and whitespace runs; the round trip is tested over every css-parsing-tests input.

```ts
import { Serialize, Syntax } from "@thomasfosterau/effect-css";

Serialize.declarationList(Syntax.parseDeclarationList("color:red;;margin : 0 auto"));
// "color: red; margin: 0 auto;"
```

## Not yet

The other math functions (`min()`, `max()`, `clamp()`, …), and resolving a `color-mix()` to a colour ([#184](https://github.com/thomasfosterau/effect-web/issues/184)).

## Licence

MIT. Test vectors from css-parsing-tests (CC0).
