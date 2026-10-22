---
"@thomasfosterau/effect-langtag": minor
---

Add `@thomasfosterau/effect-langtag`: BCP 47 language tags (RFC 5646) and language-range matching (RFC 4647).

`LanguageTag.parse` (and the `LanguageTagFromString` schema) checks a tag's well-formedness, grandfathered and private-use tags included, and returns it in canonical case as a branded `LanguageTag`. `subtags`, `primaryLanguage`, `script`, `region` and `direction` read it. `LanguageRange` provides basic and extended filtering and lookup with its fallback truncation, `AcceptLanguage.parse` reads the header as a weighted priority list, and `negotiateLanguage` chooses the language to serve.
