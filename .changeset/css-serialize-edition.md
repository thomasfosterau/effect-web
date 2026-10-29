---
"@thomasfosterau/effect-css": minor
---

Breaking: `Color.serialize` writes today's CSS Color 4 / 5 specified values, not the 2021 edition's.

- A named colour keeps its name (`red`, `transparent`) through a new `Named` variant of `Color`. It no longer becomes `Rgb`.
- Hex, `rgb()`, `hsl()` and `hwb()` print `rgb()` / `rgba()` with integer channels (`rgba(255, 128, 0, 0.5)`, not `127.5`).
- An `rgb()` with a `none` channel parses to `color(srgb …)` and keeps it there. An `hsl()` or `hwb()` with one prints as itself (`hsl(none 50% 50%)`).
- `lab()` / `lch()` / `oklab()` / `oklch()` lightness is clamped at parse time, and a negative chroma is 0.
