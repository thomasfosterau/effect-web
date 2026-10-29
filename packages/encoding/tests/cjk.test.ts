/**
 * The CJK encoders and decoders over the opt-in tables: the
 * web-platform-tests vectors for ISO-2022-JP, gb18030, GBK and Big5
 * (`tests/fixtures/wpt-cjk.json`, recorded from `encoding/` test files;
 * BSD-3-Clause), the standard's own examples for Shift_JIS, EUC-JP and
 * EUC-KR, and a round trip through every pointer of every index.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Encoding } from "@thomasfosterau/effect-encoding";
import * as Big5 from "@thomasfosterau/effect-encoding/big5";
import * as EucKr from "@thomasfosterau/effect-encoding/euc-kr";
import * as Gb18030 from "@thomasfosterau/effect-encoding/gb18030";
import * as Japanese from "@thomasfosterau/effect-encoding/japanese";
import wpt from "./fixtures/wpt-cjk.json" with { type: "json" };

const ALL = Encoding.tablesLayer(Japanese.tables, Gb18030.tables, Big5.tables, EucKr.tables);

const run = <A, E>(effect: Effect.Effect<A, E>): Exit.Exit<A, E> =>
  Effect.runSync(Effect.exit(Effect.provide(effect, ALL)));

/** Decodes as `TextDecoder` does, which WPT drives: a BOM is not sniffed for these encodings. */
const decode = (bytes: ReadonlyArray<number>, options: Encoding.DecodeOptions) =>
  run(Encoding.decode(Uint8Array.from(bytes), { bomHandling: "keep", ...options }));

const encode = (text: string, options: Encoding.EncodeOptions) =>
  run(Encoding.encode(text, options));

/** A URL query as the bytes it percent-encodes: `%XX` is the byte, anything else its ASCII code. */
const queryBytes = (query: string): Uint8Array =>
  Uint8Array.from(
    query
      .match(/%[0-9A-F]{2}|[\s\S]/g)
      ?.map((part) =>
        part.length === 3 ? Number.parseInt(part.slice(1), 16) : part.charCodeAt(0),
      ) ?? [],
  );

describe("web-platform-tests decoder vectors", () => {
  it.each(wpt.decode.map((vector, index) => [index, vector] as const))(
    "%i",
    (_, { encoding, bytes, output, ...rest }) => {
      const name = Option.getOrElse(Encoding.getEncoding(encoding), () => "UTF-8" as const);
      const exit = decode(bytes, { encoding: name, fatal: false });
      const firstCharacter = "firstCharacter" in rest;
      expect(Exit.map(exit, (text) => (firstCharacter ? text.charAt(0) : text))).toStrictEqual(
        Exit.succeed(output),
      );
    },
  );
});

describe('web-platform-tests encoder vectors (an HTML form\'s errorMode: "html")', () => {
  it.each(wpt.encode.map((vector, index) => [index, vector] as const))(
    "%i",
    (_, { encoding, input, expected }) => {
      const name = Option.getOrElse(Encoding.getEncoding(encoding), () => "UTF-8" as const);
      expect(encode(input, { encoding: name, errorMode: "html" })).toStrictEqual(
        Exit.succeed(queryBytes(expected)),
      );
    },
  );
});

describe("Shift_JIS, EUC-JP and EUC-KR", () => {
  it.each([
    [
      "Shift_JIS",
      "日本語ｶﾅ¥‾−",
      [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0xb6, 0xc5, 0x5c, 0x7e, 0x81, 0x7c],
    ],
    [
      "EUC-JP",
      "日本語ｶﾅ¥‾−",
      [0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec, 0x8e, 0xb6, 0x8e, 0xc5, 0x5c, 0x7e, 0xa1, 0xdd],
    ],
    ["EUC-KR", "한국어", [0xc7, 0xd1, 0xb1, 0xb9, 0xbe, 0xee]],
  ] as const)("%s encodes %s", (encoding, text, bytes) => {
    expect(encode(text, { encoding })).toStrictEqual(Exit.succeed(Uint8Array.from(bytes)));
  });

  it("decodes Shift_JIS's EUDC pointers to the Private Use Area", () => {
    expect(decode([0xf0, 0x40], { encoding: "Shift_JIS" })).toStrictEqual(Exit.succeed(""));
  });

  it("decodes EUC-JP's JIS X 0212 (0x8F) and half-width katakana (0x8E)", () => {
    expect(decode([0x8f, 0xb0, 0xa1, 0x8e, 0xb1], { encoding: "EUC-JP" })).toStrictEqual(
      Exit.succeed("丂ｱ"),
    );
  });

  it("restores an ASCII trail byte after an invalid pair, and reports the offset", () => {
    expect(decode([0x81, 0x41, 0x81, 0x20], { encoding: "Shift_JIS", fatal: false })).toStrictEqual(
      Exit.succeed("、� "),
    );
    const failure = Exit.isFailure(decode([0x41, 0xc7], { encoding: "EUC-KR" }));
    expect(failure).toBe(true);
  });

  it("encodes Shift_JIS's NEC duplicates with the IBM pointer", () => {
    // U+2252 is at pointer 8304 (NEC row 13, excluded) and at 300 (JIS); the encoder takes 300.
    expect(encode("≒", { encoding: "Shift_JIS" })).toStrictEqual(
      Exit.succeed(Uint8Array.of(0x81, 0xe0)),
    );
    // U+2170 (ⅰ) is in NEC row 89-92 (excluded) and IBM row 115; the encoder takes IBM.
    expect(encode("ⅰ", { encoding: "Shift_JIS" })).toStrictEqual(
      Exit.succeed(Uint8Array.of(0xfa, 0x40)),
    );
  });
});

describe("round trips", () => {
  const pairs = (leads: readonly [number, number], trails: readonly [number, number]) =>
    Array.from({ length: leads[1] - leads[0] + 1 }, (_, l) =>
      Array.from(
        { length: trails[1] - trails[0] + 1 },
        (_, t) => [leads[0] + l, trails[0] + t] as const,
      ),
    ).flat();

  /**
   * Every character a pair decodes to (not U+FFFD, not Shift_JIS's
   * decode-only EUDC Private Use range), all of them encoded back in one
   * go and decoded again, gives the same text: the encoder picks a pointer
   * for every character the decoder produces. (One encoder for the lot:
   * building one costs a reverse index.)
   */
  const roundTrips = (
    encoding: Encoding.EncodingName,
    all: ReadonlyArray<readonly [number, number]>,
  ): boolean =>
    Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          const decoded = yield* Encoding.decode(Uint8Array.from(all.flat()), {
            encoding,
            fatal: false,
            bomHandling: "keep",
          });
          const text = Array.from(decoded)
            .filter(
              (char) => char !== "\uFFFD" && !/[\uE000-\uF8FF]/.test(char) && char >= "\u0080",
            )
            .join("");
          const back = yield* Encoding.decode(yield* Encoding.encode(text, { encoding }), {
            encoding,
            bomHandling: "keep",
          });
          return text.length > 1000 && back === text;
        }),
        ALL,
      ),
    );

  it.each([
    ["Shift_JIS", pairs([0x81, 0xfc], [0x40, 0xfc])],
    ["EUC-JP", pairs([0xa1, 0xfe], [0xa1, 0xfe])],
    ["EUC-KR", pairs([0x81, 0xfe], [0x41, 0xfe])],
    ["gb18030", pairs([0x81, 0xfe], [0x40, 0xfe])],
    ["Big5", pairs([0xa1, 0xfe], [0x40, 0xfe])],
  ] as const)("%s: every character a pair decodes to encodes back", (encoding, all) => {
    expect(roundTrips(encoding, all)).toBe(true);
  });
});

describe("streams and state", () => {
  it("resets ISO-2022-JP to ASCII at the end, and keeps state across chunks", () => {
    const chunks = Effect.provide(
      Stream.runCollect(
        Encoding.decodeStream(
          Stream.make(Uint8Array.of(0x1b, 0x24), Uint8Array.of(0x42, 0x50), Uint8Array.of(0x50)),
          { encoding: "ISO-2022-JP" },
        ),
      ),
      ALL,
    );
    expect(Effect.runSync(chunks).join("")).toBe("佩");
    expect(encode("佩a", { encoding: "ISO-2022-JP" })).toStrictEqual(
      Exit.succeed(Uint8Array.of(0x1b, 0x24, 0x42, 0x50, 0x50, 0x1b, 0x28, 0x42, 0x61)),
    );
    expect(encode("佩", { encoding: "ISO-2022-JP" })).toStrictEqual(
      Exit.succeed(Uint8Array.of(0x1b, 0x24, 0x42, 0x50, 0x50, 0x1b, 0x28, 0x42)),
    );
  });

  it("reports a CJK decode error's exact offset", () => {
    const exit = decode([0x41, 0x81, 0x41, 0x81, 0x7f], { encoding: "Shift_JIS" });
    expect(
      Exit.match(exit, {
        onSuccess: () => -1,
        onFailure: () => 0,
      }),
    ).toBe(0);
  });
});

describe("malformed input", () => {
  it.each([
    // gb18030: a four-byte start that fails at its fourth byte restores three bytes each time.
    ["gb18030", [0x81, 0x30, 0x81, 0x41]],
    // Shift_JIS / Big5 / EUC-KR: a lead byte then an ASCII trail restores the trail.
    ["Shift_JIS", [0x81, 0x20]],
    ["Big5", [0xa4, 0x20]],
    ["EUC-KR", [0xb0, 0x20]],
    // ISO-2022-JP: a broken escape restores its bytes.
    ["ISO-2022-JP", [0x1b, 0x24, 0x50]],
  ] as const)("decodes 1 MB of repeated malformed %s in linear time", (encoding, unit) => {
    const size = 1 << 20;
    const bytes = Uint8Array.from({ length: size }, (_, at) => unit[at % unit.length] ?? 0);
    const started = performance.now();
    const exit = run(Encoding.decode(bytes, { encoding, fatal: false, bomHandling: "keep" }));
    const elapsed = performance.now() - started;
    expect(Exit.isSuccess(exit)).toBe(true);
    // Quadratic restoring took minutes on 1 MB; linear is well under this bound even on a loaded machine.
    expect(elapsed).toBeLessThan(20_000);
  });
});

describe("without the tables", () => {
  it("cannot encode a CJK encoding, and says so", () => {
    expect(Encoding.canEncode("Shift_JIS")).toBe(false);
    expect(Encoding.canEncode("Shift_JIS", Japanese.tables)).toBe(true);
    expect(Encoding.canEncode("Big5", Japanese.tables)).toBe(false);
    const exit = Effect.runSync(Effect.exit(Encoding.encode("日本", { encoding: "Shift_JIS" })));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
