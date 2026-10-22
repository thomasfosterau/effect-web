---
"@thomasfosterau/effect-web": patch
---

Fix `followRedirects` / `fetchFollowingRedirects` following redirects without limit when `maxHops` is negative, `NaN` or fractional. A fraction is now rounded down, and a negative, `NaN` or infinite value reads as `0`, so every `maxHops` bounds the number of requests.
