---
"@thomasfosterau/effect-web": patch
---

The `cacheFirst`, `networkFirst` and `staleWhileRevalidate` examples run their background cache write inline through `EventLifetime`, instead of sleeping 10 ms and hoping the detached write has landed.
