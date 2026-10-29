---
"@thomasfosterau/effect-css": minor
---

New `Shorthand` module: `Shorthand.expand` expands `margin`, `padding`, `inset`, `border`, `border-top` (and the other sides), `border-width`, `border-style` and `border-color` declarations into their longhands (the 1 to 4 values rule; `border` parts in any order, omitted ones at their initial value; CSS-wide keywords to every longhand; `!important` kept), and `Shorthand.isShorthand` names them.
