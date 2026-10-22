---
"@thomasfosterau/effect-web": minor
---

Add `isCrossOriginRejectedWeb(request, expectedOrigin = new URL(request.url).origin)`, the SEC-CSRF-001 cross-origin predicate over a Fetch `Request`. `isCrossOriginRejected` is unchanged and still takes an `HttpServerRequest`; its doc comment now warns that a Fetch `Request` cast to it reads no `Origin` and passes every request.
