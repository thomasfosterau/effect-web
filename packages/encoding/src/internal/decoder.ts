/**
 * The incremental decoder behind `decode` and `decodeStream`: a backend per
 * encoding (the runtime's `TextDecoder`, or a bundled table where the
 * runtime lacks one), BOM sniffing at the head of the input, and exact
 * error offsets.
 *
 * A fatal decoder runs a second, "shadow" backend in lockstep, fed only
 * input the primary accepted. When the primary rejects a chunk, the shadow
 * still holds the state from before it and is fed the chunk a byte at a
 * time, so the byte the error is detected at is known exactly, for every
 * encoding, stateful ones (ISO-2022-JP) included. Only fatal decoding pays
 * for the shadow, and only the failing chunk is fed byte-wise.
 */
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ISO_8859_16_HIGH } from "./iso-8859-16.ts";
import type { EncodingName } from "./labels.ts";

/** How a byte-order mark at the head of the input is treated. */
export type BomHandling = "sniff" | "strip" | "keep";

/** A byte-order mark: the encoding it names and its length in bytes. */
export interface Bom {
  readonly encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE";
  readonly length: number;
}

/** The Encoding Standard's BOM sniff (§6, "BOM sniff"). */
export const sniffBom = (bytes: Uint8Array): Option.Option<Bom> => {
  const [a, b, c] = bytes;
  if (a === 0xef && b === 0xbb && c === 0xbf) return Option.some({ encoding: "UTF-8", length: 3 });
  if (a === 0xfe && b === 0xff) return Option.some({ encoding: "UTF-16BE", length: 2 });
  if (a === 0xff && b === 0xfe) return Option.some({ encoding: "UTF-16LE", length: 2 });
  return Option.none();
};

/**
 * One encoding's decoder: `decode` returns the text the bytes complete, or
 * fails when they are malformed (only when fatal). `stream: false` also
 * ends the input, so a sequence still pending then is an error.
 */
interface Backend {
  readonly decode: (bytes: Uint8Array, stream: boolean) => Result.Result<string, void>;
}

/** A backend over the runtime's `TextDecoder`, or `None` when the runtime lacks the encoding. */
const textDecoderBackend = (
  encoding: EncodingName,
  fatal: boolean,
  ignoreBOM: boolean,
): Option.Option<Backend> =>
  Option.map(
    Result.getSuccess(
      Result.try({
        try: () => new TextDecoder(encoding, { fatal, ignoreBOM }),
        catch: () => undefined,
      }),
    ),
    (decoder): Backend => ({
      decode: (bytes, stream) =>
        Result.try({ try: () => decoder.decode(bytes, { stream }), catch: () => undefined }),
    }),
  );

/**
 * A stateless single-byte backend: ASCII as itself, every other byte
 * through `high` (character `n` is byte `0x80 + n`).
 */
const singleByteBackend = (high: (byte: number) => string): Backend => ({
  decode: (bytes) =>
    Result.succeed(
      Array.from(bytes, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : high(byte))).join(""),
    ),
});

/** `x-user-defined` (§14.5): bytes 0x80 to 0xFF map to U+F780 to U+F7FF. */
const xUserDefinedHigh = (byte: number): string => String.fromCharCode(0xf700 + byte);

/** ISO-8859-16 through its bundled index. */
const iso885916High = (byte: number): string => ISO_8859_16_HIGH.charAt(byte - 0x80);

/**
 * `replacement` (§14.1): any non-empty input is one error, which a
 * non-fatal decoder renders as a single U+FFFD.
 */
const replacementBackend = (fatal: boolean): Backend => {
  let done = false;
  return {
    decode: (bytes) => {
      if (done || bytes.byteLength === 0) return Result.succeed("");
      done = true;
      return fatal ? Result.fail(undefined) : Result.succeed("�");
    },
  };
};

/** The backend for an encoding: the runtime's, else a bundled one, else `None`. */
const backendFor = (
  encoding: EncodingName,
  fatal: boolean,
  ignoreBOM: boolean,
): Option.Option<Backend> => {
  if (encoding === "replacement") return Option.some(replacementBackend(fatal));
  return Option.orElse(textDecoderBackend(encoding, fatal, ignoreBOM), () => {
    if (encoding === "x-user-defined") return Option.some(singleByteBackend(xUserDefinedHigh));
    if (encoding === "ISO-8859-16") return Option.some(singleByteBackend(iso885916High));
    return Option.none();
  });
};

/** Whether this runtime (or a bundled table) can decode the encoding. */
export const isSupported = (encoding: EncodingName): boolean =>
  Option.isSome(backendFor(encoding, false, false));

/** A decoding failure: the encoding in use and the byte offset the error was detected at. */
export interface Failure {
  readonly encoding: EncodingName;
  readonly offset: number;
}

/** The incremental decoder: `push` each chunk, then `flush` once. */
export interface Decoder {
  readonly push: (bytes: Uint8Array) => Result.Result<string, Failure>;
  readonly flush: () => Result.Result<string, Failure>;
}

/** What {@link make} needs. */
export interface DecoderOptions {
  readonly encoding: EncodingName;
  readonly fatal: boolean;
  readonly bomHandling: BomHandling;
}

/** Concatenates two byte arrays. */
const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.byteLength === 0) return right;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
};

/** A primary backend and, when fatal, its shadow. */
interface Pair {
  readonly encoding: EncodingName;
  readonly primary: Backend;
  readonly shadow: Option.Option<Backend>;
}

/**
 * Builds the incremental decoder, or fails with the encoding the runtime
 * cannot decode. Under `sniff` the encoding is settled once three bytes
 * (or the end of input) have arrived, so a BOM can override it.
 */
export const make = (options: DecoderOptions): Result.Result<Decoder, EncodingName> => {
  const { fatal, bomHandling } = options;
  const pairFor = (encoding: EncodingName, ignoreBOM: boolean): Result.Result<Pair, EncodingName> =>
    Option.match(backendFor(encoding, fatal, ignoreBOM), {
      onNone: () => Result.fail(encoding),
      onSome: (primary) =>
        Result.succeed({
          encoding,
          primary,
          shadow: fatal ? backendFor(encoding, fatal, ignoreBOM) : Option.none(),
        }),
    });

  // Fail early for an unsupported encoding, even under `sniff` (where a BOM
  // might still have chosen another one): the caller asked for it. Only
  // `strip` leaves the BOM to the decoder; `sniff` removes it itself.
  const initial = pairFor(options.encoding, bomHandling !== "strip");
  if (Result.isFailure(initial)) return Result.fail(initial.failure);

  let pair: Option.Option<Pair> =
    bomHandling === "sniff" ? Option.none() : Option.some(initial.success);
  let head: Uint8Array = new Uint8Array(0);
  let consumed = 0;

  /** The offset within `bytes` of the byte the shadow rejects, fed one at a time. */
  const locate = (shadow: Backend, bytes: Uint8Array): number => {
    const index = bytes.findIndex((_, at) =>
      Result.isFailure(shadow.decode(bytes.subarray(at, at + 1), true)),
    );
    // Every byte was accepted mid-stream: the input ended inside a sequence.
    return index >= 0 ? index : bytes.length;
  };

  const run = (
    current: Pair,
    bytes: Uint8Array,
    stream: boolean,
  ): Result.Result<string, Failure> => {
    const start = consumed;
    consumed += bytes.length;
    const decoded = current.primary.decode(bytes, stream);
    if (Result.isSuccess(decoded)) {
      Option.map(current.shadow, (shadow) => shadow.decode(bytes, stream));
      return Result.succeed(decoded.success);
    }
    const offset = Option.match(current.shadow, {
      onNone: () => start + bytes.length,
      onSome: (shadow) => start + locate(shadow, bytes),
    });
    return Result.fail({ encoding: current.encoding, offset });
  };

  /** Settles the encoding from the buffered head (BOM sniff), then decodes the head. */
  const settle = (stream: boolean): Result.Result<string, Failure> => {
    const bom = sniffBom(head);
    const settled = Option.match(bom, {
      onNone: () => Result.succeed(initial.success),
      onSome: ({ encoding }) =>
        encoding === options.encoding ? Result.succeed(initial.success) : pairFor(encoding, true),
    });
    // A BOM-named encoding (UTF-8 / UTF-16) is always available; this arm is
    // only for a runtime with no UTF-16 at all.
    if (Result.isFailure(settled)) {
      return Result.fail({ encoding: settled.failure, offset: 0 });
    }
    pair = Option.some(settled.success);
    const skip = Option.match(bom, { onNone: () => 0, onSome: ({ length }) => length });
    consumed += skip;
    const rest = head.subarray(skip);
    head = new Uint8Array(0);
    return run(settled.success, rest, stream);
  };

  return Result.succeed({
    push: (bytes) =>
      Option.match(pair, {
        onSome: (current) => run(current, bytes, true),
        onNone: () => {
          head = concatBytes(head, bytes);
          return head.length >= 3 ? settle(true) : Result.succeed("");
        },
      }),
    flush: () =>
      Option.match(pair, {
        onSome: (current) => run(current, new Uint8Array(0), false),
        onNone: () => settle(false),
      }),
  });
};
