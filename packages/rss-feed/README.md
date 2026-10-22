# @thomasfosterau/effect-rss-feed

An RSS 2.0 feed builder for Effect web applications: the channel and item renderer, with escaped authored text and canonical absolute URLs, and the served `HttpServerResponse`.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-web/blob/trunk/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

## Install

```sh
pnpm add @thomasfosterau/effect-rss-feed effect
```

Peer: `effect` (>= 4.0.0-rc.118). One entry, `sideEffects: false`, no top-level statements in `dist/`.

Everything takes a **site-root-relative path** and the **canonical origin** (the configured production origin, never the request origin); every URL emitted is absolute on it (CANON-001). Dates are `DateTime.DateTime` values the caller supplies; nothing here reads a clock.

## Usage

```ts
import * as DateTime from "effect/DateTime";
import { rssResponse, type RssItem } from "@thomasfosterau/effect-rss-feed";

// `rows` are the newest changes, newest first, already bounded.
const feed = (
  base: string,
  rows: ReadonlyArray<{ id: string; title: string; summary: string; publishedAt: string }>,
) =>
  rssResponse(
    { base, title: "Example — Latest changes", description: "The 50 most recent changes." },
    rows.map((row): RssItem => ({
      path: `/posts/${row.id}`,
      title: row.title,
      description: row.summary,
      publishedAt: DateTime.makeUnsafe(row.publishedAt),
    })),
    { cacheTag: "feed" },
  );
```

| Export | What it is |
| --- | --- |
| `RssChannel` | `{ base, title, description, homePath? = "/", feedPath? = "/rss.xml", language?, copyright?, lastBuildDate?, ttl? }`. |
| `RssItem` | `{ path, title?, description?, content?, author?, categories?, guid?, publishedAt? }` — at least one of `title` / `description` (a compile error otherwise). `content` is HTML, emitted as `content:encoded`. |
| `renderRss(channel, items)` | The whole document: the XML declaration, `<channel>` with its `atom:link rel="self"`, one `<item>` per entry in order. |
| `renderRssItem(base, item)` | One `<item>`; its `<link>` (and permalink `<guid>`, unless the item names its own) is the absolute URL of `path`. |
| `rssResponse(channel, items, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: `application/rss+xml`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `RSS_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `application/rss+xml`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every piece of authored text and every URL is XML-escaped, and characters XML 1.0 forbids (stray control characters, lone surrogates) are dropped, so one bad title cannot make the feed unparseable. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-sitemap) with the same tag.

## License

MIT
