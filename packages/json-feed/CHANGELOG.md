# @thomasfosterau/effect-json-feed

## 0.1.0

### Minor Changes

- [#104](https://github.com/thomasfosterau/effect-web/pull/104) [`50889de`](https://github.com/thomasfosterau/effect-web/commit/50889dec7af207bff86954810a41706db86ab038) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Initial release: RSS 2.0, Atom (RFC 4287) and JSON Feed 1.1 builders, each taking site-root-relative paths resolved on the canonical origin and `DateTime` values the caller supplies.

  - `@thomasfosterau/effect-rss-feed` — `renderRss`, `renderRssItem`, `rssResponse`; an item needs a `title` or a `description` (enforced by its type).
  - `@thomasfosterau/effect-atom-feed` — `renderAtom`, `renderAtomEntry`, `atomResponse`; timestamps RFC 3339 in UTC.
  - `@thomasfosterau/effect-json-feed` — `buildJsonFeed`, `buildJsonFeedItem`, `jsonFeedResponse`; absent members are omitted keys, and an item needs `contentHtml` or `contentText` (enforced by its type).

  The XML renderers escape every piece of authored text and every URL and drop characters XML 1.0 forbids. Each response defaults to `LOW_CHURN_CACHE_CONTROL` and takes an optional `Cache-Tag`.

- [#163](https://github.com/thomasfosterau/effect-web/pull/163) [`e1d84ba`](https://github.com/thomasfosterau/effect-web/commit/e1d84babe462edb9079d43ca19b464f7a7265a8a) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Read JSON Feed documents: `parseJsonFeed(text)` and `decodeJsonFeed(value)` take a JSON Feed 1.0 or 1.1 document into the `JsonFeed` 1.1 shape, leniently (a 1.0 `author` becomes `authors`, a numeric `id` its string, an item without an `id` falls back to its `url`, members of the wrong type are dropped), with a `JsonFeedDiagnostic` for everything repaired or dropped and a typed `JsonFeedParseError` only for input that is not a JSON Feed. Items gain `attachments` (`JsonFeedAttachment`), which the builder also accepts on an entry, URL resolved on the canonical origin.
