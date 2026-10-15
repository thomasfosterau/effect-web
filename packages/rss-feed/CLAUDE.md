# @thomasfosterau/effect-rss-feed

An RSS 2.0 feed (`rss.xml`): `renderRss`, `renderRssItem` and the served `rssResponse`.

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `rss-feed` allows none), and nothing else in the workspace imports this package. It renders and serves; enumerating the rows and purging the edge cache stay with the application (and `effect-sitemap`'s `purgeCacheTags`).

## Invariants

- **Every piece of authored text and every URL is escaped** (`src/internal/xml.ts`), and characters XML 1.0 forbids (C0 controls other than tab/LF/CR, U+FFFE/U+FFFF, lone surrogates) are dropped: one stray control character must not make the document unparseable. `src/internal/xml.ts` is the same file in `effect-rss-feed` and `effect-atom-feed`; change both together.
- **The rendered bytes are a stable contract.** Elements are joined with `""` after the XML declaration, in a fixed order; an absent optional is an omitted element. Cached edge copies are those bytes.
- **Dates are values the caller passes (`DateTime.DateTime`), never a clock read.**
- **An item has a `title` or a `description`** (RSS 2.0 §item); `RssItem` is a union so an item with neither does not compile (`tests/index.types.ts`).
- **The `atom` and `content` namespaces are always declared**, so the opening bytes never depend on the items.

## Terms

- **Entry** — a site-root-relative `path` plus what the document shows of the row. The map from a resource type to its route segment is the application's.
- **Canonical origin** — the `base` every URL is resolved on: the configured production origin, never the request origin (CANON-001).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag` (the purge itself is `@thomasfosterau/effect-sitemap`'s `purgeCacheTags`).
