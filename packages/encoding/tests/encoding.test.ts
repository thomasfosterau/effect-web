/**
 * The Encoding module: the label table (checked against the runtime's own
 * `TextDecoder`), BOM sniffing, fatal decoding with byte offsets (vectors
 * from web-platform-tests `encoding/textdecoder-fatal.any.js`, BSD-3-Clause),
 * the bundled fallbacks, and chunked decoding agreeing with whole-input
 * decoding.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Stream from "effect/Stream";
import { Encoding } from "@thomasfosterau/effect-encoding";
import { LABELS } from "../src/internal/labels.ts";

const bytes = (...values: ReadonlyArray<number>): Uint8Array => new Uint8Array(values);

const decode = (input: Uint8Array, options?: Encoding.DecodeOptions) =>
  Effect.runSync(Effect.exit(Encoding.decode(input, options)));

const decodeChunks = (chunks: ReadonlyArray<Uint8Array>, options?: Encoding.DecodeOptions) =>
  Effect.runSync(
    Effect.exit(
      Effect.map(
        Stream.runCollect(Encoding.decodeStream(Stream.fromIterable(chunks), options)),
        (texts) => texts.join(""),
      ),
    ),
  );

const failureOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> =>
  Exit.isFailure(exit) ? Exit.findErrorOption(exit) : Option.none();

describe("getEncoding", () => {
  it("has the standard's 40 encodings and 228 labels", () => {
    expect(Encoding.ENCODING_NAMES).toHaveLength(40);
    expect(Record.keys(LABELS)).toHaveLength(228);
  });

  it("agrees with the runtime's TextDecoder on every label it supports", () => {
    const disagreements = Arr.getSomes(
      Arr.map(Record.toEntries(LABELS), ([label, name]) => {
        const runtime = Option.liftThrowable(() => new TextDecoder(label).encoding)();
        return Option.isSome(runtime) && runtime.value !== name.toLowerCase()
          ? Option.some([label, name, runtime.value])
          : Option.none();
      }),
    );
    expect(disagreements).toEqual([]);
  });

  it("trims ASCII whitespace and ignores case", () => {
    expect(Encoding.getEncoding(" \tLatin1\n ")).toStrictEqual(Option.some("windows-1252"));
    expect(Encoding.getEncoding("UTF8")).toStrictEqual(Option.some("UTF-8"));
    expect(Encoding.getEncoding("unicode-1-1-utf-8")).toStrictEqual(Option.some("UTF-8"));
    expect(Encoding.getEncoding("ISO-2022-KR")).toStrictEqual(Option.some("replacement"));
    expect(Encoding.getEncoding("sjis")).toStrictEqual(Option.some("Shift_JIS"));
  });

  it("returns None for an unknown label, and does not trim non-ASCII space", () => {
    expect(Encoding.getEncoding("utf-7")).toStrictEqual(Option.none());
    expect(Encoding.getEncoding(" utf-8")).toStrictEqual(Option.none());
    expect(Encoding.getEncoding("")).toStrictEqual(Option.none());
  });
});

describe("sniffBom", () => {
  it("names UTF-8, UTF-16BE and UTF-16LE", () => {
    expect(Encoding.sniffBom(bytes(0xef, 0xbb, 0xbf, 0x41))).toStrictEqual(
      Option.some({ encoding: "UTF-8", length: 3 }),
    );
    expect(Encoding.sniffBom(bytes(0xfe, 0xff))).toStrictEqual(
      Option.some({ encoding: "UTF-16BE", length: 2 }),
    );
    expect(Encoding.sniffBom(bytes(0xff, 0xfe, 0x00))).toStrictEqual(
      Option.some({ encoding: "UTF-16LE", length: 2 }),
    );
  });

  it("finds nothing in a partial or absent mark", () => {
    expect(Encoding.sniffBom(bytes(0xef, 0xbb))).toStrictEqual(Option.none());
    expect(Encoding.sniffBom(bytes())).toStrictEqual(Option.none());
    expect(Encoding.sniffBom(bytes(0x41, 0xfe, 0xff))).toStrictEqual(Option.none());
  });
});

describe("decode", () => {
  it("decodes UTF-8 by default and a legacy encoding on request", () => {
    expect(decode(bytes(0x63, 0x61, 0x66, 0xc3, 0xa9))).toStrictEqual(Exit.succeed("café"));
    expect(decode(bytes(0x63, 0x61, 0x66, 0xe9), { encoding: "windows-1252" })).toStrictEqual(
      Exit.succeed("café"),
    );
    expect(decode(bytes(0x82, 0xa0), { encoding: "Shift_JIS" })).toStrictEqual(Exit.succeed("あ"));
  });

  it("lets a BOM override the encoding under sniff, and removes it", () => {
    expect(decode(bytes(0xff, 0xfe, 0x41, 0x00), { encoding: "windows-1252" })).toStrictEqual(
      Exit.succeed("A"),
    );
    expect(decode(bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41))).toStrictEqual(
      Exit.succeed("﻿A"),
    );
  });

  it("strips only the requested encoding's BOM under strip, and keeps it under keep", () => {
    expect(decode(bytes(0xef, 0xbb, 0xbf, 0x41), { bomHandling: "strip" })).toStrictEqual(
      Exit.succeed("A"),
    );
    expect(
      decode(bytes(0xff, 0xfe, 0x41), { encoding: "windows-1252", bomHandling: "strip" }),
    ).toStrictEqual(Exit.succeed("ÿþA"));
    expect(decode(bytes(0xef, 0xbb, 0xbf, 0x41), { bomHandling: "keep" })).toStrictEqual(
      Exit.succeed("﻿A"),
    );
  });

  // web-platform-tests encoding/textdecoder-fatal.any.js: every case must fail.
  const fatalVectors: ReadonlyArray<readonly [Encoding.EncodingName, ReadonlyArray<number>]> = [
    ["UTF-8", [0xff]],
    ["UTF-8", [0xc0]],
    ["UTF-8", [0xe0]],
    ["UTF-8", [0xc0, 0x00]],
    ["UTF-8", [0xc0, 0xc0]],
    ["UTF-8", [0xe0, 0x00]],
    ["UTF-8", [0xe0, 0xc0]],
    ["UTF-8", [0xe0, 0x80, 0x00]],
    ["UTF-8", [0xe0, 0x80, 0xc0]],
    ["UTF-8", [0xfc, 0x80, 0x80, 0x80, 0x80, 0x80]],
    ["UTF-8", [0xfe, 0x80, 0x80, 0x80, 0x80, 0x80]],
    ["UTF-8", [0xc0, 0x80]],
    ["UTF-8", [0xe0, 0x80, 0x80]],
    ["UTF-8", [0xf0, 0x80, 0x80, 0x80]],
    ["UTF-8", [0xf8, 0x80, 0x80, 0x80, 0x80]],
    ["UTF-8", [0xc1, 0xbf]],
    ["UTF-8", [0xe0, 0x81, 0xbf]],
    ["UTF-8", [0xf0, 0x80, 0x81, 0xbf]],
    ["UTF-8", [0xe0, 0x9f, 0xbf]],
    ["UTF-8", [0xf0, 0x80, 0x9f, 0xbf]],
    ["UTF-8", [0xf0, 0x8f, 0xbf, 0xbf]],
    ["UTF-8", [0xf8, 0x84, 0x8f, 0xbf, 0xbf]],
    ["UTF-8", [0xed, 0xa0, 0x80]],
    ["UTF-8", [0xed, 0xb0, 0x80]],
    ["UTF-8", [0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80]],
    ["UTF-16LE", [0x00]],
  ];

  it.each(fatalVectors)("fails fatally on malformed %s %j", (encoding, input) => {
    const failure = failureOf(decode(new Uint8Array(input), { encoding }));
    expect(Option.map(failure, (error) => error._tag)).toStrictEqual(Option.some("DecodeError"));
  });

  it("reports the byte offset the error was detected at", () => {
    const offsetOf = (input: Uint8Array, options?: Encoding.DecodeOptions) =>
      Option.flatMap(failureOf(decode(input, options)), (error) =>
        error instanceof Encoding.DecodeError ? Option.some(error.offset) : Option.none(),
      );
    expect(offsetOf(bytes(0x61, 0xff, 0x62))).toStrictEqual(Option.some(1));
    expect(offsetOf(bytes(0x61, 0x62, 0xe0, 0x00))).toStrictEqual(Option.some(3));
    // A sequence cut short by the end of input: the input's length.
    expect(offsetOf(bytes(0x61, 0xe2, 0x82))).toStrictEqual(Option.some(3));
    expect(offsetOf(bytes(0x41, 0x00, 0x42), { encoding: "UTF-16LE" })).toStrictEqual(
      Option.some(3),
    );
    // Offsets count the BOM.
    expect(offsetOf(bytes(0xef, 0xbb, 0xbf, 0xff))).toStrictEqual(Option.some(3));
  });

  it("replaces malformed input instead when not fatal", () => {
    expect(decode(bytes(0x61, 0xff, 0x62), { fatal: false })).toStrictEqual(Exit.succeed("a�b"));
  });

  it("decodes the replacement encoding to a single error", () => {
    expect(decode(bytes(), { encoding: "replacement" })).toStrictEqual(Exit.succeed(""));
    expect(decode(bytes(0x41, 0x42), { encoding: "replacement", fatal: false })).toStrictEqual(
      Exit.succeed("�"),
    );
    const failure = failureOf(decode(bytes(0x41, 0x42), { encoding: "replacement" }));
    expect(
      Option.map(failure, (error) => (error instanceof Encoding.DecodeError ? error.offset : -1)),
    ).toStrictEqual(Option.some(0));
  });

  it("decodes the encodings Node's TextDecoder lacks from bundled tables", () => {
    expect(Encoding.isSupported("ISO-8859-16")).toBe(true);
    expect(Encoding.isSupported("x-user-defined")).toBe(true);
    expect(decode(bytes(0x41, 0xa4, 0xaa), { encoding: "ISO-8859-16" })).toStrictEqual(
      Exit.succeed("A€Ș"),
    );
    expect(decode(bytes(0x41, 0x80, 0xff), { encoding: "x-user-defined" })).toStrictEqual(
      Exit.succeed("A"),
    );
  });
});

describe("a runtime without the legacy encodings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("fails clearly with UnsupportedEncodingError", () => {
    utf8Only();
    expect(Encoding.isSupported("GBK")).toBe(false);
    const failure = failureOf(decode(bytes(0x41), { encoding: "GBK" }));
    expect(Option.map(failure, (error) => [error._tag, error.encoding])).toStrictEqual(
      Option.some(["UnsupportedEncodingError", "GBK"]),
    );
  });

  it("still decodes UTF-8 and the bundled encodings", () => {
    utf8Only();
    expect(decode(bytes(0xc3, 0xa9))).toStrictEqual(Exit.succeed("é"));
    expect(decode(bytes(0xa4), { encoding: "ISO-8859-16" })).toStrictEqual(Exit.succeed("€"));
  });
});

describe("decodeStream", () => {
  it("joins a multi-byte sequence split across chunks", () => {
    expect(decodeChunks([bytes(0x31, 0xe2, 0x82), bytes(0xac)])).toStrictEqual(Exit.succeed("1€"));
  });

  it("sniffs a BOM split across chunks", () => {
    expect(
      decodeChunks([bytes(0xff), bytes(0xfe, 0x41), bytes(0x00, 0x42, 0x00)], {
        encoding: "windows-1252",
      }),
    ).toStrictEqual(Exit.succeed("AB"));
    expect(decodeChunks([bytes(0x41)], { encoding: "windows-1252" })).toStrictEqual(
      Exit.succeed("A"),
    );
    expect(decodeChunks([])).toStrictEqual(Exit.succeed(""));
  });

  it("emits no empty strings", () => {
    const texts = Effect.runSync(
      Stream.runCollect(
        Encoding.decodeStream(Stream.make(bytes(0xe2), bytes(0x82), bytes(0xac)), {
          bomHandling: "keep",
        }),
      ),
    );
    expect(texts).toEqual(["€"]);
  });

  it("counts an error's offset from the start of the stream", () => {
    const failure = failureOf(decodeChunks([bytes(0x41, 0x42), bytes(0x43, 0xff)]));
    expect(
      Option.map(failure, (error) => (error instanceof Encoding.DecodeError ? error.offset : -1)),
    ).toStrictEqual(Option.some(3));
  });

  it("is pipeable", () => {
    const text = Effect.runSync(
      Stream.make(bytes(0xe9)).pipe(
        Encoding.decodeStream({ encoding: "windows-1252" }),
        Stream.runCollect,
      ),
    );
    expect(text).toEqual(["é"]);
  });

  /** A deterministic byte source (a linear congruential generator), biased towards UTF-8 lead and trail bytes. */
  const sample = (seed: number, length: number): Uint8Array => {
    const alphabet = [
      0x41, 0x7f, 0x80, 0xbf, 0xc2, 0xc3, 0xe2, 0xe0, 0xed, 0xf0, 0xf4, 0x82, 0xac, 0xff,
    ];
    return Uint8Array.from({ length }, (_, index) => {
      const next = (seed * 1103515245 + 12345 * (index + 1)) % 2147483648;
      return alphabet[next % alphabet.length] ?? 0x41;
    });
  };

  it.each(["UTF-8", "UTF-16LE", "Shift_JIS", "gb18030", "ISO-2022-JP"] as const)(
    "agrees with whole-input decoding under every chunking (%s)",
    (encoding) => {
      Arr.forEach(Arr.range(1, 40), (seed) => {
        const input = sample(seed, 12);
        const whole = decode(input, { encoding });
        Arr.forEach([1, 2, 3, 5], (size) => {
          const chunks = Arr.map(Arr.range(0, Math.ceil(input.length / size) - 1), (index) =>
            input.subarray(index * size, index * size + size),
          );
          expect(decodeChunks(chunks, { encoding })).toStrictEqual(whole);
        });
      });
    },
  );
});
