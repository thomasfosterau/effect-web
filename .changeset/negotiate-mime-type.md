---
"@thomasfosterau/effect-web": minor
---

`./negotiate` compares media types as WHATWG MIME types through `@thomasfosterau/effect-mime`'s `MimeType` (now a dependency of `@thomasfosterau/effect-web`) instead of as lower-cased strings: an `Accept` instance and a write's `Content-Type` match `application/vnd.api+json` or `text/markdown` on their parsed essence, so case and HTTP whitespace never decide the verdict, and a `Content-Type` that is not a MIME type carries no media type and falls through as HTML.
