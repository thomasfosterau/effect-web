---
"@thomasfosterau/effect-web": patch
---

`effect-web/net`: the plain adapters now attach the tagged failure as the `cause` of the plain `Error` they throw or reject with. `assertAllowedUrl` throws `new Error(message, { cause: unsafeUrl })`, and `fetchFollowingRedirects` rejects with `new Error(message, { cause })` for an `UnsafeUrl` or `RedirectRejected`, so a plain caller can read `reason` and `url` without running Effect. The message wording and the plain-`Error` prototype are unchanged, and a `fetch` failure still rejects with the original `fetch` cause.
