# @thomasfosterau/effect-uri-template

URI Templates (RFC 6570), Web Linking (RFC 8288) and well-known URIs (RFC 8615): `UriTemplate` (parse with positions, expand at all four levels, `variables`, and `matcher` / `match`, the inverse over an unambiguous subset), `LinkHeader` (parse against a base, serialise, find by `rel`) and `WellKnown` (build and recognise `/.well-known/<suffix>` URLs).

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `uri-template` allows none), and no platform API beyond `URL` and `TextEncoder`, which every runtime has. `src/internal/encoding.ts` holds the RFC 3986 percent-encoding the template and link modules share.

## Invariants

- **The uritemplate-test suite is the acceptance test** (`tests/fixtures/uritemplate-test`, Apache-2.0, vendored at a recorded commit; its `README.md` records the provenance). A failing case is a bug here. The one deliberate departure from the RFC 6570 ABNF, a `'` allowed in literals, is the suite's.
- **Parsing and expansion are total and synchronous**: `parse` and `expand` return `Result`s, never throw, never run an effect. `PrefixOnComposite` is the only expansion failure.
- **Expansion follows RFC 6570 Appendix A literally**: the operator table (`first`, `sep`, `named`, `ifemp`, `allow`), `null` / `undefined` / `[]` / `{}` as undefined, and prefixes counted in code points before encoding. An associative array expands in insertion order (JavaScript's, so integer-like keys come first).
- **Matching refuses at compile time, never guesses at match time.** `matcher` fails `Unmatchable` (with the expression's position) for every template outside the subset its doc comment lists; `match` only ever misses. The contract is the round trip: for a URL the template expanded, `expand(template, match(url))` reproduces it, checked over every uritemplate-test case inside the subset (`tests/uri-template-match.test.ts`). `src/internal/match.ts` holds the compiler.
- **`LinkHeader.parse` never fails** (RFC 8288 Appendix B): a malformed link-value is skipped; `rel`, `anchor`, `type`, `media`, `title` and `title*` keep their first occurrence; `hreflang` keeps every one. A target and an anchor are resolved only when a base is passed.
- **Registered relation types compare case-insensitively, extension types (URIs) exactly**: `rel` stores registered types lowercased.
- **No module-scope work**: the package is `"sideEffects": false`, so regular expressions are literals and the `TextEncoder` is made per call.

## Terms

- **Expression** — a `{…}` in a template: an operator and one or more variable specs.
- **Variable spec** — a variable name as written (pct-encoded octets included) and its modifier: prefix (`:n`) or explode (`*`).
- **Link-value** — one `<target>; params` element of a `Link` header.
- **Well-known suffix** — the path segment after `/.well-known/`, an RFC 3986 `segment-nz`.
