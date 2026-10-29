---
"@thomasfosterau/effect-css": minor
---

`Serialize` writes parsed CSS back as text: `identifier`, `string` and `url` by CSSOM's rules, `componentValues` by CSS Syntax 3 §9 (numbers keep their written form, and `/**/` goes between tokens that would otherwise merge), and `declaration` / `declarationList` as CSSOM writes a `style` attribute.
