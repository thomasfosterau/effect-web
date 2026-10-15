---
"@thomasfosterau/effect-web": minor
---

Add the `./browser` and `./testing` entries.

`./browser` wraps browser platform APIs as Effect services, each with a `make` over a structural slice of the platform object, a live `layer` that degrades where the API is missing, a tagged error and accessors: `Locks` (Web Locks — a lock held for a `Scope`, `withLock` / `withLockIfAvailable`, steal detection), `Navigator` (connectivity, languages, network information, user activation, Web Share, `sendBeacon`, vibration, storage persistence), `PageVisibility` (`whileVisible`), `MediaQuery` (preference streams), `WakeLock` (`keepAwake`, `keepAwakeWhileVisible`), `Broadcast` (schema-typed `BroadcastChannel`) and `PermissionStatus` (permission state as a stream over `@effect/platform-browser`'s `Permissions`), plus one `layer` with every live service.

`./testing` provides an in-memory double for every `./browser` service and for `@effect/platform-browser`'s `Clipboard`, `Geolocation` and `Permissions` — each the real adapter over an in-memory platform object, with a `Control` service to drive it — a combined `layer`, and `observe` for race-free stream assertions.

`@effect/platform-browser` (>= 4.0.0) is a new optional peer, needed only by these two entries.
