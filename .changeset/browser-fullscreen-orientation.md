---
"@thomasfosterau/effect-web": minor
---

Add `Fullscreen` and `ScreenOrientation` to `./browser`, with `TestFullscreen` and `TestScreenOrientation` in `./testing`.

`Fullscreen` shows an element fullscreen for a `Scope` (`enter`; closing the scope leaves fullscreen only if that element is still the fullscreen one), with the `withFullscreen` combinator, the fullscreen `element` and its `changes`. Failures are a `FullscreenError` (`Unsupported`, `NotAllowed`, `Failed`). `ScreenOrientation` reads `type` / `angle` / `current`, follows `changes`, and locks the orientation for a `Scope` (`lock`, `withLock`, which composes inside `withFullscreen`). Failures are an `OrientationError` (`Unsupported`, `NotAllowed`, `Aborted`, `Failed`). Both combined `layer`s include the new services.
