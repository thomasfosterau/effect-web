# @thomasfosterau/effect-langtag

## 0.1.0

### Minor Changes

- [#135](https://github.com/thomasfosterau/effect-web/pull/135) [`ff51a4b`](https://github.com/thomasfosterau/effect-web/commit/ff51a4b3aea3e6ac0508adb1a96b4817b3a5e085) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Add `@thomasfosterau/effect-langtag`: BCP 47 language tags (RFC 5646) and language-range matching (RFC 4647).

  `LanguageTag.parse` (and the `LanguageTagFromString` schema) checks a tag's well-formedness, grandfathered and private-use tags included, and returns it in canonical case as a branded `LanguageTag`. `subtags`, `primaryLanguage`, `script`, `region` and `direction` read it. `LanguageRange` provides basic and extended filtering and lookup with its fallback truncation, `AcceptLanguage.parse` reads the header as a weighted priority list, and `negotiateLanguage` chooses the language to serve.

- [#143](https://github.com/thomasfosterau/effect-web/pull/143) [`a86b711`](https://github.com/thomasfosterau/effect-web/commit/a86b711a37e356afaded067f3b4c9507749eef91) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Add the `./registry` entry: `isValid` (RFC 5646 §2.2.9 validity) and `canonicalize` (§4.5 canonical form, with an optional `suppressScript`) against a generated snapshot of the IANA Language Subtag Registry, plus `suppressScript` and `registryDate`. It is a separate entry, so consumers that only parse and match tags never bundle the snapshot.

### Patch Changes

- [#197](https://github.com/thomasfosterau/effect-web/pull/197) [`3e32583`](https://github.com/thomasfosterau/effect-web/commit/3e32583b94d1cf0ac43813beeff3b42a28fa0faf) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tidy the emitted declarations after enabling type-aware linting: optional parameters drop a redundant `| undefined` (an optional parameter already accepts `undefined`), and `Stream.EventListener<unknown>` is written as `Stream.EventListener`, its default. No type changes for callers.
