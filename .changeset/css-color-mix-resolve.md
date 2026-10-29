---
"@thomasfosterau/effect-css": minor
---

`Color.resolve` computes a `color-mix()` to the colour it stands for (CSS Color 5 §3.2):

- Each colour is converted to the interpolation space.
- A missing component is carried forward to its analogue, and an achromatic colour's hue is treated as missing.
- The colours are interpolated two at a time, with premultiplied alpha and the hue method. Alpha is scaled when the percentages sum to under 100%.

The result is in the interpolation space: `color(srgb …)` for `srgb`, `hsl` and `hwb`, or the space's own function. `Color.toSrgb` now converts a mix through its resolved colour, where it returned `None` before. A mix that contains `currentcolor`, `light-dark()` or a custom colour space still has no resolved colour.
