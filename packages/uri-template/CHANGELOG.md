# @thomasfosterau/effect-uri-template

## 0.1.0

### Minor Changes

- [#141](https://github.com/thomasfosterau/effect-web/pull/141) [`5a24c61`](https://github.com/thomasfosterau/effect-web/commit/5a24c61acaf33dea786d25beb8f49d65769cfb8d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Add `UriTemplate.matcher` and `UriTemplate.match`, the RFC 6570 inverse for routing: recover the variables a URL was expanded from. Only an unambiguous subset of templates compiles; anything else fails with the new `Unmatchable` `TemplateError` reason at the expression's position. For a URL the template expanded, `expand(template, match(url))` reproduces it, checked over the uritemplate-test suite.

- [#137](https://github.com/thomasfosterau/effect-web/pull/137) [`144b178`](https://github.com/thomasfosterau/effect-web/commit/144b178bf5527ac926df46930efee7b2ee9de25c) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Add `@thomasfosterau/effect-uri-template`: URI Templates (RFC 6570), Web Linking (RFC 8288) and well-known URIs (RFC 8615).

  `UriTemplate.parse` reports a malformed template with its reason and position, and `UriTemplate.expand` covers all four levels: every operator, prefix and explode modifiers, lists and associative arrays. Both are checked against the uritemplate-test suite. `LinkHeader.parse` reads a `Link` header into typed links (resolved against a base, with the RFC 8187 `title*` decoded), `LinkHeader.serialize` writes one, and `findRel` / `filterRel` query by relation type. `WellKnown.url` and `WellKnown.suffixOf` build and recognise `/.well-known/` URLs.

### Patch Changes

- [#197](https://github.com/thomasfosterau/effect-web/pull/197) [`3e32583`](https://github.com/thomasfosterau/effect-web/commit/3e32583b94d1cf0ac43813beeff3b42a28fa0faf) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tidy the emitted declarations after enabling type-aware linting: optional parameters drop a redundant `| undefined` (an optional parameter already accepts `undefined`), and `Stream.EventListener<unknown>` is written as `Stream.EventListener`, its default. No type changes for callers.
