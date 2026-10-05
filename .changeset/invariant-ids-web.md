---
"@thomasfosterau/effect-web": patch
---

Documentation: doc comments now cite each invariant id on the export that enforces it, and the `effect-web/net` description states that the plain `Promise` / `Error` adapters throw or reject with a plain `Error` carrying the failure's message, or with a `fetch` failure's original cause. No code changes.
