# @thomasfosterau/effect-atom-feed

An Atom (RFC 4287) feed (`atom.xml`): `renderAtom`, `renderAtomEntry` and the served `atomResponse`.

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `atom-feed` allows none), and nothing else in the workspace imports this package. It renders and serves; enumerating the rows and purging the edge cache stay with the application (and `effect-sitemap`'s `purgeCacheTags`).

## Invariants

- **Every piece of authored text and every URL is escaped** (`src/internal/xml.ts`), and characters XML 1.0 forbids (C0 controls other than tab/LF/CR, U+FFFE/U+FFFF, lone surrogates) are dropped: one stray control character must not make the document unparseable. `src/internal/xml.ts` is the same file in `effect-rss-feed` and `effect-atom-feed`; change both together.
- **The rendered bytes are a stable contract.** Elements are joined with `""` after the XML declaration, in a fixed order; an absent optional is an omitted element. Cached edge copies are those bytes.
- **Dates are values the caller passes (`DateTime.DateTime`), never a clock read.**
- **Timestamps are RFC 3339 in UTC** (`DateTime.formatIso`), whatever zone the `DateTime` carries.
- **The feed's `updated` is required input**, never derived from the entries or a clock. An entry's `<id>` defaults to its absolute URL, so it is only as permanent as the path.

## Terms

- **Entry** — a site-root-relative `path` plus what the document shows of the row. The map from a resource type to its route segment is the application's.
- **Canonical origin** — the `base` every URL is resolved on: the configured production origin, never the request origin (CANON-001).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag` (the purge itself is `@thomasfosterau/effect-sitemap`'s `purgeCacheTags`).
