---
"@thomasfosterau/effect-web": minor
---

Add `Notifications` to `./browser` and `TestNotifications` to `./testing`.

`Notifications` wraps the page's `Notification` API: `permission` (`None` where unsupported), `requestPermission` (fails `NotAllowed` without transient user activation), `show(title, options)` — a notification held for a `Scope`, closed when it closes, whose `clicks` / `closes` streams replay from the moment it was shown and fail with the browser's `error` — and `permissionChanges`, over `PermissionStatus.changes("notifications")`. Failures are a `NotificationError` whose `reason` is `Unsupported`, `NotAllowed`, `Denied`, `InvalidData` or `Failed`. Both combined `layer`s include the new service.
