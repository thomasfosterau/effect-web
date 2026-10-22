---
"@thomasfosterau/effect-web": patch
"@thomasfosterau/effect-robots": patch
---

Internal refactors for the Effect lint preset, with no change in behaviour: `memoryCacheStorage` keeps its entries in insertion-ordered arrays instead of `Map`s, `appendVary` no longer builds a `Set`, and the service-worker event lifetime waits on its background fiber without running a second effect.
