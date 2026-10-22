# @thomasfosterau/effect-json-feed

A JSON Feed 1.1 builder for Effect web applications: the typed feed document, with canonical absolute URLs and omitted absent members, and the served `HttpServerResponse`.

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
| `JsonFeedEntry` | `{ path, id? (= absolute URL), externalUrl?, title?, summary?, contentHtml?, contentText?, image?, bannerImage?, publishedAt?, updatedAt?, authors?, tags?, language? }` — at least one of `contentHtml` / `contentText` (a compile error otherwise). |
| `JsonFeedAuthor` | `{ name?, url?, avatar? }` — at least one. |
| `buildJsonFeed(options, entries)` | The `JsonFeed` document (spec member names), one item per entry in order. Pure. |
| `buildJsonFeedItem(base, entry)` | One `JsonFeedItem`; its `url` (and `id`, unless the entry names its own) is the absolute URL of `path`. |
| `jsonFeedResponse(feed, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: 2-space pretty-printed, `application/feed+json`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `JSON_FEED_VERSION`, `JSON_FEED_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `https://jsonfeed.org/version/1.1`; `application/feed+json`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every path-valued member (`icon`, `image`, an author's `url` / `avatar`, …) takes a site-root-relative path or an absolute URL and is emitted absolute. An absent member is an omitted key, never `null`. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-sitemap) with the same tag.

`@thomasfosterau/effect-sitemap` also ships a narrower JSON Feed builder over its own `FeedEntry` shape; this package is the complete JSON Feed 1.1 surface.

## License

MIT
