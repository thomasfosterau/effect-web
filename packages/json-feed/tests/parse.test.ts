/**
 * Reading JSON Feed: the spec's own examples (jsonfeed.org, 1.0 and 1.1),
 * the lenient repairs and drops with their diagnostics, the errors, and a
 * round trip through the builder.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import {
  buildJsonFeed,
  decodeJsonFeed,
  JSON_FEED_VERSION,
  JsonFeedParseError,
  parseJsonFeed,
  type ParsedJsonFeed,
} from "@thomasfosterau/effect-json-feed";

const success = (input: unknown): ParsedJsonFeed =>
  Result.getOrThrowWith(decodeJsonFeed(input), (error) => error);

const reasonOf = (input: unknown): Option.Option<string> =>
  Option.map(Result.getFailure(decodeJsonFeed(input)), (error) => error.reason);

describe("decodeJsonFeed", () => {
  it("reads the JSON Feed 1.1 specification's example", () => {
    const parsed = success({
      version: "https://jsonfeed.org/version/1.1",
      title: "My Example Feed",
      home_page_url: "https://example.org/",
      feed_url: "https://example.org/feed.json",
      items: [
        { id: "2", content_text: "This is a second item.", url: "https://example.org/second-item" },
        { id: "1", content_html: "<p>Hello, world!</p>", url: "https://example.org/initial-post" },
      ],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(parsed.feed).toStrictEqual({
      version: JSON_FEED_VERSION,
      title: "My Example Feed",
      home_page_url: "https://example.org/",
      feed_url: "https://example.org/feed.json",
      items: [
        { id: "2", content_text: "This is a second item.", url: "https://example.org/second-item" },
        { id: "1", content_html: "<p>Hello, world!</p>", url: "https://example.org/initial-post" },
      ],
    });
  });

  it("upgrades a JSON Feed 1.0 document: author becomes authors", () => {
    const parsed = success({
      version: "https://jsonfeed.org/version/1",
      title: "Podcast",
      author: { name: "Ada", url: "https://ada.example/" },
      items: [
        {
          id: "e1",
          content_text: "Episode one",
          author: { avatar: "https://ada.example/a.png" },
          attachments: [
            {
              url: "https://cdn.example/e1.m4a",
              mime_type: "audio/x-m4a",
              size_in_bytes: 89970236,
              duration_in_seconds: 6629,
            },
          ],
        },
      ],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.version).toBe("https://jsonfeed.org/version/1");
    expect(parsed.feed.version).toBe(JSON_FEED_VERSION);
    expect(parsed.feed.authors).toStrictEqual([{ name: "Ada", url: "https://ada.example/" }]);
    expect(parsed.feed.items[0]).toStrictEqual({
      id: "e1",
      content_text: "Episode one",
      authors: [{ avatar: "https://ada.example/a.png" }],
      attachments: [
        {
          url: "https://cdn.example/e1.m4a",
          mime_type: "audio/x-m4a",
          size_in_bytes: 89970236,
          duration_in_seconds: 6629,
        },
      ],
    });
  });

  it("prefers authors over a 1.0 author when a feed carries both", () => {
    const parsed = success({
      version: "https://jsonfeed.org/version/1.1",
      title: "T",
      author: { name: "Old" },
      authors: [{ name: "New" }],
      items: [],
    });
    expect(parsed.feed.authors).toStrictEqual([{ name: "New" }]);
  });

  it("repairs what it can and reports it", () => {
    const parsed = success({
      version: "http://jsonfeed.org/version/1/",
      items: [
        { id: 42, content_text: "numeric id" },
        { url: "https://example.org/x", content_text: "no id" },
        { content_text: "nothing to identify it" },
        { id: "t", title: 7, tags: ["a", 1, "b"], content_html: "<p>x</p>" },
        { id: "n", content_text: "nulls are absent", title: null, summary: null },
        "not an item",
      ],
    });
    expect(parsed.feed.title).toBe("");
    expect(parsed.feed.items).toStrictEqual([
      { id: "42", content_text: "numeric id" },
      { id: "https://example.org/x", url: "https://example.org/x", content_text: "no id" },
      { id: "t", tags: ["a", "b"], content_html: "<p>x</p>" },
      { id: "n", content_text: "nulls are absent" },
    ]);
    expect(parsed.diagnostics).toEqual([
      { path: "$.title", message: "missing; read as an empty title" },
      { path: "$.items[0].id", message: "a number; read as its string" },
      { path: "$.items[1].id", message: "missing or invalid; the item's url used instead" },
      { path: "$.items[2]", message: "an item needs an id; dropped" },
      { path: "$.items[3].title", message: "not a string; ignored" },
      { path: "$.items[3].tags[1]", message: "not a string; dropped" },
      { path: "$.items[5]", message: "not an object; dropped" },
    ]);
  });

  it("drops invalid authors and attachments, and reports an item without content", () => {
    const parsed = success({
      version: "https://jsonfeed.org/version/1.1",
      title: "T",
      authors: [{}, { name: "Ada" }],
      expired: "yes",
      items: [{ id: "a", attachments: [{ url: "https://x.example/a" }] }],
    });
    expect(parsed.feed.authors).toStrictEqual([{ name: "Ada" }]);
    expect(parsed.feed.items).toStrictEqual([{ id: "a", attachments: [] }]);
    expect(parsed.diagnostics).toEqual([
      { path: "$.items[0]", message: "has neither content_html nor content_text" },
      {
        path: "$.items[0].attachments[0]",
        message: "an attachment needs a url and a mime_type; dropped",
      },
      { path: "$.authors[0]", message: "an author needs a name, url or avatar; dropped" },
      { path: "$.expired", message: "not a boolean; ignored" },
    ]);
  });

  it("reads missing items as none", () => {
    const parsed = success({ version: "https://jsonfeed.org/version/1.1", title: "T" });
    expect(parsed.feed.items).toEqual([]);
    expect(parsed.diagnostics).toEqual([{ path: "$.items", message: "missing; read as no items" }]);
  });

  it("fails on a value that is not a JSON Feed", () => {
    expect(reasonOf([])).toStrictEqual(Option.some("NotAnObject"));
    expect(reasonOf("feed")).toStrictEqual(Option.some("NotAnObject"));
    expect(reasonOf({ title: "T", items: [] })).toStrictEqual(Option.some("NotAJsonFeed"));
    expect(reasonOf({ version: "https://example.org/version/1" })).toStrictEqual(
      Option.some("NotAJsonFeed"),
    );
  });

  it("round-trips a built feed with no diagnostics", () => {
    const built = buildJsonFeed(
      { base: "https://example.com", title: "Example", authors: [{ name: "Ada" }] },
      [
        {
          path: "/posts/1",
          title: "Hello",
          contentHtml: "<p>Hello</p>",
          tags: ["a"],
          attachments: [{ url: "/media/1.mp3", mime_type: "audio/mpeg", size_in_bytes: 10 }],
        },
      ],
    );
    expect(built.items[0]?.attachments).toStrictEqual([
      { url: "https://example.com/media/1.mp3", mime_type: "audio/mpeg", size_in_bytes: 10 },
    ]);
    const parsed = success(built);
    expect(parsed.feed).toStrictEqual(built);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("parseJsonFeed", () => {
  it("parses feed.json text", async () => {
    const { feed } = await Effect.runPromise(
      parseJsonFeed('{"version":"https://jsonfeed.org/version/1.1","title":"T","items":[]}'),
    );
    expect(feed.title).toBe("T");
  });

  it("fails with InvalidJson on text that is not JSON", () => {
    const exit = Effect.runSyncExit(parseJsonFeed("{nope"));
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.findErrorOption(exit);
    expect(Option.map(error, (failure) => failure instanceof JsonFeedParseError)).toStrictEqual(
      Option.some(true),
    );
    expect(Option.map(error, (failure) => failure.reason)).toStrictEqual(
      Option.some("InvalidJson"),
    );
  });
});
