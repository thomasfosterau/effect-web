/**
 * Web Linking (RFC 8288): the `Link` header field, parsed into typed links
 * and serialised back.
 *
 * `Link: <https://example.org/meta.json>; rel="describedby"` is how CSVW
 * finds a table's metadata, how paginated APIs say `rel="next"`, and how a
 * representation names its `rel="alternate"` forms. Parsing follows RFC
 * 8288 Appendix B: it is lenient (a malformed link-value is skipped, the
 * rest still parse), a parameter that may appear only once keeps its first
 * occurrence, and `title*` is decoded from its RFC 8187 extended value.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { pctEncode } from "./internal/encoding.ts";

/**
 * A `title*` value (RFC 8187): the decoded text and its language tag, if
 * one was given.
 *
 * @since 0.1.0
 * @category models
 */
export interface ExtendedValue {
  readonly value: string;
  readonly language: Option.Option<string>;
}

/**
 * One link of a `Link` header.
 *
 * - `target` — the target URI: resolved against the base when
 *   {@link parse} was given one, as written otherwise.
 * - `rel` — the relation types, each once; registered types lowercased
 *   (they compare case-insensitively), extension types (URIs) as written.
 * - `anchor` — the context URI, resolved like `target`.
 * - `type`, `media`, `title` — the first occurrence of each.
 * - `titleStar` — `title*`, decoded; prefer it over `title` for display.
 * - `hreflang` — every occurrence.
 * - `params` — every other target attribute, name lowercased, in order.
 *
 * @since 0.1.0
 * @category models
 */
export interface Link {
  readonly target: string;
  readonly rel: ReadonlyArray<string>;
  readonly anchor: Option.Option<string>;
  readonly type: Option.Option<string>;
  readonly media: Option.Option<string>;
  readonly title: Option.Option<string>;
  readonly titleStar: Option.Option<ExtendedValue>;
  readonly hreflang: ReadonlyArray<string>;
  readonly params: ReadonlyArray<readonly [name: string, value: string]>;
}

/**
 * What {@link make} takes besides the target: every member of a
 * {@link Link}, each optional.
 *
 * @since 0.1.0
 * @category models
 */
export interface LinkOptions {
  readonly rel?: string | ReadonlyArray<string> | undefined;
  readonly anchor?: string | undefined;
  readonly type?: string | undefined;
  readonly media?: string | undefined;
  readonly title?: string | undefined;
  readonly titleStar?: string | ExtendedValue | undefined;
  readonly hreflang?: ReadonlyArray<string> | undefined;
  readonly params?: ReadonlyArray<readonly [name: string, value: string]> | undefined;
}

const normaliseRel = (rel: string): string => (rel.includes(":") ? rel : rel.toLowerCase());

const relsOf = (value: string): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.map(
      Arr.filter(value.split(/\s+/u), (rel) => rel !== ""),
      normaliseRel,
    ),
  );

/**
 * Builds a {@link Link} to `target`.
 *
 * @example
 * ```ts
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * const next = LinkHeader.make("/items?page=3", { rel: "next" })
 * console.log(LinkHeader.serialize([next])) // "</items?page=3>; rel=next"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (target: string, options?: LinkOptions): Link => {
  const rel = options?.rel;
  const titleStar = options?.titleStar;
  return {
    target,
    rel:
      rel === undefined
        ? []
        : Predicate.isString(rel)
          ? relsOf(rel)
          : Arr.dedupe(Arr.map(rel, normaliseRel)),
    anchor: Option.fromUndefinedOr(options?.anchor),
    type: Option.fromUndefinedOr(options?.type),
    media: Option.fromUndefinedOr(options?.media),
    title: Option.fromUndefinedOr(options?.title),
    titleStar: Option.map(Option.fromUndefinedOr(titleStar), (value) =>
      Predicate.isString(value) ? { value, language: Option.none() } : value,
    ),
    hreflang: options?.hreflang ?? [],
    params: options?.params ?? [],
  };
};

// ---- parsing (RFC 8288 Appendix B) ----

// A link-value: `<target>` and its `; name[=value]` parameters, a value a
// token or a quoted-string (which may hold `,` and `;`).
const LINK_VALUE = /<([^>]*)>((?:\s*;\s*[^;,=\s]+\s*(?:=\s*(?:"(?:[^"\\]|\\.)*"|[^;,\s"]*))?)*)/gu;
const PARAMETERS = /;\s*([^;,=\s]+)\s*(?:=\s*("(?:[^"\\]|\\.)*"|[^;,\s"]*))?/gu;

const unquote = (value: string): string =>
  value.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/gu, "$1") : value;

const resolve = (reference: string, base: string | URL | undefined): string =>
  base !== undefined && URL.canParse(reference, base) ? new URL(reference, base).href : reference;

const latin1 = (encoded: string): string =>
  encoded.replace(/%([0-9A-Fa-f]{2})/gu, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

/**
 * Decodes an RFC 8187 `ext-value` (`UTF-8'en'%E2%82%AC%20rates`); `None`
 * for a malformed one or a charset other than UTF-8 and ISO-8859-1.
 */
const decodeExtended = (raw: string): Option.Option<ExtendedValue> => {
  const match = /^([^']*)'([^']*)'(.*)$/u.exec(raw);
  if (match === null) return Option.none();
  const [, charset = "", language = "", encoded = ""] = match;
  const value = Option.liftThrowable(decodeURIComponent)(encoded);
  const decoded = /^utf-8$/iu.test(charset)
    ? value
    : /^iso-8859-1$/iu.test(charset)
      ? Option.some(latin1(encoded))
      : Option.none();
  return Option.map(decoded, (text) => ({
    value: text,
    language: language === "" ? Option.none() : Option.some(language),
  }));
};

type Parameter = readonly [name: string, value: string];

/** The value of the first occurrence of `name`, if any. */
const first = (parameters: ReadonlyArray<Parameter>, name: string): Option.Option<string> =>
  Option.map(
    Arr.findFirst(parameters, ([key]) => key === name),
    ([, value]) => value,
  );

const SINGLE = ["rel", "anchor", "type", "media", "title", "title*", "hreflang"];

const linkOf = (target: string, rawParameters: string, base: string | URL | undefined): Link => {
  const parameters = Arr.map(
    Arr.fromIterable(rawParameters.matchAll(PARAMETERS)),
    ([, name = "", value = ""]): Parameter => [name.toLowerCase(), unquote(value)],
  );
  return {
    target: resolve(target, base),
    rel: Option.match(first(parameters, "rel"), { onNone: () => [], onSome: relsOf }),
    anchor: Option.map(first(parameters, "anchor"), (anchor) => resolve(anchor, base)),
    type: first(parameters, "type"),
    media: first(parameters, "media"),
    title: first(parameters, "title"),
    titleStar: Option.flatMap(first(parameters, "title*"), decodeExtended),
    hreflang: Arr.map(
      Arr.filter(parameters, ([name]) => name === "hreflang"),
      ([, value]) => value,
    ),
    params: Arr.filter(parameters, ([name]) => !SINGLE.includes(name)),
  };
};

/**
 * Parses a `Link` header value (or several, joined with `,`) into its
 * {@link Link}s, in order. Relative targets and anchors are resolved
 * against `base` when one is given (the request URL, as RFC 8288 §3.2
 * directs for HTTP). Never fails: a malformed link-value is skipped.
 *
 * @example
 * ```ts
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * const links = LinkHeader.parse(
 *   '</tables/1-metadata.json>; rel="describedby"; type="application/csvm+json"',
 *   "https://example.org/tables/1.csv",
 * )
 * console.log(links[0]?.target) // "https://example.org/tables/1-metadata.json"
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (header: string, base?: string | URL): ReadonlyArray<Link> =>
  Arr.map(Arr.fromIterable(header.matchAll(LINK_VALUE)), ([, target = "", parameters = ""]) =>
    linkOf(target.trim(), parameters, base),
  );

// ---- serialising ----

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const quote = (value: string): string => `"${value.replace(/["\\]/gu, "\\$&")}"`;
const tokenOrQuoted = (value: string): string => (TOKEN.test(value) ? value : quote(value));

/** RFC 8187 `attr-char`: everything else in an `ext-value` is pct-encoded. */
const NOT_ATTR_CHAR = /[^A-Za-z0-9!#$&+\-.^_`|~]/gu;
const encodeExtended = (extended: ExtendedValue): string =>
  `UTF-8'${Option.getOrElse(extended.language, () => "")}'${extended.value.replace(NOT_ATTR_CHAR, pctEncode)}`;

const serializeLink = (link: Link): string => {
  const parameters: ReadonlyArray<string> = [
    ...(Arr.isReadonlyArrayNonEmpty(link.rel) ? [`rel=${tokenOrQuoted(link.rel.join(" "))}`] : []),
    ...Option.toArray(Option.map(link.anchor, (anchor) => `anchor=${quote(anchor)}`)),
    ...Option.toArray(Option.map(link.type, (type) => `type=${tokenOrQuoted(type)}`)),
    ...Option.toArray(Option.map(link.media, (media) => `media=${tokenOrQuoted(media)}`)),
    ...Arr.map(link.hreflang, (hreflang) => `hreflang=${tokenOrQuoted(hreflang)}`),
    ...Option.toArray(Option.map(link.title, (title) => `title=${quote(title)}`)),
    ...Option.toArray(Option.map(link.titleStar, (title) => `title*=${encodeExtended(title)}`)),
    ...Arr.map(link.params, ([name, value]) => `${name}=${tokenOrQuoted(value)}`),
  ];
  return [`<${link.target}>`, ...parameters].join("; ");
};

/**
 * Serialises links as one `Link` header value: each `<target>` and its
 * parameters, links joined with `, `. Values that are not tokens are
 * quoted; `anchor` and `title` always are; `title*` is written as UTF-8.
 *
 * @example
 * ```ts
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * console.log(
 *   LinkHeader.serialize([
 *     LinkHeader.make("https://example.org/?page=2", { rel: "next" }),
 *     LinkHeader.make("https://example.org/", { rel: ["first", "prev"], titleStar: "€ rates" }),
 *   ]),
 * )
 * // <https://example.org/?page=2>; rel=next, <https://example.org/>; rel="first prev"; title*=UTF-8''%E2%82%AC%20rates
 * ```
 *
 * @since 0.1.0
 * @category serialising
 */
export const serialize = (links: ReadonlyArray<Link>): string =>
  Arr.map(links, serializeLink).join(", ");

// ---- querying ----

/**
 * Whether `link` has the relation type `rel` (a registered type compared
 * ignoring case, an extension URI exactly).
 *
 * @example
 * ```ts
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * console.log(LinkHeader.hasRel(LinkHeader.make("/a", { rel: "Next" }), "next")) // true
 * ```
 *
 * @since 0.1.0
 * @category querying
 */
export const hasRel = (link: Link, rel: string): boolean => link.rel.includes(normaliseRel(rel));

/**
 * The first link with the relation type `rel`; `None` when there is none.
 *
 * @example
 * ```ts
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * const links = LinkHeader.parse('<meta.json>; rel="describedby", <next>; rel=next')
 * console.log(LinkHeader.findRel(links, "describedby")._tag) // "Some"
 * ```
 *
 * @since 0.1.0
 * @category querying
 */
export const findRel = (links: ReadonlyArray<Link>, rel: string): Option.Option<Link> =>
  Arr.findFirst(links, (link) => hasRel(link, rel));

/**
 * Every link with the relation type `rel`, in order.
 *
 * @example
 * ```ts
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * const links = LinkHeader.parse('<a.fr.html>; rel=alternate; hreflang=fr, <a.de.html>; rel=alternate; hreflang=de')
 * console.log(LinkHeader.filterRel(links, "alternate").length) // 2
 * ```
 *
 * @since 0.1.0
 * @category querying
 */
export const filterRel = (links: ReadonlyArray<Link>, rel: string): ReadonlyArray<Link> =>
  Arr.filter(links, (link) => hasRel(link, rel));

/**
 * The decoded side of {@link LinkHeaderFromString}: the links of a header.
 *
 * @since 0.1.0
 * @category models
 */
export type LinkHeaderFromString = typeof LinkHeaderFromString.Type;

const isLinks = (input: unknown): input is ReadonlyArray<Link> =>
  Array.isArray(input) &&
  input.every(
    (link) => Predicate.hasProperty(link, "target") && Predicate.hasProperty(link, "rel"),
  );

/**
 * A `Link` header value as a schema: decodes by {@link parse} (with no
 * base, so targets stay as written) and encodes by {@link serialize}.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { LinkHeader } from "@thomasfosterau/effect-uri-template"
 *
 * const links = Schema.decodeUnknownSync(LinkHeader.LinkHeaderFromString)('<https://example.org/>; rel="up"')
 * console.log(Schema.encodeSync(LinkHeader.LinkHeaderFromString)(links)) // "<https://example.org/>; rel=up"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const LinkHeaderFromString: Schema.Codec<ReadonlyArray<Link>, string> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.declare(isLinks, { expected: "parsed Link header links" }),
    SchemaTransformation.transform({
      decode: (header: string) => parse(header),
      encode: serialize,
    }),
  ),
);
