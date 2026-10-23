---
"@thomasfosterau/effect-json-feed": minor
---

Read JSON Feed documents: `parseJsonFeed(text)` and `decodeJsonFeed(value)` take a JSON Feed 1.0 or 1.1 document into the `JsonFeed` 1.1 shape, leniently (a 1.0 `author` becomes `authors`, a numeric `id` its string, an item without an `id` falls back to its `url`, members of the wrong type are dropped), with a `JsonFeedDiagnostic` for everything repaired or dropped and a typed `JsonFeedParseError` only for input that is not a JSON Feed. Items gain `attachments` (`JsonFeedAttachment`), which the builder also accepts on an entry, URL resolved on the canonical origin.
