---
"@thomasfosterau/effect-web": patch
---

`describeError` no longer renders an untagged error with an empty `message` as `"[object Object]"`: it renders as the value's `name` (`new Error("")` → `"Error"`), or as `""` when there is none (`{ message: "" }`). It also reads `message` off an array, as it does off an object.
