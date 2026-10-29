---
"@thomasfosterau/effect-css": minor
---

`Color.parse` reads Color 5's `color-mix()` into a `ColorMix` colour: the interpolation method (`oklab` by default, a hue method on a polar space) and each colour with its optional percentage. `Color.serialize` writes its specified value as CSS Color 5 does. A mix is not resolved yet, so `Color.toSrgb` returns `None` for it. `color()` also takes the `display-p3-linear` space.
