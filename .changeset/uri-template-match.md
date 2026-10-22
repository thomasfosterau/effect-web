---
"@thomasfosterau/effect-uri-template": minor
---

Add `UriTemplate.matcher` and `UriTemplate.match`, the RFC 6570 inverse for routing: recover the variables a URL was expanded from. Only an unambiguous subset of templates compiles; anything else fails with the new `Unmatchable` `TemplateError` reason at the expression's position. For a URL the template expanded, `expand(template, match(url))` reproduces it, checked over the uritemplate-test suite.
