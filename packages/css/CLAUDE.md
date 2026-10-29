# @thomasfosterau/effect-css

CSS on Effect: `Syntax` (CSS Syntax Level 3 tokenizer and parser entry points, the nesting-aware block contents included), `AnPlusB` (the `An+B` microsyntax), `Token` (tokens and component values), `Color` (CSS Color 4 `<color>` parsing, serialisation and sRGB conversion, plus Color 5's `device-cmyk()`, custom colour spaces and `light-dark()`) and `Length` (CSS Values 4 lengths, absolute-unit conversion).

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `css` allows none) and no platform API. `src/internal/tokenizer.ts` is the tokenizer, `src/internal/named-colors.ts` the named-colour table; nothing outside `src/` imports them.

## Invariants

- **The css-parsing-tests suite is the behavioural spec.** `tests/fixtures/css-parsing-tests/` vendors it (CC0, commit pinned in its README); every syntax and colour vector must pass through the converters in `tests/syntax.test.ts` and `tests/color.test.ts`. It pins the edition the parser follows: the 2021 Syntax 3 candidate recommendation, plus the 2014 `unicode-range`, attribute-matcher and `||` tokens.
- **The tokenizer and parser are transcriptions.** `internal/tokenizer.ts` and `syntax.ts` follow the specification's consume-* algorithms step for step over a cursor; the imperative loops are the algorithm as written (file-level lint disables say so). Restructure them only with the suite green.
- **Errors are recovered from and reported in place**: a list parse yields `SyntaxError` items (`empty`, `invalid`, `extra-input`) with the code-point offset in the preprocessed input; an unterminated string or URL token is flagged `unterminated`. Nothing throws.
- **Colour serialisation is CSS Color 4's**: sRGB-family colours (named, hex, `rgb()`, `hsl()`, `hwb()`) resolve to `Rgb` at parse time (a `none` channel as 0) and print `rgb(r, g, b)` / `rgba(…)`; Lab-family and `color()` keep their space; numbers print with at most six decimals. `toSrgb` does not gamut-map.
- **Nothing runs at import** (`"sideEffects": false`): tables and matrices are literals.

## Terms

- **Component value** — a preserved token, a function or a simple block (§5).
- **Preprocessed input** — the input after §3.3 (CR, FF and CRLF to LF; NUL and lone surrogates to U+FFFD); `SyntaxError` offsets count its code points.
