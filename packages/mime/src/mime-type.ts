/**
 * MIME types as the WHATWG MIME Sniffing Standard (§4) defines them: parse
 * a `type/subtype;name=value` string into a record with a lower-case type
 * and subtype and ordered, de-duplicated parameters, and serialise it back.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Str from "effect/String";

/* oxlint-disable effect/avoid-schema-suffix, effect/require-schema-type-alias */
/**
 * A parsed MIME type: `type` and `subtype` in ASCII lower case, and the
 * parameters in their order of first appearance, each name lower-case and
 * unique (§4.1, "MIME type record"). Values keep their case.
 *
 * @since 0.1.0
 * @category schemas
 */
export const MimeType = Schema.Struct({
  type: Schema.String,
  subtype: Schema.String,
  parameters: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
});
/* oxlint-enable effect/avoid-schema-suffix, effect/require-schema-type-alias */

/**
 * A parsed MIME type; see the {@link MimeType} schema.
 *
 * @since 0.1.0
 * @category models
 */
export type MimeType = typeof MimeType.Type;

/** HTTP whitespace: LF, CR, TAB and SPACE. */
const HTTP_WHITESPACE = /^[\n\r\t ]+|[\n\r\t ]+$/g;
const TRAILING_HTTP_WHITESPACE = /[\n\r\t ]+$/;
const LEADING_HTTP_WHITESPACE = /^[\n\r\t ]+/;
/** HTTP token code points (RFC 9110 `tchar`). */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** HTTP quoted-string token code points: TAB, U+0020 to U+007E, U+0080 to U+00FF. */
const QUOTED_STRING_TOKEN = /^[\t\u0020-\u007E\u0080-\u00FF]*$/;

/**
 * Collects an HTTP quoted string with its value extracted (Fetch §2.2.1),
 * from `position` (a `"`), returning the value and where it stopped.
 */
const collectQuotedString = (input: string, start: number): readonly [string, number] => {
  let value = "";
  let position = start + 1;
  // oxlint-disable-next-line effect/imperative-loops -- the specification's position-cursor algorithm, transcribed step for step.
  for (;;) {
    const [chunk, stop] = collectUntil(input, position, '"\\');
    value += chunk;
    position = stop;
    if (position >= input.length) break;
    const quoteOrBackslash = input[position];
    position += 1;
    if (quoteOrBackslash !== "\\") break;
    if (position >= input.length) {
      value += "\\";
      break;
    }
    value += input[position] ?? "";
    position += 1;
  }
  return [value, position];
};

/** Collects the code points from `position` up to (not including) the first of `stops`. */
const collectUntil = (input: string, start: number, stops: string): readonly [string, number] => {
  // UTF-16 offsets throughout, like every other cursor here: a stop is ASCII,
  // and `indexOf` counts code units, so a supplementary character cannot
  // shift the cursor.
  const ends = Array.from(stops, (stop) => input.indexOf(stop, start)).filter((at) => at >= 0);
  const end = Math.min(input.length, ...ends);
  return [input.slice(start, end), end];
};

/**
 * One parameter of §4.4's loop, from just after its `;`: the parameter if
 * it is valid, and where the next `;` (or the end) is.
 */
const parameterAt = (
  input: string,
  start: number,
): readonly [Option.Option<readonly [string, string]>, number] => {
  const skipped = input.slice(start).match(LEADING_HTTP_WHITESPACE)?.[0].length ?? 0;
  const [rawName, afterName] = collectUntil(input, start + skipped, ";=");
  // Validated before lowercasing: Unicode lowercasing maps the Kelvin sign
  // (U+212A) to ASCII `k`, which would make an invalid name look valid.
  const nameIsToken = TOKEN.test(rawName);
  const name = Str.toLowerCase(rawName);
  if (afterName >= input.length || input[afterName] === ";") return [Option.none(), afterName];
  const valueStart = afterName + 1;
  if (valueStart >= input.length) return [Option.none(), input.length];
  const [value, next] =
    input[valueStart] === '"'
      ? (() => {
          const [quoted, afterQuoted] = collectQuotedString(input, valueStart);
          return [quoted, collectUntil(input, afterQuoted, ";")[1]] as const;
        })()
      : (() => {
          const [raw, afterValue] = collectUntil(input, valueStart, ";");
          return [raw.replace(TRAILING_HTTP_WHITESPACE, ""), afterValue] as const;
        })();
  const unquotedEmpty = input[valueStart] !== '"' && Str.isEmpty(value);
  return unquotedEmpty || !nameIsToken || !QUOTED_STRING_TOKEN.test(value)
    ? [Option.none(), next]
    : [Option.some([name, value] as const), next];
};

/**
 * Parses a MIME type (§4.4, "parse a MIME type"). `None` when the string
 * has no valid `type/subtype`; a malformed parameter is skipped, and a
 * repeated parameter name keeps its first value.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { MimeType } from "@thomasfosterau/effect-mime"
 *
 * const parsed = MimeType.parse('Text/HTML; Charset="utf-8"; charset=latin1')
 * console.log(Option.map(parsed, MimeType.essence)) // Option.some("text/html")
 * console.log(Option.map(parsed, MimeType.serialize)) // Option.some("text/html;charset=utf-8")
 * console.log(Option.isNone(MimeType.parse("text"))) // true
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (input: string): Option.Option<MimeType> => {
  const trimmed = input.replace(HTTP_WHITESPACE, "");
  const [type, slash] = collectUntil(trimmed, 0, "/");
  if (!TOKEN.test(type) || slash >= trimmed.length) return Option.none();
  const [rawSubtype, afterSubtype] = collectUntil(trimmed, slash + 1, ";");
  const subtype = rawSubtype.replace(TRAILING_HTTP_WHITESPACE, "");
  if (!TOKEN.test(subtype)) return Option.none();

  const parameters: Array<readonly [string, string]> = [];
  let position = afterSubtype;
  // oxlint-disable-next-line effect/imperative-loops -- the specification's position-cursor algorithm, transcribed step for step.
  while (position < trimmed.length) {
    const [parameter, next] = parameterAt(trimmed, position + 1);
    position = next;
    Option.map(parameter, ([name, value]) => {
      if (!parameters.some(([existing]) => existing === name)) parameters.push([name, value]);
    });
  }
  return Option.some({
    type: Str.toLowerCase(type),
    subtype: Str.toLowerCase(subtype),
    parameters,
  });
};

/**
 * Serialises a MIME type (§4.5): `type/subtype`, then `;name=value` for
 * each parameter, quoting (and backslash-escaping `"` and `\` in) a value
 * that is empty or not an HTTP token.
 *
 * @example
 * ```ts
 * import { MimeType } from "@thomasfosterau/effect-mime"
 *
 * console.log(
 *   MimeType.serialize({ type: "text", subtype: "plain", parameters: [["title", "a b"]] }),
 * ) // 'text/plain;title="a b"'
 * ```
 *
 * @since 0.1.0
 * @category serialising
 */
export const serialize = (mimeType: MimeType): string =>
  essence(mimeType) +
  mimeType.parameters
    .map(
      ([name, value]) =>
        `;${name}=${TOKEN.test(value) ? value : `"${value.replace(/(["\\])/g, "\\$1")}"`}`,
    )
    .join("");

/**
 * A MIME type's essence: `type/subtype`, without parameters (§4.1).
 *
 * @example
 * ```ts
 * import { MimeType } from "@thomasfosterau/effect-mime"
 *
 * console.log(MimeType.essence({ type: "image", subtype: "svg+xml", parameters: [] })) // "image/svg+xml"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const essence = (mimeType: MimeType): string => `${mimeType.type}/${mimeType.subtype}`;

/**
 * A parameter's value, by its (case-insensitive) name.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { MimeType } from "@thomasfosterau/effect-mime"
 *
 * const parsed = MimeType.parse("text/csv; charset=windows-1252")
 * console.log(Option.flatMap(parsed, (mimeType) => MimeType.parameter(mimeType, "Charset")))
 * // Option.some("windows-1252")
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const parameter = (mimeType: MimeType, name: string): Option.Option<string> => {
  const key = Str.toLowerCase(name);
  return Option.map(
    Arr.findFirst(mimeType.parameters, ([existing]) => existing === key),
    ([, value]) => value,
  );
};

/**
 * Whether the type is an XML MIME type (§4.6): a subtype ending `+xml`, or
 * `text/xml` / `application/xml`.
 *
 * @example
 * ```ts
 * import { MimeType } from "@thomasfosterau/effect-mime"
 *
 * console.log(MimeType.isXml({ type: "image", subtype: "svg+xml", parameters: [] })) // true
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isXml = (mimeType: MimeType): boolean =>
  mimeType.subtype.endsWith("+xml") ||
  essence(mimeType) === "text/xml" ||
  essence(mimeType) === "application/xml";

/**
 * The decoded side of {@link MimeTypeFromString}: a {@link MimeType}.
 *
 * @since 0.1.0
 * @category models
 */
export type MimeTypeFromString = typeof MimeTypeFromString.Type;

/**
 * A MIME type as its string: decodes by {@link parse} (failing on a string
 * with no valid `type/subtype`), encodes by {@link serialize}. Decoding
 * then encoding normalises: `TEXT/HTML ;Charset=x` round-trips as
 * `text/html;charset=x`.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { MimeType } from "@thomasfosterau/effect-mime"
 *
 * const decoded = Schema.decodeUnknownSync(MimeType.MimeTypeFromString)("Application/JSON")
 * console.log(decoded.subtype) // "json"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const MimeTypeFromString: Schema.Codec<MimeType, string> = Schema.String.pipe(
  Schema.decodeTo(MimeType, {
    decode: SchemaGetter.transformEffect((input: string) =>
      Option.match(parse(input), {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.fail(new SchemaIssue.InvalidValue({ message: "not a MIME type" }, input)),
      }),
    ),
    encode: SchemaGetter.transform(serialize),
  }),
);
