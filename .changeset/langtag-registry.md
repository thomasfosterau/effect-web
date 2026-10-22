---
"@thomasfosterau/effect-langtag": minor
---

Add the `./registry` entry: `isValid` (RFC 5646 §2.2.9 validity) and `canonicalize` (§4.5 canonical form, with an optional `suppressScript`) against a generated snapshot of the IANA Language Subtag Registry, plus `suppressScript` and `registryDate`. It is a separate entry, so consumers that only parse and match tags never bundle the snapshot.
