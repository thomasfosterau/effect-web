---
"@thomasfosterau/effect-web": patch
"@thomasfosterau/effect-langtag": patch
"@thomasfosterau/effect-uri-template": patch
---

Tidy the emitted declarations after enabling type-aware linting: optional parameters drop a redundant `| undefined` (an optional parameter already accepts `undefined`), and `Stream.EventListener<unknown>` is written as `Stream.EventListener`, its default. No type changes for callers.
