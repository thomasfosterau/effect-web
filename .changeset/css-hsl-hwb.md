---
"@thomasfosterau/effect-css": minor
---

Breaking: `Color.parse` returns `hsl()` and `hwb()` colours as the new `Hsl` and `Hwb` variants (exported channel types `HslChannels` and `HwbChannels`), not as `Rgb`. Their channels are kept as written, `none` included, so a `color-mix()` can carry a missing component forward. `Color.serialize` and `Color.toSrgb` give the same results as before. Code that matched on `_tag: "Rgb"` for an `hsl()` or `hwb()` input must handle the new tags.
