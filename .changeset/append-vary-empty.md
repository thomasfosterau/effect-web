---
"@thomasfosterau/effect-web": patch
---

`appendVary` treats an empty or whitespace-only `Vary` as absent: `appendVary(Headers.fromInput({ vary: "" }), ["Cookie", "Accept"])` now gives `Cookie, Accept`, not `, Cookie, Accept`.
