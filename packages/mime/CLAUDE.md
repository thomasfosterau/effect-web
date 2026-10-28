# @thomasfosterau/effect-mime

MIME types after the WHATWG MIME Sniffing and Fetch standards: `MimeType` (parse, serialise, essence, parameters, `MimeTypeFromString`), `Sniff` (the §6 pattern tables, the MP4 and WebM signatures, §7.1's computed MIME type, extensible with custom signatures), `Extension` (a curated extension ↔ MIME type table) and `DataUrl` (the `data:` URL processor and forgiving-base64).

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `mime` allows none) and no platform API beyond `URL`, `TextEncoder` and `DataView`. `src/internal/patterns.ts` holds the sniffing tables; nothing outside `src/` imports it.

## Invariants

- **The specifications' algorithms are transcribed, and the web-platform-tests vectors pin them.** `tests/fixtures/` vendors `mimesniff/mime-types/resources/*.json` and `fetch/data-urls/resources/*.json` (BSD-3-Clause, provenance in its README); every vector must pass. Refresh them by fetching, never by editing.
- **A parsed `MimeType` is normalised**: type, subtype and parameter names lower-case, parameters in first-appearance order and unique (first value wins). Values keep their case; `serialize` quotes a value that is empty or not a token.
- **The sniffing tables are literals**, so nothing is built at import (`"sideEffects": false`). Each row's `name` is its row in the specification.
- **Custom signatures never override a specific standard pattern**: `sniff` tries them only where the standard found nothing specific — over a generic container match (`GENERIC_CONTAINERS`: `application/zip`) and before the text-or-binary fallback — so a format library refines `application/zip` or `text/plain` without shadowing what the standard already identifies.
- **The extension table is curated, not mime-db.** Add an entry only for a format a consumer here needs; `extend` is the hook for the rest. The first extension listed for a type is the one `extensionFor` returns.

## Terms

- **Essence** — `type/subtype`, without parameters.
- **Supplied type** — the type a resource arrived with (a `Content-Type`); **computed type** — what `sniff` decides.
- **Signature** — `(bytes) => Option<string>`: a custom detector for an unknown resource.
- **Scriptable** — HTML, XML and PDF, which `sniff` detects in an unknown resource only while `scriptable` is not `false` (the specification's sniff-scriptable flag).
