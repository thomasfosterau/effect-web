---
"@thomasfosterau/effect-uri-template": minor
---

Add `@thomasfosterau/effect-uri-template`: URI Templates (RFC 6570), Web Linking (RFC 8288) and well-known URIs (RFC 8615).

`UriTemplate.parse` reports a malformed template with its reason and position, and `UriTemplate.expand` covers all four levels: every operator, prefix and explode modifiers, lists and associative arrays. Both are checked against the uritemplate-test suite. `LinkHeader.parse` reads a `Link` header into typed links (resolved against a base, with the RFC 8187 `title*` decoded), `LinkHeader.serialize` writes one, and `findRel` / `filterRel` query by relation type. `WellKnown.url` and `WellKnown.suffixOf` build and recognise `/.well-known/` URLs.
