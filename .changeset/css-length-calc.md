---
"@thomasfosterau/effect-css": minor
---

`Length` takes `calc()`: `Length.parseSum` parses a `calc()` of lengths and percentages (CSS Values 4 §10: `+`, `-`, `*` by a number, `/` by a non-zero number, nested parentheses) into a simplified `Sum`, one term per unit with the absolute units folded into `px`, and `Length.serializeSum` writes it back. `Length.parse` accepts a `calc()` that simplifies to a single unit.
