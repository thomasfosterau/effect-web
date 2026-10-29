/**
 * The single-byte tables and the encoders: the web-platform-tests
 * single-byte vectors (`tests/fixtures/wpt-single-byte.json`, from
 * `encoding/single-byte-decoder.any.js` and
 * `encoding/textdecoder-fatal-single-byte.any.js`; BSD-3-Clause), run
 * against the runtime's `TextDecoder` and against the bundled tables (a
 * runtime with only UTF-8), then `encode` and `encodeStream`.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Encoding } from "@thomasfosterau/effect-encoding";
import wpt from "./fixtures/wpt-single-byte.json" with { type: "json" };

const SINGLE_BYTE: ReadonlyArray<Encoding.EncodingName> = [
  "IBM866",
  "ISO-8859-2",
  "ISO-8859-3",
  "ISO-8859-4",
  "ISO-8859-5",
  "ISO-8859-6",
  "ISO-8859-7",
  "ISO-8859-8",
  "ISO-8859-8-I",
  "ISO-8859-10",
  "ISO-8859-13",
  "ISO-8859-14",
  "ISO-8859-15",
  "ISO-8859-16",
  "KOI8-R",
  "KOI8-U",
  "macintosh",
  "windows-874",
  "windows-1250",
  "windows-1251",
  "windows-1252",
  "windows-1253",
  "windows-1254",
  "windows-1255",
  "windows-1256",
  "windows-1257",
  "windows-1258",
  "x-mac-cyrillic",
];

const indexOf = (encoding: Encoding.EncodingName): (typeof wpt.indexes)["ISO-8859-3"] => {
  const indexes: Readonly<Record<string, (typeof wpt.indexes)["ISO-8859-3"]>> = wpt.indexes;
  return indexes[encoding === "ISO-8859-8-I" ? "ISO-8859-8" : encoding] ?? [];
};

const badOf = (encoding: Encoding.EncodingName): ReadonlyArray<number> => {
  const bad: Readonly<Record<string, ReadonlyArray<number>>> = wpt.bad;
  return bad[encoding] ?? [];
};

const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, byte) => byte);

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => Array.from(part)));

const run = <A, E>(effect: Effect.Effect<A, E>): Exit.Exit<A, E> =>
  Effect.runSync(Effect.exit(effect));

const failureOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> =>
  Exit.isFailure(exit) ? Exit.findErrorOption(exit) : Option.none();

/** What `single-byte-decoder.any.js` expects bytes 0x00 to 0xFF to decode to. */
const expected = (encoding: Encoding.EncodingName): string =>
  String.fromCharCode(
    ...Array.from(ALL_BYTES, (byte) =>
      byte < 0x80 ? byte : (indexOf(encoding)[byte - 0x80] ?? 0xfffd),
    ),
  );

/** A `TextDecoder` that knows only UTF-8, as on a small-ICU runtime. */
const utf8Only = (): void => {
  const Native = globalThis.TextDecoder;
  vi.stubGlobal(
    "TextDecoder",
    class extends Native {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (label !== undefined && label.toLowerCase() !== "utf-8") {
          throw new RangeError(`The "${label}" encoding is not supported`);
        }
        super(label, options);
      }
    },
  );
};

const backends = [
  ["this runtime", () => undefined],
  ["a runtime whose TextDecoder knows only UTF-8", utf8Only],
] as const;

describe.each(backends)("single-byte decoding on %s", (_, setUp) => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(SINGLE_BYTE)("%s (single-byte-decoder.any.js)", (encoding) => {
    setUp();
    expect(Encoding.isSupported(encoding)).toBe(true);
    expect(run(Encoding.decode(ALL_BYTES, { encoding, fatal: false }))).toStrictEqual(
      Exit.succeed(expected(encoding)),
    );
  });

  it.each(SINGLE_BYTE)("%s (textdecoder-fatal-single-byte.any.js)", (encoding) => {
    setUp();
    const bad = badOf(encoding);
    const rejected = Array.from(ALL_BYTES).filter((byte) =>
      Exit.isFailure(run(Encoding.decode(Uint8Array.of(byte), { encoding }))),
    );
    expect(rejected).toStrictEqual(bad);
    // The offset of the first rejected byte in a run of every byte.
    Option.map(Option.fromUndefinedOr(bad[0]), (first) => {
      expect(
        Option.map(failureOf(run(Encoding.decode(ALL_BYTES, { encoding }))), (error) =>
          error instanceof Encoding.DecodeError ? error.offset : -1,
        ),
      ).toStrictEqual(Option.some(first));
    });
  });
});

const encode = (text: string, options?: Encoding.EncodeOptions) =>
  run(Encoding.encode(text, options));

describe("encode, the single-byte encodings", () => {
  it.each(SINGLE_BYTE)("%s round-trips every mapped byte", (encoding) => {
    const mapped = Uint8Array.from(
      Array.from(ALL_BYTES).filter((byte) => !badOf(encoding).includes(byte)),
    );
    const text = Effect.runSync(Encoding.decode(mapped, { encoding }));
    expect(encode(text, { encoding })).toStrictEqual(Exit.succeed(mapped));
  });

  it("fails on an unmappable code point with its offset and code point", () => {
    const failure = failureOf(encode("ab→c", { encoding: "windows-1252" }));
    expect(
      Option.map(failure, (error) =>
        error instanceof Encoding.EncodeError
          ? [error.encoding, error.offset, error.codePoint]
          : [],
      ),
    ).toStrictEqual(Option.some(["windows-1252", 2, 0x2192]));
  });

  it("counts the offset in UTF-16 code units, an astral code point taking two", () => {
    const failure = failureOf(encode("😀x😀", { encoding: "ISO-8859-2" }));
    expect(
      Option.map(failure, (error) =>
        error instanceof Encoding.EncodeError ? [error.offset, error.codePoint] : [],
      ),
    ).toStrictEqual(Option.some([0, 0x1f600]));
    const later = failureOf(encode("x😀", { encoding: "ISO-8859-2" }));
    expect(
      Option.map(later, (error) => (error instanceof Encoding.EncodeError ? error.offset : -1)),
    ).toStrictEqual(Option.some(1));
  });

  it('writes &#N; for an unmappable code point under errorMode: "html"', () => {
    expect(encode("a→😀", { encoding: "windows-1252", errorMode: "html" })).toStrictEqual(
      Exit.succeed(new TextEncoder().encode("a&#8594;&#128512;")),
    );
  });

  it("encodes a lone surrogate as U+FFFD, which a single-byte encoding cannot represent", () => {
    expect(
      Option.map(failureOf(encode("a\uD800", { encoding: "windows-1252" })), (error) =>
        error instanceof Encoding.EncodeError ? error.codePoint : -1,
      ),
    ).toStrictEqual(Option.some(0xfffd));
  });
});

describe("encode, UTF-8 and x-user-defined", () => {
  it("encodes UTF-8 as TextEncoder does, by default, a lone surrogate as U+FFFD", () => {
    const text = "aé€😀\uDC00b";
    expect(encode(text)).toStrictEqual(Exit.succeed(new TextEncoder().encode(text)));
  });

  it("encodes x-user-defined's U+F780 to U+F7FF as bytes 0x80 to 0xFF", () => {
    expect(encode("A", { encoding: "x-user-defined" })).toStrictEqual(
      Exit.succeed(Uint8Array.of(0x41, 0x80, 0xff)),
    );
    expect(Exit.isFailure(encode("é", { encoding: "x-user-defined" }))).toBe(true);
  });
});

describe("encodings without an encoder", () => {
  it("fails with UnsupportedEncodingError for replacement, UTF-16 and (for now) the CJK encodings", () => {
    (["replacement", "UTF-16LE", "UTF-16BE", "GBK", "Shift_JIS"] as const).forEach((encoding) => {
      expect(Encoding.canEncode(encoding)).toBe(false);
      expect(
        Option.map(failureOf(encode("a", { encoding })), (error) => [error._tag, error.encoding]),
      ).toStrictEqual(Option.some(["UnsupportedEncodingError", encoding]));
    });
  });

  it("maps them to an output encoding as the standard does", () => {
    expect(Encoding.getOutputEncoding("replacement")).toBe("UTF-8");
    expect(Encoding.getOutputEncoding("UTF-16BE")).toBe("UTF-8");
    expect(Encoding.getOutputEncoding("Shift_JIS")).toBe("Shift_JIS");
  });
});

describe("encodeStream", () => {
  const encodeChunks = (chunks: ReadonlyArray<string>, options?: Encoding.EncodeOptions) =>
    run(
      Effect.map(
        Stream.runCollect(Encoding.encodeStream(Stream.fromIterable(chunks), options)),
        (parts) => Array.from(parts),
      ),
    );

  it("joins a surrogate pair split across chunks, and agrees with encode", () => {
    const exit = encodeChunks(["a\uD83D", "\uDE00b"]);
    expect(Exit.map(exit, concat)).toStrictEqual(Exit.succeed(new TextEncoder().encode("a😀b")));
  });

  it("encodes a high surrogate left at the end as U+FFFD", () => {
    expect(Exit.map(encodeChunks(["a\uD83D"]), concat)).toStrictEqual(
      Exit.succeed(Uint8Array.of(0x61, 0xef, 0xbf, 0xbd)),
    );
  });

  it("counts a failure's offset from the start of the stream", () => {
    const failure = failureOf(encodeChunks(["abc", "d→"], { encoding: "ISO-8859-15" }));
    expect(
      Option.map(failure, (error) => (error instanceof Encoding.EncodeError ? error.offset : -1)),
    ).toStrictEqual(Option.some(4));
  });

  it("runs twice with a fresh encoder", () => {
    const stream = Encoding.encodeStream(Stream.make("x\uD83D"));
    const once = Effect.runSync(Stream.runCollect(stream));
    const twice = Effect.runSync(Stream.runCollect(stream));
    expect(Array.from(twice)).toStrictEqual(Array.from(once));
  });
});
