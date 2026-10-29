/**
 * The Encoding Standard's CJK decoders and encoders (§10 to §13): gb18030
 * and GBK, Big5, EUC-JP, ISO-2022-JP, Shift_JIS and EUC-KR, over the
 * indexes a caller provides from the opt-in entries (`/japanese`,
 * `/gb18030`, `/big5`, `/euc-kr`).
 *
 * The decoders are the specification's byte handlers, run by one driver
 * that honours "restore to the I/O queue" and end-of-queue; the encoders
 * are its code-point handlers. Both are transcribed step for step.
 */
/* oxlint-disable effect/imperative-loops, effect/no-length-comparison, effect/prefer-arr-match, effect/prefer-match-over-switch, effect/avoid-direct-tag-checks -- the specification's handler algorithms over an I/O queue, transcribed step for step; the driver loop runs once per byte on the hot path. */
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type { Name as EncodingName } from "./labels.ts";

/**
 * One index: its code points from pointer `base` on (U+FFFD where the
 * index has no entry), plus `astral`, the pointers whose code point is
 * outside the Basic Multilingual Plane, as pointer, code point pairs.
 */
export interface IndexData {
  readonly base: number;
  readonly codePoints: string;
  readonly astral?: ReadonlyArray<number> | undefined;
}

/** The CJK indexes a program has provided; each entry module fills some of them. */
export interface Tables {
  readonly _tag: "EncodingTables";
  readonly jis0208?: IndexData | undefined;
  readonly jis0212?: IndexData | undefined;
  readonly iso2022jpKatakana?: IndexData | undefined;
  readonly gb18030?: IndexData | undefined;
  readonly gb18030Ranges?: ReadonlyArray<number> | undefined;
  readonly big5?: IndexData | undefined;
  readonly eucKr?: IndexData | undefined;
}

/** No tables. */
export const EMPTY: Tables = { _tag: "EncodingTables" };

/** Every table of every argument, a later one winning. */
export const merge = (all: ReadonlyArray<Tables>): Tables =>
  all.reduce<Tables>((merged, tables) => ({ ...merged, ...tables }), EMPTY);

/** The end of the queue, where a handler is called with no byte or code point. */
const EOQ = -1;

/** The index code point for `pointer`, or `-1` (null). */
const codePointAt = (index: IndexData, pointer: number): number => {
  const at = pointer - index.base;
  if (at < 0 || at >= index.codePoints.length) return -1;
  const unit = index.codePoints.charCodeAt(at);
  if (unit !== 0xfffd) return unit;
  const astral = index.astral ?? [];
  for (let i = 0; i < astral.length; i += 2) {
    if (astral[i] === pointer) return astral[i + 1] ?? -1;
  }
  return -1;
};

// ── Decoding ────────────────────────────────────────────────────────────

/** What a byte handler returns (§4.1). */
type Step =
  | { readonly _tag: "Continue" }
  | { readonly _tag: "Finished" }
  | { readonly _tag: "Emit"; readonly codePoints: ReadonlyArray<number> }
  | { readonly _tag: "Error"; readonly restore: ReadonlyArray<number> };

const CONTINUE: Step = { _tag: "Continue" };
const FINISHED: Step = { _tag: "Finished" };
const emit = (...codePoints: ReadonlyArray<number>): Step => ({ _tag: "Emit", codePoints });
const error = (...restore: ReadonlyArray<number>): Step => ({ _tag: "Error", restore });

/** A decoder's handler: a byte, or `EOQ`. Stateful; one per decoder. */
type ByteHandler = (byte: number) => Step;

const isAsciiByte = (byte: number): boolean => byte >= 0x00 && byte <= 0x7f;
const inRange = (value: number, low: number, high: number): boolean =>
  value >= low && value <= high;

/** §10.2.1, gb18030 decoder (GBK's too). */
const gb18030Decoder = (index: IndexData, ranges: ReadonlyArray<number>): ByteHandler => {
  let first = 0;
  let second = 0;
  let third = 0;
  return (byte) => {
    if (byte === EOQ) {
      if (first === 0 && second === 0 && third === 0) return FINISHED;
      first = 0;
      second = 0;
      third = 0;
      return error();
    }
    if (third !== 0) {
      if (!inRange(byte, 0x30, 0x39)) {
        const restore = [second, third, byte];
        first = 0;
        second = 0;
        third = 0;
        return error(...restore);
      }
      const codePoint = rangesCodePoint(
        ranges,
        (first - 0x81) * (10 * 126 * 10) +
          (second - 0x30) * (10 * 126) +
          (third - 0x81) * 10 +
          byte -
          0x30,
      );
      first = 0;
      second = 0;
      third = 0;
      return codePoint < 0 ? error() : emit(codePoint);
    }
    if (second !== 0) {
      if (inRange(byte, 0x81, 0xfe)) {
        third = byte;
        return CONTINUE;
      }
      const restore = [second, byte];
      first = 0;
      second = 0;
      return error(...restore);
    }
    if (first !== 0) {
      if (inRange(byte, 0x30, 0x39)) {
        second = byte;
        return CONTINUE;
      }
      const leading = first;
      first = 0;
      const offset = byte < 0x7f ? 0x40 : 0x41;
      const pointer =
        inRange(byte, 0x40, 0x7e) || inRange(byte, 0x80, 0xfe)
          ? (leading - 0x81) * 190 + (byte - offset)
          : -1;
      const codePoint = pointer < 0 ? -1 : codePointAt(index, pointer);
      if (codePoint >= 0) return emit(codePoint);
      return isAsciiByte(byte) ? error(byte) : error();
    }
    if (isAsciiByte(byte)) return emit(byte);
    if (byte === 0x80) return emit(0x20ac);
    if (inRange(byte, 0x81, 0xfe)) {
      first = byte;
      return CONTINUE;
    }
    return error();
  };
};

/** The index gb18030 ranges code point for `pointer` (§5), or `-1`. */
const rangesCodePoint = (ranges: ReadonlyArray<number>, pointer: number): number => {
  if ((pointer > 39419 && pointer < 189000) || pointer > 1237575) return -1;
  if (pointer === 7457) return 0xe7c7;
  let offset = 0;
  let codePointOffset = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const start = ranges[i] ?? 0;
    if (start > pointer) break;
    offset = start;
    codePointOffset = ranges[i + 1] ?? 0;
  }
  return codePointOffset + pointer - offset;
};

/** The index gb18030 ranges pointer for `codePoint` (§5). */
const rangesPointer = (ranges: ReadonlyArray<number>, codePoint: number): number => {
  if (codePoint === 0xe7c7) return 7457;
  let offset = 0;
  let pointerOffset = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const start = ranges[i + 1] ?? 0;
    if (start > codePoint) break;
    offset = start;
    pointerOffset = ranges[i] ?? 0;
  }
  return pointerOffset + codePoint - offset;
};

/** §11.1.1, Big5 decoder. */
const big5Decoder = (index: IndexData): ByteHandler => {
  let lead = 0;
  return (byte) => {
    if (byte === EOQ) {
      if (lead === 0) return FINISHED;
      lead = 0;
      return error();
    }
    if (lead !== 0) {
      const leading = lead;
      lead = 0;
      const offset = byte < 0x7f ? 0x40 : 0x62;
      const pointer =
        inRange(byte, 0x40, 0x7e) || inRange(byte, 0xa1, 0xfe)
          ? (leading - 0x81) * 157 + (byte - offset)
          : -1;
      if (pointer === 1133) return emit(0x00ca, 0x0304);
      if (pointer === 1135) return emit(0x00ca, 0x030c);
      if (pointer === 1164) return emit(0x00ea, 0x0304);
      if (pointer === 1166) return emit(0x00ea, 0x030c);
      const codePoint = pointer < 0 ? -1 : codePointAt(index, pointer);
      if (codePoint >= 0) return emit(codePoint);
      return isAsciiByte(byte) ? error(byte) : error();
    }
    if (isAsciiByte(byte)) return emit(byte);
    if (inRange(byte, 0x81, 0xfe)) {
      lead = byte;
      return CONTINUE;
    }
    return error();
  };
};

/** §12.1.1, EUC-JP decoder. */
const eucJpDecoder = (jis0208: IndexData, jis0212: Option.Option<IndexData>): ByteHandler => {
  let lead = 0;
  let use0212 = false;
  return (byte) => {
    if (byte === EOQ) {
      if (lead === 0) return FINISHED;
      lead = 0;
      return error();
    }
    if (lead === 0x8e && inRange(byte, 0xa1, 0xdf)) {
      lead = 0;
      return emit(0xff61 - 0xa1 + byte);
    }
    if (lead === 0x8f && inRange(byte, 0xa1, 0xfe)) {
      use0212 = true;
      lead = byte;
      return CONTINUE;
    }
    if (lead !== 0) {
      const leading = lead;
      lead = 0;
      const pointer = (leading - 0xa1) * 94 + byte - 0xa1;
      const both = inRange(leading, 0xa1, 0xfe) && inRange(byte, 0xa1, 0xfe);
      const codePoint = !both
        ? -1
        : use0212
          ? Option.match(jis0212, {
              onNone: () => -1,
              onSome: (index) => codePointAt(index, pointer),
            })
          : codePointAt(jis0208, pointer);
      use0212 = false;
      if (codePoint >= 0) return emit(codePoint);
      return isAsciiByte(byte) ? error(byte) : error();
    }
    if (isAsciiByte(byte)) return emit(byte);
    if (byte === 0x8e || byte === 0x8f || inRange(byte, 0xa1, 0xfe)) {
      lead = byte;
      return CONTINUE;
    }
    return error();
  };
};

type Iso2022JpState =
  | "ascii"
  | "roman"
  | "katakana"
  | "leading"
  | "trailing"
  | "escape-start"
  | "escape";

/** §12.2.1, ISO-2022-JP decoder. */
const iso2022JpDecoder = (jis0208: IndexData): ByteHandler => {
  let state: Iso2022JpState = "ascii";
  let outputState: Iso2022JpState = "ascii";
  let lead = 0;
  let output = false;
  const plain = (byte: number, mapped: (byte: number) => number): Step => {
    if (byte === 0x1b) {
      state = "escape-start";
      return CONTINUE;
    }
    if (byte === EOQ) return FINISHED;
    output = false;
    const codePoint = mapped(byte);
    return codePoint < 0 ? error() : emit(codePoint);
  };
  return (byte) => {
    switch (state) {
      case "ascii":
        return plain(byte, (b) => (inRange(b, 0, 0x7f) && b !== 0x0e && b !== 0x0f ? b : -1));
      case "roman":
        return plain(byte, (b) =>
          b === 0x5c
            ? 0xa5
            : b === 0x7e
              ? 0x203e
              : inRange(b, 0, 0x7f) && b !== 0x0e && b !== 0x0f
                ? b
                : -1,
        );
      case "katakana":
        return plain(byte, (b) => (inRange(b, 0x21, 0x5f) ? 0xff61 - 0x21 + b : -1));
      case "leading": {
        if (byte === 0x1b) {
          state = "escape-start";
          return CONTINUE;
        }
        if (byte === EOQ) return FINISHED;
        output = false;
        if (inRange(byte, 0x21, 0x7e)) {
          lead = byte;
          state = "trailing";
          return CONTINUE;
        }
        return error();
      }
      case "trailing": {
        if (byte === 0x1b) {
          state = "escape-start";
          return error();
        }
        state = "leading";
        if (inRange(byte, 0x21, 0x7e)) {
          const codePoint = codePointAt(jis0208, (lead - 0x21) * 94 + byte - 0x21);
          return codePoint < 0 ? error() : emit(codePoint);
        }
        return error();
      }
      case "escape-start": {
        if (byte === 0x24 || byte === 0x28) {
          lead = byte;
          state = "escape";
          return CONTINUE;
        }
        output = false;
        state = outputState;
        return byte === EOQ ? error() : error(byte);
      }
      case "escape": {
        const leading = lead;
        lead = 0;
        const next: Option.Option<Iso2022JpState> =
          leading === 0x28 && byte === 0x42
            ? Option.some("ascii")
            : leading === 0x28 && byte === 0x4a
              ? Option.some("roman")
              : leading === 0x28 && byte === 0x49
                ? Option.some("katakana")
                : leading === 0x24 && (byte === 0x40 || byte === 0x42)
                  ? Option.some("leading")
                  : Option.none();
        if (Option.isSome(next)) {
          state = next.value;
          outputState = next.value;
          const previous = output;
          output = true;
          return previous ? error() : CONTINUE;
        }
        output = false;
        state = outputState;
        return byte === EOQ ? error(leading) : error(leading, byte);
      }
    }
  };
};

/** §12.3.1, Shift_JIS decoder. */
const shiftJisDecoder = (jis0208: IndexData): ByteHandler => {
  let lead = 0;
  return (byte) => {
    if (byte === EOQ) {
      if (lead === 0) return FINISHED;
      lead = 0;
      return error();
    }
    if (lead !== 0) {
      const leading = lead;
      lead = 0;
      const offset = byte < 0x7f ? 0x40 : 0x41;
      const leadingOffset = leading < 0xa0 ? 0x81 : 0xc1;
      const pointer =
        inRange(byte, 0x40, 0x7e) || inRange(byte, 0x80, 0xfc)
          ? (leading - leadingOffset) * 188 + byte - offset
          : -1;
      if (inRange(pointer, 8836, 10715)) return emit(0xe000 - 8836 + pointer);
      const codePoint = pointer < 0 ? -1 : codePointAt(jis0208, pointer);
      if (codePoint >= 0) return emit(codePoint);
      return isAsciiByte(byte) ? error(byte) : error();
    }
    if (isAsciiByte(byte) || byte === 0x80) return emit(byte);
    if (inRange(byte, 0xa1, 0xdf)) return emit(0xff61 - 0xa1 + byte);
    if (inRange(byte, 0x81, 0x9f) || inRange(byte, 0xe0, 0xfc)) {
      lead = byte;
      return CONTINUE;
    }
    return error();
  };
};

/** §13.1.1, EUC-KR decoder. */
const eucKrDecoder = (index: IndexData): ByteHandler => {
  let lead = 0;
  return (byte) => {
    if (byte === EOQ) {
      if (lead === 0) return FINISHED;
      lead = 0;
      return error();
    }
    if (lead !== 0) {
      const leading = lead;
      lead = 0;
      const pointer = inRange(byte, 0x41, 0xfe) ? (leading - 0x81) * 190 + (byte - 0x41) : -1;
      const codePoint = pointer < 0 ? -1 : codePointAt(index, pointer);
      if (codePoint >= 0) return emit(codePoint);
      return isAsciiByte(byte) ? error(byte) : error();
    }
    if (isAsciiByte(byte)) return emit(byte);
    if (inRange(byte, 0x81, 0xfe)) {
      lead = byte;
      return CONTINUE;
    }
    return error();
  };
};

/** The byte handler for a CJK encoding, when its tables are provided. */
const decoderFor = (encoding: EncodingName, tables: Tables): Option.Option<() => ByteHandler> => {
  const { jis0208, jis0212, gb18030, gb18030Ranges, big5, eucKr } = tables;
  switch (encoding) {
    case "GBK":
    case "gb18030":
      return gb18030 === undefined || gb18030Ranges === undefined
        ? Option.none()
        : Option.some(() => gb18030Decoder(gb18030, gb18030Ranges));
    case "Big5":
      return big5 === undefined ? Option.none() : Option.some(() => big5Decoder(big5));
    case "EUC-JP":
      return jis0208 === undefined
        ? Option.none()
        : Option.some(() => eucJpDecoder(jis0208, Option.fromUndefinedOr(jis0212)));
    case "ISO-2022-JP":
      return jis0208 === undefined ? Option.none() : Option.some(() => iso2022JpDecoder(jis0208));
    case "Shift_JIS":
      return jis0208 === undefined ? Option.none() : Option.some(() => shiftJisDecoder(jis0208));
    case "EUC-KR":
      return eucKr === undefined ? Option.none() : Option.some(() => eucKrDecoder(eucKr));
    default:
      return Option.none();
  }
};

/** A chunk decoder over a byte handler: `decode` as the decoder module's backends have it. */
export interface CjkBackend {
  readonly decode: (bytes: Uint8Array, stream: boolean) => Result.Result<string, void>;
}

/**
 * The backend for a CJK encoding from the provided tables, or `None`. It
 * runs the handler over the bytes (§4.1, "process a queue"), restoring
 * bytes to the front of the queue as the handler asks (a small buffer read
 * before the input, never an insertion into it); at the end of the
 * input (`stream: false`) it runs the handler on end-of-queue until it
 * finishes. A fatal backend fails on the first error; otherwise each error
 * is U+FFFD.
 */
export const cjkBackend = (
  encoding: EncodingName,
  tables: Tables,
  fatal: boolean,
): Option.Option<CjkBackend> =>
  Option.map(decoderFor(encoding, tables), (make) => {
    const handler = make();
    return {
      decode: (bytes, stream) => {
        // Restored bytes go in `pending`, read before the rest of the input:
        // at most three (gb18030's « second, third, byte »), so the driver
        // stays linear in the input however malformed it is.
        let pending: ReadonlyArray<number> = [];
        const out: Array<number> = [];
        let at = 0;
        let ending = false;
        for (;;) {
          let step: Step;
          const [restored, ...rest] = pending;
          if (restored !== undefined) {
            pending = rest;
            step = handler(restored);
          } else if (at < bytes.length) {
            step = handler(bytes[at] ?? 0);
            at += 1;
          } else if (!stream && !ending) {
            step = handler(EOQ);
            if (step._tag === "Finished") ending = true;
          } else {
            break;
          }
          if (step._tag === "Emit") out.push(...step.codePoints);
          if (step._tag === "Error") {
            if (fatal) return Result.fail(undefined);
            out.push(0xfffd);
            pending = [...step.restore, ...pending];
          }
        }
        let text = "";
        for (let start = 0; start < out.length; start += 8192) {
          text += String.fromCodePoint(...out.slice(start, start + 8192));
        }
        return Result.succeed(text);
      },
    };
  });

/** Whether the provided tables decode the encoding. */
export const hasCjkDecoder = (encoding: EncodingName, tables: Tables): boolean =>
  Option.isSome(decoderFor(encoding, tables));

// ── Encoding ────────────────────────────────────────────────────────────

/** What a code-point handler returns: bytes, then possibly an error with a code point. */
export interface EncodeStep {
  readonly bytes: ReadonlyArray<number>;
  readonly error: Option.Option<number>;
}

/** An encoder's handler: each code point, then `finish` at the end of the queue. */
export interface CodePointHandler {
  readonly encode: (codePoint: number) => EncodeStep;
  readonly finish: () => ReadonlyArray<number>;
}

const ok = (...bytes: ReadonlyArray<number>): EncodeStep => ({ bytes, error: Option.none() });
const fail = (codePoint: number, ...bytes: ReadonlyArray<number>): EncodeStep => ({
  bytes,
  error: Option.some(codePoint),
});

/**
 * The index pointer lookup for an index (§5, "index pointer"): the first
 * pointer `keep` accepts for each code point, with `last` code points
 * taking the last instead (the index Big5 pointer's exceptions). Built
 * once per encoder.
 */
const pointerLookup = (
  index: IndexData,
  keep: (pointer: number) => boolean,
  last: ReadonlyArray<number> = [],
): ((codePoint: number) => number) => {
  const bmp = new Int32Array(0x10000).fill(-1);
  const units = index.codePoints;
  for (let at = 0; at < units.length; at += 1) {
    const pointer = index.base + at;
    const unit = units.charCodeAt(at);
    if (unit === 0xfffd || !keep(pointer)) continue;
    if (bmp[unit] === -1 || last.includes(unit)) bmp[unit] = pointer;
  }
  const astral = index.astral ?? [];
  return (codePoint) => {
    if (codePoint <= 0xffff) return bmp[codePoint] ?? -1;
    for (let i = 0; i < astral.length; i += 2) {
      const pointer = astral[i] ?? -1;
      if (astral[i + 1] === codePoint && keep(pointer)) return pointer;
    }
    return -1;
  };
};

const NOTHING: ReadonlyArray<number> = [];

/** §10.2.2, gb18030 encoder (`gbk` for GBK's). */
const gb18030Encoder = (
  index: IndexData,
  ranges: ReadonlyArray<number>,
  gbk: boolean,
): CodePointHandler => {
  const pointerOf = pointerLookup(index, () => true);
  // The GB18030-2022 side table: code point, then its two bytes, per row.
  const SIDE: ReadonlyArray<number> = [
    0xe78d, 0xa6, 0xd9, 0xe78e, 0xa6, 0xda, 0xe78f, 0xa6, 0xdb, 0xe790, 0xa6, 0xdc, 0xe791, 0xa6,
    0xdd, 0xe792, 0xa6, 0xde, 0xe793, 0xa6, 0xdf, 0xe794, 0xa6, 0xec, 0xe795, 0xa6, 0xed, 0xe796,
    0xa6, 0xf3, 0xe81e, 0xfe, 0x59, 0xe826, 0xfe, 0x61, 0xe82b, 0xfe, 0x66, 0xe82c, 0xfe, 0x67,
    0xe832, 0xfe, 0x6d, 0xe843, 0xfe, 0x7e, 0xe854, 0xfe, 0x90, 0xe864, 0xfe, 0xa0,
  ];
  const side = (codePoint: number): Option.Option<readonly [number, number]> => {
    for (let i = 0; i < SIDE.length; i += 3) {
      if (SIDE[i] === codePoint) return Option.some([SIDE[i + 1] ?? 0, SIDE[i + 2] ?? 0]);
    }
    return Option.none();
  };
  return {
    encode: (codePoint) => {
      if (codePoint <= 0x7f) return ok(codePoint);
      if (codePoint === 0xe5e5) return fail(codePoint);
      if (gbk && codePoint === 0x20ac) return ok(0x80);
      const row = side(codePoint);
      if (Option.isSome(row)) return ok(...row.value);
      const pointer = pointerOf(codePoint);
      if (pointer >= 0) {
        const trailing = pointer % 190;
        return ok(Math.floor(pointer / 190) + 0x81, trailing + (trailing < 0x3f ? 0x40 : 0x41));
      }
      if (gbk) return fail(codePoint);
      let rest = rangesPointer(ranges, codePoint);
      const byte1 = Math.floor(rest / (10 * 126 * 10));
      rest %= 10 * 126 * 10;
      const byte2 = Math.floor(rest / (10 * 126));
      rest %= 10 * 126;
      return ok(byte1 + 0x81, byte2 + 0x30, Math.floor(rest / 10) + 0x81, (rest % 10) + 0x30);
    },
    finish: () => NOTHING,
  };
};

/** §11.1.2, Big5 encoder. */
const big5Encoder = (index: IndexData): CodePointHandler => {
  const pointerOf = pointerLookup(
    index,
    (pointer) => pointer >= (0xa1 - 0x81) * 157,
    [0x2550, 0x255e, 0x2561, 0x256a, 0x5341, 0x5345],
  );
  return {
    encode: (codePoint) => {
      if (codePoint <= 0x7f) return ok(codePoint);
      const pointer = pointerOf(codePoint);
      if (pointer < 0) return fail(codePoint);
      const trailing = pointer % 157;
      return ok(Math.floor(pointer / 157) + 0x81, trailing + (trailing < 0x3f ? 0x40 : 0x62));
    },
    finish: () => NOTHING,
  };
};

/** §12.1.2, EUC-JP encoder. */
const eucJpEncoder = (jis0208: IndexData): CodePointHandler => {
  const pointerOf = pointerLookup(jis0208, () => true);
  return {
    encode: (input) => {
      if (input <= 0x7f) return ok(input);
      if (input === 0xa5) return ok(0x5c);
      if (input === 0x203e) return ok(0x7e);
      if (inRange(input, 0xff61, 0xff9f)) return ok(0x8e, input - 0xff61 + 0xa1);
      const codePoint = input === 0x2212 ? 0xff0d : input;
      const pointer = pointerOf(codePoint);
      if (pointer < 0) return fail(codePoint);
      return ok(Math.floor(pointer / 94) + 0xa1, (pointer % 94) + 0xa1);
    },
    finish: () => NOTHING,
  };
};

/** §12.2.2, ISO-2022-JP encoder. */
const iso2022JpEncoder = (jis0208: IndexData, katakana: IndexData): CodePointHandler => {
  const pointerOf = pointerLookup(jis0208, () => true);
  let state: "ascii" | "roman" | "jis0208" = "ascii";
  const TO_ASCII = [0x1b, 0x28, 0x42];
  const TO_ROMAN = [0x1b, 0x28, 0x4a];
  const TO_JIS0208 = [0x1b, 0x24, 0x42];
  const encode = (input: number): EncodeStep => {
    if (
      (state === "ascii" || state === "roman") &&
      (input === 0x0e || input === 0x0f || input === 0x1b)
    ) {
      return fail(0xfffd);
    }
    if (state === "ascii" && input <= 0x7f) return ok(input);
    if (
      state === "roman" &&
      ((input <= 0x7f && input !== 0x5c && input !== 0x7e) || input === 0xa5 || input === 0x203e)
    ) {
      return ok(input === 0xa5 ? 0x5c : input === 0x203e ? 0x7e : input);
    }
    if (input <= 0x7f) {
      state = "ascii";
      return prefix(TO_ASCII, encode(input));
    }
    if (input === 0xa5 || input === 0x203e) {
      state = "roman";
      return prefix(TO_ROMAN, encode(input));
    }
    const fullwidth = input === 0x2212 ? 0xff0d : input;
    const codePoint = inRange(fullwidth, 0xff61, 0xff9f)
      ? codePointAt(katakana, fullwidth - 0xff61)
      : fullwidth;
    const pointer = pointerOf(codePoint);
    if (pointer < 0) {
      if (state === "jis0208") {
        state = "ascii";
        return prefix(TO_ASCII, encode(input));
      }
      return fail(codePoint);
    }
    if (state !== "jis0208") {
      state = "jis0208";
      return prefix(TO_JIS0208, encode(input));
    }
    return ok(Math.floor(pointer / 94) + 0x21, (pointer % 94) + 0x21);
  };
  return {
    encode,
    finish: () => {
      if (state === "ascii") return NOTHING;
      state = "ascii";
      return TO_ASCII;
    },
  };
};

/** `step` with `bytes` written before it. */
const prefix = (bytes: ReadonlyArray<number>, step: EncodeStep): EncodeStep => ({
  bytes: [...bytes, ...step.bytes],
  error: step.error,
});

/** §12.3.2, Shift_JIS encoder. */
const shiftJisEncoder = (jis0208: IndexData): CodePointHandler => {
  const pointerOf = pointerLookup(jis0208, (pointer) => !inRange(pointer, 8272, 8835));
  return {
    encode: (input) => {
      if (input <= 0x80) return ok(input);
      if (input === 0xa5) return ok(0x5c);
      if (input === 0x203e) return ok(0x7e);
      if (inRange(input, 0xff61, 0xff9f)) return ok(input - 0xff61 + 0xa1);
      const codePoint = input === 0x2212 ? 0xff0d : input;
      const pointer = pointerOf(codePoint);
      if (pointer < 0) return fail(codePoint);
      const leading = Math.floor(pointer / 188);
      const trailing = pointer % 188;
      return ok(
        leading + (leading < 0x1f ? 0x81 : 0xc1),
        trailing + (trailing < 0x3f ? 0x40 : 0x41),
      );
    },
    finish: () => NOTHING,
  };
};

/** §13.1.2, EUC-KR encoder. */
const eucKrEncoder = (index: IndexData): CodePointHandler => {
  const pointerOf = pointerLookup(index, () => true);
  return {
    encode: (codePoint) => {
      if (codePoint <= 0x7f) return ok(codePoint);
      const pointer = pointerOf(codePoint);
      if (pointer < 0) return fail(codePoint);
      return ok(Math.floor(pointer / 190) + 0x81, (pointer % 190) + 0x41);
    },
    finish: () => NOTHING,
  };
};

/** The code-point handler for a CJK encoding, when its tables are provided. */
const encoderFor = (
  encoding: EncodingName,
  tables: Tables,
): Option.Option<() => CodePointHandler> => {
  const { jis0208, iso2022jpKatakana, gb18030, gb18030Ranges, big5, eucKr } = tables;
  switch (encoding) {
    case "gb18030":
    case "GBK":
      return gb18030 === undefined || gb18030Ranges === undefined
        ? Option.none()
        : Option.some(() => gb18030Encoder(gb18030, gb18030Ranges, encoding === "GBK"));
    case "Big5":
      return big5 === undefined ? Option.none() : Option.some(() => big5Encoder(big5));
    case "EUC-JP":
      return jis0208 === undefined ? Option.none() : Option.some(() => eucJpEncoder(jis0208));
    case "ISO-2022-JP":
      return jis0208 === undefined || iso2022jpKatakana === undefined
        ? Option.none()
        : Option.some(() => iso2022JpEncoder(jis0208, iso2022jpKatakana));
    case "Shift_JIS":
      return jis0208 === undefined ? Option.none() : Option.some(() => shiftJisEncoder(jis0208));
    case "EUC-KR":
      return eucKr === undefined ? Option.none() : Option.some(() => eucKrEncoder(eucKr));
    default:
      return Option.none();
  }
};

/** A new code-point handler for a CJK encoding, when its tables are provided. */
export const cjkEncoder = (
  encoding: EncodingName,
  tables: Tables,
): Option.Option<CodePointHandler> => Option.map(encoderFor(encoding, tables), (make) => make());

/** Whether the provided tables give the encoding an encoder. */
export const hasCjkEncoder = (encoding: EncodingName, tables: Tables): boolean =>
  Option.isSome(encoderFor(encoding, tables));
