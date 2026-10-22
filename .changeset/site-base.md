---
"@thomasfosterau/effect-web": minor
---

Add `siteBase({ key, fallback }): Effect<string>`, the canonical site base read from configuration rather than the request origin. It reads `key` through the ambient `ConfigProvider`, normalises the value to an `http(s)` origin with no trailing slash, and never fails: a missing key, a provider error or an invalid value (the last after a `site-base.invalid` warning) yields the application's `fallback`. `normalizeSiteBase(value): Option<string>` exposes the check on its own.
