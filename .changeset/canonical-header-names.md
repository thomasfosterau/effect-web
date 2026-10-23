---
"@thomasfosterau/effect-web": patch
---

`applyToWebHeaders` and `updateWebHeaders` now write each header a policy adds or changes under its canonical spelling (`X-Frame-Options`, `Referrer-Policy`, `ETag`), not the lower-cased key `effect/http` `Headers` use. A runtime that sends a header name as it was set (workerd on HTTP/1.1) no longer changes the wire spelling when an app adopts these adapters.
