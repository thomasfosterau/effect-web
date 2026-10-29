/**
 * The WHATWG Encoding Standard on Effect: labels, BOM sniffing, fatal
 * decoding of bytes and byte streams, and encoding text to UTF-8 and the
 * legacy single-byte encodings, with typed errors that say where the input
 * went wrong.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as Cjk from "./internal/cjk.ts";
import * as Decoder from "./internal/decoder.ts";
import * as Encoder from "./internal/encoder.ts";
import { LABELS, NAMES, type Name } from "./internal/labels.ts";

/**
 * An encoding's name, as the Encoding Standard spells it (`UTF-8`,
 * `windows-1252`, `Shift_JIS`): one of the 40 in {@link ENCODING_NAMES}.
 * A label (`latin1`, `utf8`) becomes a name through {@link getEncoding}.
 *
 * @since 0.1.0
 * @category models
 */
export type EncodingName = Name;

/**
 * Every encoding the standard defines, in its order (§4.2): UTF-8, the
 * single-byte legacy encodings, the CJK ones, `replacement`, UTF-16BE and
 * UTF-16LE, and `x-user-defined`.
 *
 * @example
 * ```ts
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * console.log(Encoding.ENCODING_NAMES.length) // 40
 * ```
 *
 * @since 0.1.0
 * @category constants
 */
export const ENCODING_NAMES: ReadonlyArray<EncodingName> = NAMES;

/**
 * Resolves a label to its encoding (§4.2, "get an encoding"): leading and
 * trailing ASCII whitespace removed, matched ASCII case-insensitively
 * against the standard's 228 labels. `None` for an unknown label; note that
 * some labels (`iso-2022-kr`, `hz-gb-2312`) name the `replacement`
 * encoding, which decodes any input to a single error.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * console.log(Encoding.getEncoding(" Latin1 ")) // Option.some("windows-1252")
 * console.log(Option.isNone(Encoding.getEncoding("utf-7"))) // true
 * ```
 *
 * @since 0.1.0
 * @category labels
 */
export const getEncoding = (label: string): Option.Option<EncodingName> =>
  Record.get<string, EncodingName>(
    LABELS,
    Str.toLowerCase(label.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "")),
  );

/**
 * A byte-order mark found by {@link sniffBom}: the encoding it names and
 * how many bytes it takes.
 *
 * @since 0.1.0
 * @category models
 */
export type Bom = Decoder.ByteOrderMark;

/**
 * The standard's BOM sniff (§6): `EF BB BF` is UTF-8, `FE FF` UTF-16BE,
 * `FF FE` UTF-16LE. A standalone step, so a host format can layer its own
 * detection on top (XML's Appendix F, HTML's `<meta charset>` prescan).
 *
 * @example
 * ```ts
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * console.log(Encoding.sniffBom(new Uint8Array([0xff, 0xfe, 0x41, 0x00])))
 * // Option.some({ encoding: "UTF-16LE", length: 2 })
 * ```
 *
 * @since 0.1.0
 * @category bom
 */
export const sniffBom: (bytes: Uint8Array) => Option.Option<Bom> = Decoder.bomOf;

/**
 * What a decoder does with a byte-order mark at the head of the input:
 *
 * - `"sniff"` (the default) — the standard's "decode": a BOM overrides the
 *   requested encoding and is removed.
 * - `"strip"` — "decode without BOM sniffing" in spirit: the requested
 *   encoding stands, and its own BOM is removed if present.
 * - `"keep"` — the requested encoding stands, and a BOM is decoded as
 *   U+FEFF like any other character.
 *
 * @since 0.1.0
 * @category models
 */
export type BomHandling = Decoder.BomMode;

/**
 * Options for {@link decode} and {@link decodeStream}.
 *
 * @since 0.1.0
 * @category models
 */
export interface DecodeOptions {
  /** The encoding to decode with (before BOM sniffing). Defaults to `UTF-8`. */
  readonly encoding?: EncodingName | undefined;
  /**
   * Whether malformed input fails with a {@link DecodeError}. Defaults to
   * `true`; `false` decodes it to U+FFFD, as `TextDecoder` does by default.
   */
  readonly fatal?: boolean | undefined;
  /** What to do with a byte-order mark. Defaults to `"sniff"`. */
  readonly bomHandling?: BomHandling | undefined;
}

/**
 * Malformed input under fatal decoding. `offset` is the 0-based byte
 * offset, from the start of the input (a BOM included), of the byte at
 * which the error was detected; input that ends inside a multi-byte
 * sequence reports the input's length. `encoding` is the encoding in use,
 * which a BOM may have chosen.
 *
 * @since 0.1.0
 * @category errors
 */
export class DecodeError extends Schema.TaggedError<DecodeError>()("DecodeError", {
  encoding: Schema.String,
  offset: Schema.Number,
  message: Schema.String,
}) {}

/**
 * The encoding is not available for the operation: the runtime cannot
 * decode it and its table is not bundled here (a CJK encoding on a runtime
 * whose `TextDecoder` lacks it; see {@link isSupported}), or there is no
 * encoder for it (see {@link canEncode}).
 *
 * @since 0.1.0
 * @category errors
 */
export class UnsupportedEncodingError extends Schema.TaggedError<UnsupportedEncodingError>()(
  "UnsupportedEncodingError",
  {
    encoding: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Whether this runtime can decode the encoding: its `TextDecoder` knows
 * it, or the table is bundled here (every single-byte encoding and
 * `x-user-defined`, used when the runtime's `TextDecoder` lacks one, as
 * small-ICU builds and some edge runtimes do), or `tables` (see
 * {@link Tables}) holds its CJK index, or it is `replacement`.
 *
 * @example
 * ```ts
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * console.log(Encoding.isSupported("UTF-8")) // true
 * console.log(Encoding.isSupported("x-user-defined")) // true (bundled)
 * ```
 *
 * @since 0.1.0
 * @category decoding
 */
export const isSupported: (encoding: EncodingName, tables?: Tables) => boolean = (
  encoding,
  tables,
) => Decoder.canDecode(encoding, tables);

const decodeError = (failure: Decoder.Failure): DecodeError =>
  new DecodeError({
    encoding: failure.encoding,
    offset: failure.offset,
    message: `Malformed ${failure.encoding} input at byte ${failure.offset}`,
  });

const unsupported = (encoding: EncodingName): UnsupportedEncodingError =>
  new UnsupportedEncodingError({
    encoding,
    message: `This runtime cannot decode ${encoding}`,
  });

const makeDecoder = (
  options: DecodeOptions,
): Effect.Effect<Decoder.Decoder, UnsupportedEncodingError> =>
  Effect.flatMap(Effect.service(EncodingTables), (tables) =>
    Effect.mapError(
      Effect.fromResult(
        Decoder.make({
          encoding: options.encoding ?? "UTF-8",
          fatal: options.fatal ?? true,
          bomHandling: options.bomHandling ?? "sniff",
          tables,
        }),
      ),
      unsupported,
    ),
  );

const lift = (result: Result.Result<string, Decoder.Failure>): Effect.Effect<string, DecodeError> =>
  Effect.mapError(Effect.fromResult(result), decodeError);

/**
 * Decodes bytes to a string (§6, "decode"). Fatal by default: malformed
 * input fails with a {@link DecodeError} carrying the byte offset, never a
 * replacement character unless `fatal: false` asks for one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * const latin1 = await Effect.runPromise(
 *   Encoding.decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { encoding: "windows-1252" }),
 * )
 * console.log(latin1) // "café"
 *
 * const error = await Effect.runPromise(
 *   Effect.flip(Encoding.decode(new Uint8Array([0x61, 0xff, 0x62]))),
 * )
 * if (error instanceof Encoding.DecodeError) console.log(error.offset) // 1
 * ```
 *
 * @since 0.1.0
 * @category decoding
 */
export const decode = (
  bytes: Uint8Array,
  options: DecodeOptions = {},
): Effect.Effect<string, DecodeError | UnsupportedEncodingError> =>
  Effect.flatMap(makeDecoder(options), (decoder) =>
    Effect.flatMap(lift(decoder.push(bytes)), (text) =>
      Effect.map(lift(decoder.flush()), (rest) => text + rest),
    ),
  );

/**
 * Decodes a stream of byte chunks to a stream of text, a multi-byte
 * sequence split across chunks included. Fatal by default, failing the
 * stream with a {@link DecodeError} whose offset counts from the start of
 * the stream. Each run of the stream gets its own decoder. Empty strings
 * are not emitted.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * // "€" (E2 82 AC) split across two chunks
 * const chunks = Stream.make(new Uint8Array([0x31, 0xe2, 0x82]), new Uint8Array([0xac]))
 * const text = await Effect.runPromise(
 *   Stream.runCollect(Encoding.decodeStream(chunks)),
 * )
 * console.log(text.join("")) // "1€"
 * ```
 *
 * @since 0.1.0
 * @category decoding
 */
export const decodeStream: {
  (
    options?: DecodeOptions,
  ): <E, R>(
    self: Stream.Stream<Uint8Array, E, R>,
  ) => Stream.Stream<string, E | DecodeError | UnsupportedEncodingError, R>;
  <E, R>(
    self: Stream.Stream<Uint8Array, E, R>,
    options?: DecodeOptions,
  ): Stream.Stream<string, E | DecodeError | UnsupportedEncodingError, R>;
} = dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(
    self: Stream.Stream<Uint8Array, E, R>,
    options: DecodeOptions = {},
  ): Stream.Stream<string, E | DecodeError | UnsupportedEncodingError, R> =>
    Stream.unwrap(
      Effect.map(makeDecoder(options), (decoder) =>
        self.pipe(
          Stream.mapEffect((bytes) => lift(decoder.push(bytes))),
          Stream.concat(Stream.fromEffect(Effect.suspend(() => lift(decoder.flush())))),
          Stream.filter((text) => text !== ""),
        ),
      ),
    ),
);

/**
 * One of the CJK index sets, from an opt-in entry
 * (`@thomasfosterau/effect-encoding/japanese`, `/gb18030`, `/big5`,
 * `/euc-kr`), each exporting `tables`. Give them to {@link tablesLayer}.
 * Kept out of the main entry so a program that never meets a CJK encoding
 * never loads the indexes (a few hundred kilobytes).
 *
 * @since 0.1.0
 * @category tables
 */
export type Tables = Cjk.CjkTables;

/**
 * One index inside {@link Tables}: its code points from pointer `base` on,
 * U+FFFD where it has no entry, and `astral`, the pointers whose code
 * point is outside the Basic Multilingual Plane, as pointer, code point
 * pairs.
 *
 * @since 0.1.0
 * @category tables
 */
export type IndexData = Cjk.CjkIndexData;

/**
 * The CJK tables {@link encode}, {@link decode} and their stream forms
 * use, read from the context; none by default. Provide them with
 * {@link tablesLayer}.
 *
 * @since 0.1.0
 * @category tables
 */
export const EncodingTables: Context.Reference<Tables> = /*#__PURE__*/ Context.Reference(
  "@thomasfosterau/effect-encoding/EncodingTables",
  { defaultValue: () => Cjk.EMPTY },
);

/**
 * A layer providing CJK tables to {@link EncodingTables}, so that
 * {@link encode} can encode Shift_JIS, EUC-JP, ISO-2022-JP, gb18030, GBK,
 * Big5 and EUC-KR, and {@link decode} decodes them by the standard's
 * algorithms rather than the runtime's `TextDecoder` (which a small-ICU
 * runtime lacks, and whose mappings can differ from the standard's).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 * import * as EucKr from "@thomasfosterau/effect-encoding/euc-kr"
 * import * as Japanese from "@thomasfosterau/effect-encoding/japanese"
 *
 * const program = Effect.gen(function* () {
 *   const bytes = yield* Encoding.encode("カナ", { encoding: "ISO-2022-JP" })
 *   return yield* Encoding.decode(bytes, { encoding: "ISO-2022-JP" })
 * })
 * const text = await Effect.runPromise(
 *   program.pipe(Effect.provide(Encoding.tablesLayer(Japanese.tables, EucKr.tables))),
 * )
 * console.log(text) // "カナ"
 * ```
 *
 * @since 0.1.0
 * @category tables
 */
export const tablesLayer = (...tables: ReadonlyArray<Tables>): Layer.Layer<never> =>
  Layer.succeed(EncodingTables, Cjk.merge(tables));

/**
 * The encoding to encode with in place of the given one (§4.3, "get an
 * output encoding"): `replacement`, `UTF-16BE` and `UTF-16LE`, which have
 * no encoder, become `UTF-8`; any other encoding is itself. What a URL
 * parser or an HTML form does with a document's encoding.
 *
 * @example
 * ```ts
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * console.log(Encoding.getOutputEncoding("UTF-16LE")) // "UTF-8"
 * console.log(Encoding.getOutputEncoding("windows-1252")) // "windows-1252"
 * ```
 *
 * @since 0.1.0
 * @category encoding
 */
export const getOutputEncoding = (encoding: EncodingName): EncodingName =>
  encoding === "replacement" || encoding === "UTF-16BE" || encoding === "UTF-16LE"
    ? "UTF-8"
    : encoding;

/**
 * Whether {@link encode} can encode to the encoding: UTF-8, every
 * single-byte encoding and `x-user-defined`, and a CJK encoding when
 * `tables` (see {@link Tables}) holds its index. `replacement` and UTF-16
 * have no encoder in the standard (see {@link getOutputEncoding}).
 *
 * @example
 * ```ts
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * console.log(Encoding.canEncode("windows-1252")) // true
 * console.log(Encoding.canEncode("UTF-16LE")) // false
 * ```
 *
 * @since 0.1.0
 * @category encoding
 */
export const canEncode: (encoding: EncodingName, tables?: Tables) => boolean = (encoding, tables) =>
  Encoder.hasEncoder(encoding, tables);

/**
 * What {@link encode} does with a code point the encoding cannot represent
 * (§4.1, "error mode"):
 *
 * - `"fatal"` (the default) — fail with an {@link EncodeError}.
 * - `"html"` — write the decimal character reference `&#N;`, as an HTML
 *   form does. The reference cannot be told apart from the same text
 *   written literally, so this loses information silently.
 *
 * @since 0.1.0
 * @category models
 */
export type EncodeErrorMode = Encoder.ErrorMode;

/**
 * Options for {@link encode} and {@link encodeStream}.
 *
 * @since 0.1.0
 * @category models
 */
export interface EncodeOptions {
  /** The encoding to encode to. Defaults to `UTF-8`. */
  readonly encoding?: EncodingName | undefined;
  /** What to do with an unmappable code point. Defaults to `"fatal"`. */
  readonly errorMode?: EncodeErrorMode | undefined;
}

/**
 * A code point the encoding cannot represent, under the `"fatal"` error
 * mode. `offset` is its UTF-16 code-unit offset (a JavaScript string
 * index) from the start of the input; `codePoint` is the code point (a
 * lone surrogate in the input is encoded as U+FFFD, so it reports 0xFFFD).
 *
 * @since 0.1.0
 * @category errors
 */
export class EncodeError extends Schema.TaggedError<EncodeError>()("EncodeError", {
  encoding: Schema.String,
  offset: Schema.Number,
  codePoint: Schema.Number,
  message: Schema.String,
}) {}

const encodeError = (failure: Encoder.EncodeFailure): EncodeError =>
  new EncodeError({
    encoding: failure.encoding,
    offset: failure.offset,
    codePoint: failure.codePoint,
    message: `U+${failure.codePoint.toString(16).toUpperCase().padStart(4, "0")} at offset ${failure.offset} cannot be encoded in ${failure.encoding}`,
  });

const makeEncoder = (
  options: EncodeOptions,
): Effect.Effect<Encoder.Encoder, UnsupportedEncodingError> =>
  Effect.flatMap(Effect.service(EncodingTables), (tables) =>
    Effect.mapError(
      Effect.fromResult(
        Encoder.makeEncoder({
          encoding: options.encoding ?? "UTF-8",
          mode: options.errorMode ?? "fatal",
          tables,
        }),
      ),
      (encoding) =>
        new UnsupportedEncodingError({
          encoding,
          message: `There is no encoder for ${encoding}`,
        }),
    ),
  );

const liftEncoded = (
  result: Result.Result<Uint8Array, Encoder.EncodeFailure>,
): Effect.Effect<Uint8Array, EncodeError> =>
  Effect.mapError(Effect.fromResult(result), encodeError);

/**
 * Encodes text to bytes (§4.3, "encode"). Fatal by default: a code point
 * the encoding cannot represent fails with an {@link EncodeError} carrying
 * its offset; `errorMode: "html"` writes `&#N;` instead. A lone surrogate
 * is encoded as U+FFFD. An encoding with no encoder (see {@link canEncode})
 * fails with an {@link UnsupportedEncodingError}. The CJK encodings need
 * their tables provided (see {@link tablesLayer}).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * const bytes = await Effect.runPromise(Encoding.encode("café €5", { encoding: "windows-1252" }))
 * console.log(Array.from(bytes, (byte) => byte.toString(16))) // ["63", "61", "66", "e9", "20", "80", "35"]
 *
 * const error = await Effect.runPromise(
 *   Effect.flip(Encoding.encode("a→b", { encoding: "windows-1252" })),
 * )
 * if (error instanceof Encoding.EncodeError) console.log(error.offset, error.codePoint) // 1 8594
 *
 * const html = await Effect.runPromise(
 *   Encoding.encode("a→b", { encoding: "windows-1252", errorMode: "html" }),
 * )
 * console.log(new TextDecoder().decode(html)) // "a&#8594;b"
 * ```
 *
 * @since 0.1.0
 * @category encoding
 */
export const encode = (
  text: string,
  options: EncodeOptions = {},
): Effect.Effect<Uint8Array, EncodeError | UnsupportedEncodingError> =>
  Effect.flatMap(makeEncoder(options), (encoder) =>
    Effect.flatMap(liftEncoded(encoder.push(text)), (head) =>
      Effect.map(liftEncoded(encoder.flush()), (rest) => {
        if (rest.byteLength === 0) return head;
        const joined = new Uint8Array(head.byteLength + rest.byteLength);
        joined.set(head);
        joined.set(rest, head.byteLength);
        return joined;
      }),
    ),
  );

/**
 * Encodes a stream of text chunks to a stream of byte chunks, a surrogate
 * pair split across chunks included. Fatal by default, failing the stream
 * with an {@link EncodeError} whose offset counts UTF-16 code units from
 * the start of the stream. Each run of the stream gets its own encoder.
 * Empty chunks are not emitted.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Encoding } from "@thomasfosterau/effect-encoding"
 *
 * const chunks = await Effect.runPromise(
 *   Stream.runCollect(
 *     Encoding.encodeStream(Stream.make("naïve, ", "€1"), { encoding: "ISO-8859-15" }),
 *   ),
 * )
 * console.log(chunks.map((chunk) => chunk.length)) // [7, 2]
 * ```
 *
 * @since 0.1.0
 * @category encoding
 */
export const encodeStream: {
  (
    options?: EncodeOptions,
  ): <E, R>(
    self: Stream.Stream<string, E, R>,
  ) => Stream.Stream<Uint8Array, E | EncodeError | UnsupportedEncodingError, R>;
  <E, R>(
    self: Stream.Stream<string, E, R>,
    options?: EncodeOptions,
  ): Stream.Stream<Uint8Array, E | EncodeError | UnsupportedEncodingError, R>;
} = dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(
    self: Stream.Stream<string, E, R>,
    options: EncodeOptions = {},
  ): Stream.Stream<Uint8Array, E | EncodeError | UnsupportedEncodingError, R> =>
    Stream.unwrap(
      Effect.map(makeEncoder(options), (encoder) =>
        self.pipe(
          Stream.mapEffect((text) => liftEncoded(encoder.push(text))),
          Stream.concat(Stream.fromEffect(Effect.suspend(() => liftEncoded(encoder.flush())))),
          Stream.filter((bytes) => bytes.byteLength > 0),
        ),
      ),
    ),
);
