/**
 * `@thomasfosterau/effect-css` — CSS on Effect.
 *
 * - `Syntax` — CSS Syntax Level 3: parse a `style` attribute's
 *   declarations, a stylesheet, a rule, a declaration or a component
 *   value, recovering from errors as the specification requires.
 * - `Token` — the tokens and component values the parser produces.
 * - `Color` — CSS Color 4 values, typed, serialised and converted to sRGB.
 * - `Length` — CSS Values 4 lengths, with absolute-unit conversion.
 * - `AnPlusB` — the `An+B` microsyntax of `:nth-child()` and its relatives.
 * - `Shorthand` — the box shorthands (`margin`, `padding`, `inset`,
 *   `border` and its parts) expanded to their longhands.
 * - `Font` — CSS Fonts 4 values and the `font` shorthand.
 * - `Text` — `text-align`, `vertical-align` and `text-decoration` values.
 *
 * @since 0.1.0
 */
export * as AnPlusB from "./an-plus-b.ts";
export * as Color from "./color.ts";
export * as Font from "./font.ts";
export * as Length from "./length.ts";
export * as Shorthand from "./shorthand.ts";
export * as Syntax from "./syntax.ts";
export * as Text from "./text.ts";
export * as Token from "./token.ts";
