/**
 * Reading JSON Feed: a 1.0 or 1.1 document, as real feeds publish it, into
 * the {@link JsonFeed} shape the builder emits. Lenient: a member of the
 * wrong type is dropped, a repairable one (a numeric `id`, a 1.0 `author`)
 * is repaired, and each is reported in `diagnostics`; only input that is
 * not a JSON Feed at all fails.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { JsonFeed, JsonFeedAttachment, JsonFeedAuthor, JsonFeedItem } from "./index.ts";
import { compact } from "./internal/compact.ts";

/**
 * Something {@link decodeJsonFeed} dropped or repaired: where (a JSON path
 * such as `$.items[2].id`) and what.
 *
 * @since 0.1.0
 * @category models
 */
export interface JsonFeedDiagnostic {
  readonly path: string;
  readonly message: string;
}

/**
 * A decoded feed: the document in the 1.1 shape (a 1.0 `author` becomes
 * `authors`), the version URL it declared, and every diagnostic.
 *
 * @since 0.1.0
 * @category models
 */
export interface ParsedJsonFeed {
  readonly feed: JsonFeed;
  /** The `version` the document declared (`https://jsonfeed.org/version/1`, say). */
  readonly version: string;
  readonly diagnostics: ReadonlyArray<JsonFeedDiagnostic>;
}

/**
 * Input that is not a JSON Feed: not JSON (`InvalidJson`), not a JSON
 * object (`NotAnObject`), or an object without a JSON Feed `version`
 * (`NotAJsonFeed`).
 *
 * @since 0.1.0
 * @category errors
 */
export class JsonFeedParseError extends Schema.TaggedError<JsonFeedParseError>()(
  "JsonFeedParseError",
  {
    reason: Schema.Literals(["InvalidJson", "NotAnObject", "NotAJsonFeed"]),
    message: Schema.String,
  },
) {}

/** A JSON object's members. */
type Members = { readonly [key: string]: unknown };

/** `https://jsonfeed.org/version/<n>`, scheme and a trailing slash tolerated. */
const VERSION = /^https?:\/\/jsonfeed\.org\/version\/\d+(?:\.\d+)?\/?$/;

/** The readers for one document, reporting into `diagnostics`. */
const makeReader = (diagnostics: Array<JsonFeedDiagnostic>) => {
  const report = (path: string, message: string): void => {
    diagnostics.push({ path, message });
  };

  /** A string member; `null` reads as absent, any other non-string is dropped. */
  const string = (members: Members, key: string, path: string): string | undefined => {
    const value = members[key];
    if (Predicate.isNullish(value)) return undefined;
    if (Predicate.isString(value)) return value;
    report(`${path}.${key}`, "not a string; ignored");
    return undefined;
  };

  /** A finite, non-negative number member. */
  const count = (members: Members, key: string, path: string): number | undefined => {
    const value = members[key];
    if (Predicate.isNullish(value)) return undefined;
    if (Predicate.isNumber(value) && Number.isFinite(value) && value >= 0) return value;
    report(`${path}.${key}`, "not a non-negative number; ignored");
    return undefined;
  };

  const boolean = (members: Members, key: string, path: string): boolean | undefined => {
    const value = members[key];
    if (Predicate.isNullish(value)) return undefined;
    if (Predicate.isBoolean(value)) return value;
    report(`${path}.${key}`, "not a boolean; ignored");
    return undefined;
  };

  /** An array member's elements, each read by `read` (which drops one by returning `None`). */
  const list = <A>(
    members: Members,
    key: string,
    path: string,
    read: (value: unknown, path: string) => Option.Option<A>,
  ): ReadonlyArray<A> | undefined => {
    const value = members[key];
    if (Predicate.isNullish(value)) return undefined;
    if (!Array.isArray(value)) {
      report(`${path}.${key}`, "not an array; ignored");
      return undefined;
    }
    return Arr.getSomes(
      Arr.map(value, (element, index) => read(element, `${path}.${key}[${index}]`)),
    );
  };

  const object = (value: unknown, path: string): Option.Option<Members> => {
    if (Predicate.isObject(value)) return Option.some(value);
    report(path, "not an object; dropped");
    return Option.none();
  };

  const tag = (value: unknown, path: string): Option.Option<string> => {
    if (Predicate.isString(value)) return Option.some(value);
    report(path, "not a string; dropped");
    return Option.none();
  };

  const author = (value: unknown, path: string): Option.Option<JsonFeedAuthor> =>
    Option.flatMap(object(value, path), (members) => {
      const name = string(members, "name", path);
      const url = string(members, "url", path);
      const avatar = string(members, "avatar", path);
      if (name === undefined && url === undefined && avatar === undefined) {
        report(path, "an author needs a name, url or avatar; dropped");
        return Option.none();
      }
      // SAFETY: at least one of the three members is present, checked above.
      return Option.some(compact({ name, url, avatar }) as JsonFeedAuthor);
    });

  /** `authors`, or a JSON Feed 1.0 `author` as a one-element `authors`. */
  const authors = (members: Members, path: string): ReadonlyArray<JsonFeedAuthor> | undefined => {
    const many = list(members, "authors", path, author);
    if (many !== undefined) return many;
    if (Predicate.isNullish(members["author"])) return undefined;
    return Option.match(author(members["author"], `${path}.author`), {
      onNone: () => undefined,
      onSome: (one) => [one],
    });
  };

  const attachment = (value: unknown, path: string): Option.Option<JsonFeedAttachment> =>
    Option.flatMap(object(value, path), (members) => {
      const url = string(members, "url", path);
      const mimeType = string(members, "mime_type", path);
      if (url === undefined || mimeType === undefined) {
        report(path, "an attachment needs a url and a mime_type; dropped");
        return Option.none();
      }
      return Option.some(
        compact<JsonFeedAttachment>({
          url,
          mime_type: mimeType,
          title: string(members, "title", path),
          size_in_bytes: count(members, "size_in_bytes", path),
          duration_in_seconds: count(members, "duration_in_seconds", path),
        }),
      );
    });

  /** An item's `id`: a string, a number as its decimal string, else the item's `url`. */
  const id = (members: Members, path: string): Option.Option<string> => {
    const value = members["id"];
    if (Predicate.isString(value) && value !== "") return Option.some(value);
    if (Predicate.isNumber(value) && Number.isFinite(value)) {
      report(`${path}.id`, "a number; read as its string");
      return Option.some(String(value));
    }
    const url = members["url"];
    if (Predicate.isString(url) && url !== "") {
      report(`${path}.id`, "missing or invalid; the item's url used instead");
      return Option.some(url);
    }
    report(path, "an item needs an id; dropped");
    return Option.none();
  };

  const item = (value: unknown, path: string): Option.Option<JsonFeedItem> =>
    Option.flatMap(object(value, path), (members) =>
      Option.map(id(members, path), (itemId) => {
        const contentHtml = string(members, "content_html", path);
        const contentText = string(members, "content_text", path);
        if (contentHtml === undefined && contentText === undefined) {
          report(path, "has neither content_html nor content_text");
        }
        return compact<JsonFeedItem>({
          id: itemId,
          url: string(members, "url", path),
          external_url: string(members, "external_url", path),
          title: string(members, "title", path),
          content_html: contentHtml,
          content_text: contentText,
          summary: string(members, "summary", path),
          image: string(members, "image", path),
          banner_image: string(members, "banner_image", path),
          date_published: string(members, "date_published", path),
          date_modified: string(members, "date_modified", path),
          authors: authors(members, path),
          tags: list(members, "tags", path, tag),
          language: string(members, "language", path),
          attachments: list(members, "attachments", path, attachment),
        });
      }),
    );

  return { report, string, boolean, list, authors, item };
};

const parseError = (reason: JsonFeedParseError["reason"], message: string): JsonFeedParseError =>
  new JsonFeedParseError({ reason, message });

/**
 * Decodes an already-parsed JSON value as a JSON Feed 1.0 or 1.1 document,
 * leniently (see {@link ParsedJsonFeed}): a member of the wrong type is
 * dropped, an item without a usable `id` falls back to its `url` or is
 * dropped, a 1.0 `author` becomes `authors`, a missing `title` reads as
 * `""` and missing `items` as `[]`, each with a diagnostic. Dates and URLs
 * are kept as the document wrote them. Fails only for a value that is not
 * an object with a `https://jsonfeed.org/version/…` `version`.
 *
 * @example
 * ```ts
 * import * as Result from "effect/Result"
 * import { decodeJsonFeed } from "@thomasfosterau/effect-json-feed"
 *
 * const parsed = decodeJsonFeed({
 *   version: "https://jsonfeed.org/version/1",
 *   title: "Example",
 *   author: { name: "Ada" },
 *   items: [{ id: 1, content_text: "Hello" }],
 * })
 * if (Result.isSuccess(parsed)) {
 *   console.log(parsed.success.feed.authors) // [{ name: "Ada" }]
 *   console.log(parsed.success.feed.items[0]?.id) // "1"
 *   console.log(parsed.success.diagnostics) // [{ path: "$.items[0].id", message: "a number; read as its string" }]
 * }
 * ```
 *
 * @since 0.1.0
 * @category reading
 */
export const decodeJsonFeed = (
  input: unknown,
): Result.Result<ParsedJsonFeed, JsonFeedParseError> => {
  if (!Predicate.isObject(input)) {
    return Result.fail(parseError("NotAnObject", "A JSON Feed is a JSON object"));
  }
  const version = input["version"];
  if (!Predicate.isString(version) || !VERSION.test(version)) {
    return Result.fail(
      parseError("NotAJsonFeed", "No https://jsonfeed.org/version/… version: not a JSON Feed"),
    );
  }
  const diagnostics: Array<JsonFeedDiagnostic> = [];
  const read = makeReader(diagnostics);
  const title = read.string(input, "title", "$");
  if (title === undefined) read.report("$.title", "missing; read as an empty title");
  const items = read.list(input, "items", "$", read.item);
  if (items === undefined) read.report("$.items", "missing; read as no items");
  const feed = compact<JsonFeed>({
    version: "https://jsonfeed.org/version/1.1",
    title: title ?? "",
    home_page_url: read.string(input, "home_page_url", "$"),
    feed_url: read.string(input, "feed_url", "$"),
    description: read.string(input, "description", "$"),
    user_comment: read.string(input, "user_comment", "$"),
    next_url: read.string(input, "next_url", "$"),
    icon: read.string(input, "icon", "$"),
    favicon: read.string(input, "favicon", "$"),
    authors: read.authors(input, "$"),
    language: read.string(input, "language", "$"),
    expired: read.boolean(input, "expired", "$"),
    items: items ?? [],
  });
  return Result.succeed({ feed, version, diagnostics });
};

const UnknownFromJson = Schema.fromJsonString(Schema.Unknown);

/**
 * Parses JSON Feed text (a `feed.json` body): {@link decodeJsonFeed} after
 * `JSON.parse`, failing with `InvalidJson` for text that is not JSON.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { parseJsonFeed } from "@thomasfosterau/effect-json-feed"
 *
 * const { feed } = await Effect.runPromise(
 *   parseJsonFeed('{"version":"https://jsonfeed.org/version/1.1","title":"Example","items":[]}'),
 * )
 * console.log(feed.title) // "Example"
 * ```
 *
 * @since 0.1.0
 * @category reading
 */
export const parseJsonFeed = (text: string): Effect.Effect<ParsedJsonFeed, JsonFeedParseError> =>
  Effect.suspend(() =>
    Effect.fromResult(
      Result.flatMap(
        Result.mapError(Schema.decodeUnknownResult(UnknownFromJson)(text), () =>
          parseError("InvalidJson", "Not JSON"),
        ),
        decodeJsonFeed,
      ),
    ),
  );
