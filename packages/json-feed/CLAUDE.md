# @thomasfosterau/effect-json-feed

A JSON Feed 1.1 document (`feed.json`): `buildJsonFeed`, `buildJsonFeedItem` and the served `jsonFeedResponse`.

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `json-feed` allows none), and nothing else in the workspace imports this package. It renders and serves; enumerating the rows and purging the edge cache stay with the application (and `effect-sitemap`'s `purgeCacheTags`).

## Invariants

- **An absent member is an omitted key**, never `null` or `undefined`-valued: `compact` drops them, and its mapped parameter type makes the builder name every member of the output type once.
- **An item has `content_html` or `content_text`**, an author at least one of `name` / `url` / `avatar` (JSON Feed 1.1); the input types are unions so the invalid shapes do not compile (`tests/index.types.ts`).
- **The served bytes are 2-space pretty-printed**; changing the indent changes every cached copy.
- **Dates are values the caller passes (`DateTime.DateTime`), never a clock read**, emitted RFC 3339 in UTC.

## Terms

- **Entry** — a site-root-relative `path` plus what the document shows of the row. The map from a resource type to its route segment is the application's.
- **Canonical origin** — the `base` every URL is resolved on: the configured production origin, never the request origin (CANON-001).
- **Low-churn document** — one the edge caches an hour (`LOW_CHURN_CACHE_CONTROL`, PERF-CACHE-002) and a mutation purges by `Cache-Tag` (the purge itself is `@thomasfosterau/effect-sitemap`'s `purgeCacheTags`).
