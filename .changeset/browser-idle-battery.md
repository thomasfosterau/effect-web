---
"@thomasfosterau/effect-web": minor
---

Add `IdleDetection` and `Battery` to `./browser`, with `TestIdleDetection` and `TestBattery` in `./testing`.

`IdleDetection` wraps the Chromium-only `IdleDetector`: `requestPermission`, and `watch({ threshold })`, a stream of `{ user, screen }` whose detector is aborted when the stream ends; a threshold under one minute (`minimumThreshold`) fails `InvalidRequest`. Failures are an `IdleError` (`Unsupported`, `NotAllowed`, `InvalidRequest`, `Failed`). `Battery` wraps `navigator.getBattery()` as its own service: `status` (an `Option<BatteryState>`, with unknown times as `None`) and `changes`, both `None` / empty where the API is missing. Both combined `layer`s include the new services.
