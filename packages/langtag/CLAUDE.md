# @thomasfosterau/effect-langtag

BCP 47 language tags (RFC 5646) and language-range matching (RFC 4647): `LanguageTag` (parse into canonical case, the branded `Schema`, subtags, a direction hint), `LanguageRange` (basic and extended filtering, lookup), `AcceptLanguage` (the header as a weighted priority list) and `negotiateLanguage`.

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `langtag` allows none), and no platform API: everything is a pure function of strings. `src/internal/grammar.ts` holds the RFC 5646 grammar and case conventions; nothing outside `src/` imports it.

## Invariants

- **The root entry is well-formed, not valid; validity lives in `./registry`.** `parse` checks the RFC 5646 §2.1 ABNF only: no registry lookup, no `Preferred-Value` mapping (`iw` stays `iw`), no duplicate-variant or duplicate-singleton check. `./registry`'s `isValid` (§2.2.9) and `canonicalize` (§4.5) are the only places that consult the IANA Language Subtag Registry, so a consumer that never imports `./registry` never bundles its ~45 KB snapshot.
- **The registry snapshot is generated, never hand-edited.** `src/internal/registry-data.ts` comes from `scripts/generate-language-subtag-registry.mjs` (from IANA, or a copy with its provenance passed as `--source`); its header records the source and `File-Date`, which `registryDate` exports. The data is space-delimited string literals, pure declarations under `"sideEffects": false`, looked up by substring (no `Set` built at import).
- **A `LanguageTag` is canonical-case by construction**, so tag equality is `===`. The `LanguageTag` schema rejects a well-formed tag in the wrong case; only `LanguageTagFromString` (and `parse`) canonicalise.
- **Grandfathered tags are matched before the `langtag` production** (§2.1): `zh-min-nan` is grandfathered even though it also parses as language + extlangs, and has no parts.
- **Matching works on the caller's strings and returns the caller's values**, case-insensitively, without parsing them: a branded or literal-typed tag comes back as the same type.
- **Lookup truncates the range, never the tag** (RFC 4647 §3.4): `de` does not reach an available `de-DE`. A fallback chain such as CSL's `de-AT` → `de-DE` is the consumer's policy, built on `lookup`.
- **A malformed `q` reads as `1`** in `AcceptLanguage.parse`, as in `@thomasfosterau/effect-web`'s `./negotiate`: a malformed weight is a client bug, not a refusal. A `q=0` range refuses every tag it basic-matches in `negotiateLanguage`.

## Terms

- **Language tag** — a BCP 47 tag (`en-GB`, `zh-Hant-TW`, `x-private`, `i-klingon`).
- **Language range** — a pattern in a user's priority list: basic (`de-CH`, `*`) or extended (`de-*-DE`, RFC 4647 §2.2).
- **Priority list** — ranges in preference order; for `Accept-Language`, ordered by `q`, ties in header order.
- **Canonical case** — RFC 5646 §2.1.1: lowercase, region uppercase, script title-case, everything after a singleton lowercase.
