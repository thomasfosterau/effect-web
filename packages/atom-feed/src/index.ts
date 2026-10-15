/**
 * `@thomasfosterau/effect-atom-feed` — an Atom (RFC 4287) feed
 * (`atom.xml`) built from a feed description and its entries, and served as
 * an `HttpServerResponse` behind the low-churn edge cache.
 *
 * Everything takes a site-root-relative `path` and resolves it on the
 * canonical origin; mapping a resource to its route stays in the
 * application. Every piece of authored text and every URL is XML-escaped, and
 * characters XML 1.0 forbids are dropped, so a stray control character in a
 * title cannot make the feed unparseable.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { element, escapeXml, optionalElement, XML_DECLARATION } from "./internal/xml.ts";

// ── Models ─────────────────────────────────────────────────────────────

/**
 * An Atom person construct: an `<author>`.
 *
 * @since 0.1.0
 * @category models
 */
export interface AtomPerson {
  readonly name: string;
  readonly email?: string | undefined;
  /** A site-root-relative path or an absolute URL, emitted absolute on the feed's `base`. */
  readonly uri?: string | undefined;
}

/**
 * The feed as a whole: the `<feed>` element's own children.
 *
 * RFC 4287 requires an `<author>` on every entry, inherited from the feed
 * when the entry has none: give the feed `authors` unless every entry
 * carries its own.
 *
 * @since 0.1.0
 * @category models
 */
export interface AtomFeedOptions {
  /** The canonical origin every URL is resolved on, never the request origin. */
  readonly base: string;
  readonly title: string;
  /**
   * When the feed last changed in a way its publisher considers
   * significant: usually the newest entry's `updated`. A value the caller
   * supplies, never a clock read.
   */
  readonly updated: DateTime.DateTime;
  readonly subtitle?: string | undefined;
  /** The feed's permanent `<id>`. Defaults to the feed's absolute URL. */
  readonly id?: string | undefined;
  /** The page the feed describes, the `rel="alternate"` link. Defaults to `/`. */
  readonly homePath?: string | undefined;
  /** The feed's own path, the `rel="self"` link. Defaults to `/atom.xml`. */
  readonly feedPath?: string | undefined;
  /** A language tag (`en-AU`), emitted as `xml:lang` on `<feed>`. */
  readonly language?: string | undefined;
  readonly authors?: ReadonlyArray<AtomPerson> | undefined;
  readonly rights?: string | undefined;
  /** A small square image: a site-root-relative path or an absolute URL. */
  readonly icon?: string | undefined;
  /** A larger 2:1 image: a site-root-relative path or an absolute URL. */
  readonly logo?: string | undefined;
}

/**
 * One `<entry>`: a site-root-relative `path` and what the feed shows of it.
 *
 * @since 0.1.0
 * @category models
 */
export interface AtomEntry {
  readonly path: string;
  readonly title: string;
  /** When the entry last changed. */
  readonly updated: DateTime.DateTime;
  /** When the entry was first available. */
  readonly published?: DateTime.DateTime | undefined;
  /**
   * The entry's permanent `<id>`. Defaults to its absolute URL, which is
   * stable only as long as the path is; give a `tag:` URI where it is not.
   */
  readonly id?: string | undefined;
  /** Plain text. */
  readonly summary?: string | undefined;
  /** HTML, emitted escaped as `<content type="html">`. */
  readonly content?: string | undefined;
  /** The entry's own authors; absent, it inherits the feed's. */
  readonly authors?: ReadonlyArray<AtomPerson> | undefined;
  readonly categories?: ReadonlyArray<string> | undefined;
}

// ── Rendering ──────────────────────────────────────────────────────────

/**
 * The `Content-Type` an Atom feed is served with.
 *
 * @since 0.1.0
 * @category constants
 */
export const ATOM_CONTENT_TYPE = "application/atom+xml";

const absolute = (base: string, path: string): string => new URL(path, base).toString();

const link = (rel: string, href: string, type?: string): string =>
  `<link rel="${rel}"${type === undefined ? "" : ` type="${type}"`} href="${escapeXml(href)}"/>`;

const optionalUrl = (name: string, base: string, path: string | undefined): string =>
  path === undefined ? "" : element(name, absolute(base, path));

const persons = (base: string, people: ReadonlyArray<AtomPerson> | undefined): string =>
  Arr.map(
    people ?? [],
    (person) =>
      `<author>${element("name", person.name)}${optionalElement("email", person.email)}${optionalUrl("uri", base, person.uri)}</author>`,
  ).join("");

/**
 * One `<entry>` on `base` (the canonical origin, never the request origin):
 * its `rel="alternate"` link is the absolute URL of `path` (CANON-001),
 * which is also its `<id>` unless the entry names its own. Timestamps are
 * RFC 3339 in UTC.
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import { renderAtomEntry } from "@thomasfosterau/effect-atom-feed"
 *
 * renderAtomEntry("https://example.com", {
 *   path: "/posts/1",
 *   title: "Fish & chips",
 *   updated: DateTime.makeUnsafe("2026-03-04T05:06:07Z"),
 * })
 * // '<entry><id>https://example.com/posts/1</id><title>Fish &amp; chips</title><updated>2026-03-04T05:06:07.000Z</updated><link rel="alternate" href="https://example.com/posts/1"/></entry>'
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderAtomEntry = (base: string, entry: AtomEntry): string => {
  const url = absolute(base, entry.path);
  return [
    "<entry>",
    element("id", entry.id ?? url),
    element("title", entry.title),
    element("updated", DateTime.formatIso(entry.updated)),
    entry.published === undefined ? "" : element("published", DateTime.formatIso(entry.published)),
    link("alternate", url),
    persons(base, entry.authors),
    ...Arr.map(entry.categories ?? [], (term) => `<category term="${escapeXml(term)}"/>`),
    optionalElement("summary", entry.summary),
    entry.content === undefined ? "" : `<content type="html">${escapeXml(entry.content)}</content>`,
    "</entry>",
  ].join("");
};

/**
 * The whole Atom document: the XML declaration, the `<feed>` metadata and
 * one `<entry>` per entry in the order given (the caller sorts newest first
 * and bounds the count). Every URL is absolute on `options.base`, the
 * canonical origin (CANON-001).
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import { renderAtom } from "@thomasfosterau/effect-atom-feed"
 *
 * const updated = DateTime.makeUnsafe("2026-03-04T00:00:00Z")
 * const xml = renderAtom(
 *   { base: "https://example.com", title: "Example", updated, authors: [{ name: "Ada" }] },
 *   [{ path: "/posts/1", title: "Hello", updated }],
 * )
 * xml.includes('<link rel="self" type="application/atom+xml" href="https://example.com/atom.xml"/>') // true
 * xml.endsWith("</entry></feed>") // true
 * ```
 *
 * @since 0.1.0
 * @category rendering
 */
export const renderAtom = (options: AtomFeedOptions, entries: Iterable<AtomEntry>): string => {
  const { base } = options;
  const feedUrl = absolute(base, options.feedPath ?? "/atom.xml");
  const lang = options.language === undefined ? "" : ` xml:lang="${escapeXml(options.language)}"`;
  return [
    XML_DECLARATION,
    `<feed xmlns="http://www.w3.org/2005/Atom"${lang}>`,
    element("id", options.id ?? feedUrl),
    element("title", options.title),
    optionalElement("subtitle", options.subtitle),
    element("updated", DateTime.formatIso(options.updated)),
    link("alternate", absolute(base, options.homePath ?? "/"), "text/html"),
    link("self", feedUrl, ATOM_CONTENT_TYPE),
    persons(base, options.authors),
    optionalElement("rights", options.rights),
    optionalUrl("icon", base, options.icon),
    optionalUrl("logo", base, options.logo),
    ...Arr.map(Arr.fromIterable(entries), (entry) => renderAtomEntry(base, entry)),
    "</feed>",
  ].join("");
};

// ── Serving ────────────────────────────────────────────────────────────

/**
 * The `Cache-Control` the feed is served with by default: the edge caches
 * the whole document for an hour, so any enumeration behind it runs at most
 * once per hour per edge, and a mutation purges its `Cache-Tag` rather than
 * waiting out the TTL (PERF-CACHE-002). The same value as
 * `@thomasfosterau/effect-sitemap`'s.
 *
 * @since 0.1.0
 * @category constants
 */
export const LOW_CHURN_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * What the served feed is cached under.
 *
 * @since 0.1.0
 * @category models
 */
export interface AtomResponseOptions {
  /** The `Cache-Tag` a mutation purges; absent means untagged. */
  readonly cacheTag?: string | undefined;
  /** Defaults to {@link LOW_CHURN_CACHE_CONTROL}. */
  readonly cacheControl?: string | undefined;
}

/**
 * The feed as an `HttpServerResponse`: {@link renderAtom}'s document,
 * {@link ATOM_CONTENT_TYPE}, {@link LOW_CHURN_CACHE_CONTROL} unless
 * overridden and, when given, the `Cache-Tag`.
 *
 * @example
 * ```ts
 * import * as DateTime from "effect/DateTime"
 * import * as HttpServerResponse from "effect/http/HttpServerResponse"
 * import { atomResponse } from "@thomasfosterau/effect-atom-feed"
 *
 * const response = atomResponse(
 *   { base: "https://example.com", title: "Example", updated: DateTime.makeUnsafe("2026-03-04T00:00:00Z") },
 *   [],
 *   { cacheTag: "feed" },
 * )
 * response.headers["cache-tag"] // "feed"
 * const body = await HttpServerResponse.toWeb(response).text()
 * body.startsWith('<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">') // true
 * ```
 *
 * @since 0.1.0
 * @category serving
 */
export const atomResponse = (
  options: AtomFeedOptions,
  entries: Iterable<AtomEntry>,
  responseOptions: AtomResponseOptions = {},
): HttpServerResponse.HttpServerResponse => {
  const cacheControl = responseOptions.cacheControl ?? LOW_CHURN_CACHE_CONTROL;
  return HttpServerResponse.text(renderAtom(options, entries), {
    contentType: ATOM_CONTENT_TYPE,
    headers:
      responseOptions.cacheTag === undefined
        ? { "cache-control": cacheControl }
        : { "cache-control": cacheControl, "cache-tag": responseOptions.cacheTag },
  });
};
