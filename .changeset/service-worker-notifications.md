---
"@thomasfosterau/effect-web": minor
---

Add persistent notifications to `./service-worker`: the `Registration` context reference (defaulting to the worker's `self.registration`), `showNotification` and `getNotifications` failing with `ShowNotificationError`, and the `notificationClickListener` / `notificationCloseListener` builders, which decode `notification.data` through a schema and run the handler inside `waitUntil`.
