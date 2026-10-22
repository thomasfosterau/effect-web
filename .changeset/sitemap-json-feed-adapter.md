---
"@thomasfosterau/effect-sitemap": minor
---

`buildJsonFeed` / `jsonFeedResponse` are now an adapter over `@thomasfosterau/effect-json-feed` (a new dependency), and the feed they build validates as JSON Feed 1.1. `FeedEntry`, `JsonFeedOptions` and both signatures are unchanged.

The served bytes change:

- Every item now carries `content_text`, which JSON Feed 1.1 requires: the entry's `summary`, else its `title`, else `""`.
- `date_published` / `date_modified` are emitted RFC 3339 in UTC. A timestamp with an offset is normalised to UTC, one without a zone reads as UTC, and one that does not parse is omitted rather than emitted invalid.

`JsonFeed` / `JsonFeedItem` are now effect-json-feed's types, so an item's `date_published` / `date_modified` are typed optional. `JSON_FEED_CONTENT_TYPE` is effect-json-feed's constant (the same value).
