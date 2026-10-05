---
"@thomasfosterau/effect-web": patch
---

Documentation: doc comments now cite each invariant id on the export that enforces it, and the `effect-web/net` description of the plain `Promise` / `Error` adapters is corrected: they throw or reject with a plain `Error` carrying the failure's message, or a `fetch` failure's original cause. No code changes.
