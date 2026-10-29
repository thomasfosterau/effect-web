/**
 * The incremental encoder behind `encode` and `encodeStream` (Encoding
 * Standard §4.3, "encode"): text in, bytes out, with the "fatal" and
 * "html" error modes. A chunk that ends in a high surrogate keeps it until
 * the next chunk, so a surrogate pair split across chunks encodes as one
 * code point; a lone surrogate is U+FFFD, as the standard's scalar-value
 * input requires.
 */
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import type { Name as EncodingName } from "./labels.ts";
import { singleByteHigh } from "./tables.ts";

/** What an encoder does with a code point its encoding cannot represent. */
export type ErrorMode = "fatal" | "html";

/** An unmappable code point under the "fatal" mode, and where it is. */
export interface EncodeFailure {
  readonly encoding: EncodingName;
  /** The UTF-16 code-unit offset of the code point, from the start of the input. */
  readonly offset: number;
  readonly codePoint: number;
}

/** The incremental encoder: `push` each chunk of text, then `flush` once. */
export interface Encoder {
  readonly push: (text: string) => Result.Result<Uint8Array, EncodeFailure>;
  readonly flush: () => Result.Result<Uint8Array, EncodeFailure>;
}

/** One code point's bytes, or `None` when the encoding cannot represent it. */
type Handler = (codePoint: number) => Option.Option<ReadonlyArray<number>>;

const isAscii = (codePoint: number): boolean => codePoint < 0x80;

/**
 * §9.2, "single-byte encoder", over the encoding's high half: the first
 * pointer whose code point is `codePoint` (U+FFFD marks an unmapped
 * pointer, never a mapping, and no index maps an astral code point).
 */
const singleByteHandler =
  (high: string): Handler =>
  (codePoint) => {
    if (isAscii(codePoint)) return Option.some([codePoint]);
    if (codePoint === 0xfffd || codePoint > 0xffff) return Option.none();
    const pointer = high.indexOf(String.fromCharCode(codePoint));
    return pointer < 0 ? Option.none() : Option.some([pointer + 0x80]);
  };

/** §14.5, "x-user-defined encoder". */
const xUserDefinedHandler: Handler = (codePoint) =>
  isAscii(codePoint)
    ? Option.some([codePoint])
    : codePoint >= 0xf780 && codePoint <= 0xf7ff
      ? Option.some([codePoint - 0xf780 + 0x80])
      : Option.none();

const utf8 = new TextEncoder();

/** UTF-8, which represents every code point. */
const utf8Handler: Handler = (codePoint) =>
  Option.some(Array.from(utf8.encode(String.fromCodePoint(codePoint))));

/** The handler for an encoding, or `None` when this package has no encoder for it. */
const handlerFor = (encoding: EncodingName): Option.Option<Handler> => {
  if (encoding === "UTF-8") return Option.some(utf8Handler);
  if (encoding === "x-user-defined") return Option.some(xUserDefinedHandler);
  return Option.map(singleByteHigh(encoding), singleByteHandler);
};

/** Whether this package can encode to the encoding. */
export const hasEncoder = (encoding: EncodingName): boolean => Option.isSome(handlerFor(encoding));

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;

/** `&#N;` as ASCII bytes: the "html" error mode's replacement. */
const htmlReference = (codePoint: number): ReadonlyArray<number> =>
  Array.from(`&#${codePoint};`, (char) => char.charCodeAt(0));

/** The code points of `text` with their code-unit offsets, a lone surrogate as U+FFFD. */
const codePoints = (text: string): ReadonlyArray<readonly [number, number]> =>
  Array.from(text).reduce<{
    readonly at: number;
    readonly points: Array<readonly [number, number]>;
  }>(
    ({ at, points }, char) => {
      const codePoint = char.codePointAt(0) ?? 0xfffd;
      points.push([codePoint >= 0xd800 && codePoint <= 0xdfff ? 0xfffd : codePoint, at]);
      return { at: at + char.length, points };
    },
    { at: 0, points: [] },
  ).points;

/**
 * Builds the incremental encoder, or fails with the encoding this package
 * cannot encode to.
 */
export const makeEncoder = (options: {
  readonly encoding: EncodingName;
  readonly mode: ErrorMode;
}): Result.Result<Encoder, EncodingName> =>
  Option.match(handlerFor(options.encoding), {
    onNone: () => Result.fail(options.encoding),
    onSome: (handler) => {
      let pending = "";
      let consumed = 0;
      const run = (text: string): Result.Result<Uint8Array, EncodeFailure> => {
        const start = consumed;
        consumed += text.length;
        const bytes: Array<number> = [];
        const failure = codePoints(text).find(([codePoint]) =>
          Option.match(handler(codePoint), {
            onSome: (encoded) => {
              bytes.push(...encoded);
              return false;
            },
            onNone: () => {
              if (options.mode === "fatal") return true;
              bytes.push(...htmlReference(codePoint));
              return false;
            },
          }),
        );
        return failure === undefined
          ? Result.succeed(Uint8Array.from(bytes))
          : Result.fail({
              encoding: options.encoding,
              offset: start + failure[1],
              codePoint: failure[0],
            });
      };
      return Result.succeed({
        push: (chunk) => {
          const text = pending + chunk;
          const keep =
            Str.isNonEmpty(text) && isHighSurrogate(text.charCodeAt(text.length - 1)) ? 1 : 0;
          pending = text.slice(text.length - keep);
          return run(text.slice(0, text.length - keep));
        },
        flush: () => {
          const text = pending;
          pending = "";
          return run(text);
        },
      });
    },
  });
