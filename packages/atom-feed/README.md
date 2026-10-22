# @thomasfosterau/effect-atom-feed

An Atom (RFC 4287) feed builder for Effect web applications: the feed and entry renderer, with escaped authored text and canonical absolute URLs, and the served `HttpServerResponse`.

Invariant ids in doc comments and below (`CANON-001`, `PERF-CACHE-002`) name the rule an export enforces; [`SECURITY.md`](https://github.com/thomasfosterau/effect-web/blob/trunk/SECURITY.md#invariant-ids) states each rule and the exports that enforce it.

## Install

```sh
pnpm add @thomasfosterau/effect-atom-feed effect
```

Peer: `effect` (>= 4.0.0-rc.118). One entry, `sideEffects: false`, no top-level statements in `dist/`.

Everything takes a **site-root-relative path** and the **canonical origin** (the configured production origin, never the request origin); every URL emitted is absolute on it (CANON-001). Dates are `DateTime.DateTime` values the caller supplies, emitted RFC 3339 in UTC; nothing here reads a clock.

## Usage

```ts
import * as DateTime from "effect/DateTime";
import { atomResponse, type AtomEntry } from "@thomasfosterau/effect-atom-feed";

// `rows` are the newest changes, newest first, already bounded.
const feed = (
  base: string,
  rows: ReadonlyArray<{ id: string; title: string; summary: string; updatedAt: string }>,
) => {
  const entries = rows.map((row): AtomEntry => ({
    path: `/posts/${row.id}`,
    title: row.title,
    summary: row.summary,
    updated: DateTime.makeUnsafe(row.updatedAt),
  }));
  return atomResponse(
    {
      base,
      title: "Example — Latest changes",
      // The newest entry's `updated`, or a fixed value for an empty feed.
      updated: entries[0]?.updated ?? DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
      authors: [{ name: "Example" }],
    },
    entries,
    { cacheTag: "feed" },
  );
};
```

| Export | What it is |
| --- | --- |
| `AtomFeedOptions` | `{ base, title, updated, subtitle?, id? (= feed URL), homePath? = "/", feedPath? = "/atom.xml", language?, authors?, rights?, icon?, logo? }`. RFC 4287 needs an author on every entry: give the feed `authors` unless every entry has its own. |
| `AtomEntry` | `{ path, title, updated, published?, id? (= absolute URL), summary?, content?, authors?, categories? }`. `summary` is text; `content` is HTML, emitted as `<content type="html">`. |
| `AtomPerson` | `{ name, email?, uri? }`. |
| `renderAtom(options, entries)` | The whole document: the XML declaration, the `<feed>` metadata with its `alternate` and `self` links, one `<entry>` per entry in order. |
| `renderAtomEntry(base, entry)` | One `<entry>`; its `alternate` link (and `<id>`, unless the entry names its own) is the absolute URL of `path`. |
| `atomResponse(options, entries, { cacheTag?, cacheControl? })` | The document as an `HttpServerResponse`: `application/atom+xml`, `LOW_CHURN_CACHE_CONTROL` (PERF-CACHE-002), the `Cache-Tag`. |
| `ATOM_CONTENT_TYPE`, `LOW_CHURN_CACHE_CONTROL` | `application/atom+xml`; `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400`. |

Every piece of authored text and every URL is XML-escaped, and characters XML 1.0 forbids (stray control characters, lone surrogates) are dropped, so one bad title cannot make the feed unparseable. To purge the cached feed on a mutation, use `purgeCacheTags` from [`@thomasfosterau/effect-sitemap`](https://www.npmjs.com/package/@thomasfosterau/effect-sitemap) with the same tag.

## License

MIT
