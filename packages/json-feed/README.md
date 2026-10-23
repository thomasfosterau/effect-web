# @thomasfosterau/effect-json-feed

A JSON Feed 1.1 builder and reader for Effect web applications: the typed feed document, with canonical absolute URLs and omitted absent members, the served `HttpServerResponse`, and a lenient reader for JSON Feed 1.0 and 1.1 documents as real feeds publish them.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-web/blob/trunk/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

## Install

```sh
pnpm add @thomasfosterau/effect-json-feed effect
```

Peer: `effect` (>= 4.0.0-rc.118). One entry, `sideEffects: false`, no top-level statements in `dist/`.

Everything takes a **site-root-relative path** and the **canonical origin** (the configured production origin, never the request origin); every URL emitted is absolute on it (CANON-001). Dates are `DateTime.DateTime` values the caller supplies, emitted RFC 3339 in UTC; nothing here reads a clock.

## Usage

```ts
import * as DateTime from "effect/DateTime";
import {
  buildJsonFeed,
  jsonFeedResponse,
  type JsonFeedEntry,
} from "@thomasfosterau/effect-json-feed";

// `rows` are the newest changes, newest first, already bounded.
const feed = (
  base: string,
  rows: ReadonlyArray<{ id: string; title: string; body: string; updatedAt: string }>,
) =>
  jsonFeedResponse(
    buildJsonFeed(
      { base, title: "Example — Latest changes", description: "The 50 most recent changes." },
      rows.map((row): JsonFeedEntry => ({
        path: `/posts/${row.id}`,
        title: row.title,
        contentHtml: row.body,
        updatedAt: DateTime.makeUnsafe(row.updatedAt),
      })),
    ),
    { cacheTag: "feed" },
  );
```

| Export | What it is |
| --- | --- |
| `JsonFeedOptions` | `{ base, title, description?, homePath? = "/", feedPath? = "/feed.json", nextPath?, userComment?, icon?, favicon?, authors?, language?, expired? }`. |
| `JsonFeedEntry` | `{ path, id? (= absolute URL), externalUrl?, title?, summary?, contentHtml?, contentText?, image?, bannerImage?, publishedAt?, updatedAt?, authors?, tags?, language?, attachments? }` — at least one of `contentHtml` / `contentText` (a compile error otherwise). |
| `JsonFeedAuthor` | `{ name?, url?, avatar? }` — at least one. |
| `JsonFeedAttachment` | `{ url, mime_type, title?, size_in_bytes?, duration_in_seconds? }` — an enclosure; `url` may be a path on input. |
| `buildJsonFeed(options, entries)` | The `JsonFeed` document (spec member names), one item per entry in order. Pure. |
| `buildJsonFeedItem(base, entry)` | One `JsonFeedItem`; its `url` (and `id`, unless the entry names its own) is the absolute URL of `path`. |
| `jsonFeedResponse(feed, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: 2-space pretty-printed, `application/feed+json`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `JSON_FEED_VERSION`, `JSON_FEED_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `https://jsonfeed.org/version/1.1`; `application/feed+json`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every path-valued member (`icon`, `image`, an author's `url` / `avatar`, …) takes a site-root-relative path or an absolute URL and is emitted absolute. An absent member is an omitted key, never `null`. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-sitemap) with the same tag.

`@thomasfosterau/effect-sitemap` also ships a narrower JSON Feed builder over its own `FeedEntry` shape; this package is the complete JSON Feed 1.1 surface.

## Reading a feed

```ts
import * as Effect from "effect/Effect";
import { parseJsonFeed } from "@thomasfosterau/effect-json-feed";

const read = (body: string) =>
  Effect.map(parseJsonFeed(body), ({ feed, version, diagnostics }) => ({
    titles: feed.items.map((item) => item.title ?? item.id),
    version, // the version URL the document declared
    diagnostics, // [{ path: "$.items[3].id", message: "a number; read as its string" }, …]
  }));
```

| Export | What it is |
| --- | --- |
| `parseJsonFeed(text)` | `Effect<ParsedJsonFeed, JsonFeedParseError>`: `JSON.parse`, then `decodeJsonFeed`. |
| `decodeJsonFeed(value)` | `Result<ParsedJsonFeed, JsonFeedParseError>` over an already-parsed value. |
| `ParsedJsonFeed` | `{ feed: JsonFeed, version, diagnostics }`: the document in the 1.1 shape (a 1.0 `author` becomes `authors`), the `version` URL it declared, and what was repaired or dropped. |
| `JsonFeedDiagnostic` | `{ path, message }`, `path` a JSON path (`$.items[2].id`). |
| `JsonFeedParseError` | `reason`: `InvalidJson`, `NotAnObject`, or `NotAJsonFeed` (no `https://jsonfeed.org/version/…` `version`). |

Reading is lenient, as real feeds need: a member of the wrong type is dropped, a numeric `id` becomes its string, an item with no usable `id` falls back to its `url` (or is dropped), an author with no `name` / `url` / `avatar` or an attachment without `url` and `mime_type` is dropped, `null` reads as absent, a missing `title` as `""` and missing `items` as none — each with a diagnostic. An item with neither `content_html` nor `content_text` is kept and reported. Dates and URLs are kept exactly as the document wrote them; `_`-prefixed extensions and `hubs` are not read.

## License

MIT
