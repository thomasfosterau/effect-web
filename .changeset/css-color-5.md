---
"@thomasfosterau/effect-css": minor
---

`Color` parses CSS Color 5's `device-cmyk()` (new `DeviceCmyk` variant, serialised as `color(device-cmyk …)`, converted to sRGB naively), `color()` in a custom `--name` colour space (new `CustomColor` variant) and `light-dark()` (new `LightDark` variant holding both colours). Checked against css-parsing-tests' `color_functions_5.json`. Code that matches every `Color` tag exhaustively needs the three new cases.
