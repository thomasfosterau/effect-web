---
"@thomasfosterau/effect-rss-feed": minor
"@thomasfosterau/effect-atom-feed": minor
"@thomasfosterau/effect-json-feed": minor
---

Initial release: RSS 2.0, Atom (RFC 4287) and JSON Feed 1.1 builders, each taking site-root-relative paths resolved on the canonical origin and `DateTime` values the caller supplies.

- `@thomasfosterau/effect-rss-feed` — `renderRss`, `renderRssItem`, `rssResponse`; an item needs a `title` or a `description` (enforced by its type).
- `@thomasfosterau/effect-atom-feed` — `renderAtom`, `renderAtomEntry`, `atomResponse`; timestamps RFC 3339 in UTC.
- `@thomasfosterau/effect-json-feed` — `buildJsonFeed`, `buildJsonFeedItem`, `jsonFeedResponse`; absent members are omitted keys, and an item needs `contentHtml` or `contentText` (enforced by its type).

The XML renderers escape every piece of authored text and every URL and drop characters XML 1.0 forbids. Each response defaults to `LOW_CHURN_CACHE_CONTROL` and takes an optional `Cache-Tag`.
