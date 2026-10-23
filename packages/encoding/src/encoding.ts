/**
 * The WHATWG Encoding Standard on Effect: labels, BOM sniffing, and fatal
 * decoding of bytes and byte streams, with a typed error that says where
 * the input went wrong.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as Decoder from "./internal/decoder.ts";
import { ENCODING_NAMES as NAMES, LABELS, type EncodingName as Name } from "./internal/labels.ts";

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
export type Bom = Decoder.Bom;

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
export const sniffBom: (bytes: Uint8Array) => Option.Option<Bom> = Decoder.sniffBom;

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
export type BomHandling = Decoder.BomHandling;

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
 * The runtime cannot decode this encoding, and none of its tables is
 * bundled here. Some runtimes ship a `TextDecoder` without the legacy
 * encodings (small-ICU Node builds, some edge runtimes); see
 * {@link isSupported}.
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
 * it, or the table is bundled here (`ISO-8859-16` and `x-user-defined`,
 * which Node's `TextDecoder` lacks), or it is `replacement`.
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
export const isSupported: (encoding: EncodingName) => boolean = Decoder.isSupported;

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
  Effect.suspend(() =>
    Effect.mapError(
      Effect.fromResult(
        Decoder.make({
          encoding: options.encoding ?? "UTF-8",
          fatal: options.fatal ?? true,
          bomHandling: options.bomHandling ?? "sniff",
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
