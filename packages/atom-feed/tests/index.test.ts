/**
 * The Atom (RFC 4287) renderer, over the path-taking entry shape, and the
 * feed response.
 */

import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  ATOM_CONTENT_TYPE,
  atomResponse,
  LOW_CHURN_CACHE_CONTROL,
  renderAtom,
  renderAtomEntry,
  type AtomFeedOptions,
} from "@thomasfosterau/effect-atom-feed";

const BASE = "https://example.com";
const UPDATED = DateTime.makeUnsafe("2026-03-04T05:06:07Z");
const PUBLISHED = DateTime.makeUnsafe("2026-01-02T03:04:05Z");
const options: AtomFeedOptions = { base: BASE, title: "Example", updated: UPDATED };

describe("renderAtom", () => {
  it("pins the bytes of a minimal feed with no entries", () => {
    expect(renderAtom(options, [])).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://example.com/atom.xml</id><title>Example</title><updated>2026-03-04T05:06:07.000Z</updated><link rel="alternate" type="text/html" href="https://example.com/"/><link rel="self" type="application/atom+xml" href="https://example.com/atom.xml"/></feed>`,
    );
  });

  it("emits every optional feed element, in order, with custom paths and id", () => {
    const xml = renderAtom(
      {
        ...options,
        id: "tag:example.com,2026:feed",
        subtitle: "Latest changes",
        homePath: "/blog",
        feedPath: "/blog/atom.xml",
        language: "en-AU",
        authors: [{ name: "Ada", email: "ada@example.com", uri: "/people/ada" }],
        rights: "© Example",
        icon: "/icon.png",
        logo: "https://cdn.example.net/logo.png",
      },
      [],
    );
    expect(xml).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-AU"><id>tag:example.com,2026:feed</id><title>Example</title><subtitle>Latest changes</subtitle><updated>2026-03-04T05:06:07.000Z</updated><link rel="alternate" type="text/html" href="https://example.com/blog"/><link rel="self" type="application/atom+xml" href="https://example.com/blog/atom.xml"/><author><name>Ada</name><email>ada@example.com</email><uri>https://example.com/people/ada</uri></author><rights>© Example</rights><icon>https://example.com/icon.png</icon><logo>https://cdn.example.net/logo.png</logo></feed>`,
    );
  });

  it("keeps entry order and accepts any iterable", () => {
    const entries = new Set([
      { path: "/b", title: "B", updated: UPDATED },
      { path: "/a", title: "A", updated: UPDATED },
    ]);
    const xml = renderAtom(options, entries);
    expect(xml.indexOf("<title>B</title>")).toBeLessThan(xml.indexOf("<title>A</title>"));
    expect(xml.endsWith("</entry></feed>")).toBe(true);
  });
});

describe("renderAtomEntry", () => {
  it("pins the bytes of a full entry", () => {
    expect(
      renderAtomEntry(BASE, {
        path: "/posts/1",
        title: "Hello",
        updated: UPDATED,
        published: PUBLISHED,
        summary: "A summary.",
        content: "<p>Hello</p>",
        authors: [{ name: "Ada" }],
        categories: ["one", "a&b"],
      }),
    ).toBe(
      `<entry><id>https://example.com/posts/1</id><title>Hello</title><updated>2026-03-04T05:06:07.000Z</updated><published>2026-01-02T03:04:05.000Z</published><link rel="alternate" href="https://example.com/posts/1"/><author><name>Ada</name></author><category term="one"/><category term="a&amp;b"/><summary>A summary.</summary><content type="html">&lt;p&gt;Hello&lt;/p&gt;</content></entry>`,
    );
  });

  it("takes a caller-supplied id", () => {
    expect(
      renderAtomEntry(BASE, { path: "/p", title: "t", updated: UPDATED, id: "tag:x,2026:1" }),
    ).toContain("<id>tag:x,2026:1</id>");
  });

  it("emits a zoned timestamp in UTC", () => {
    const zoned = DateTime.makeZonedUnsafe("2026-03-04T15:06:07", {
      timeZone: "Australia/Sydney",
      adjustForTimeZone: true,
    });
    expect(renderAtomEntry(BASE, { path: "/p", title: "t", updated: zoned })).toContain(
      "<updated>2026-03-04T04:06:07.000Z</updated>",
    );
  });

  it("escapes authored text and URLs, and drops characters XML 1.0 forbids", () => {
    const xml = renderAtomEntry(BASE, {
      path: "/search?q=a&b",
      title: `<"Fish"> & 'chips'\u0000`,
      updated: UPDATED,
    });
    expect(xml).toContain("<title>&lt;&quot;Fish&quot;&gt; &amp; &apos;chips&apos;</title>");
    expect(xml).toContain(`href="https://example.com/search?q=a&amp;b"`);
  });
});

describe("atomResponse", () => {
  it("serves the document with the Atom type and the low-churn cache policy", async () => {
    const response = atomResponse(options, []);
    expect(response.headers["content-type"]).toBe(ATOM_CONTENT_TYPE);
    expect(response.headers["cache-control"]).toBe(LOW_CHURN_CACHE_CONTROL);
    expect(response.headers["cache-tag"]).toBeUndefined();
    expect(await HttpServerResponse.toWeb(response).text()).toBe(renderAtom(options, []));
  });

  it("carries a Cache-Tag and an overridden Cache-Control when given", () => {
    const response = atomResponse(options, [], { cacheTag: "feed", cacheControl: "no-store" });
    expect(response.headers["cache-tag"]).toBe("feed");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
