/**
 * MIME type sniffing (WHATWG MIME Sniffing §6 and §7): what a resource is,
 * from its leading bytes and the type it was supplied with. Extensible:
 * a format library can register its own signatures (OOXML via zip
 * inspection, CFB, RTF) instead of keeping a parallel magic-byte table.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import {
  ARCHIVE,
  AUDIO_VIDEO,
  type BytePattern,
  FONT,
  IMAGE,
  SCRIPTABLE,
  TEXT,
} from "./internal/patterns.ts";
import { essence, isXml, parse, type MimeType } from "./mime-type.ts";

/**
 * A signature: given the resource's leading bytes, the MIME type it names,
 * or `None`. Pass extra ones to {@link sniff} through `signatures`.
 *
 * @since 0.1.0
 * @category models
 */
export type Signature = (bytes: Uint8Array) => Option.Option<string>;

/** Whitespace bytes (§3): TAB, LF, FF, CR and SPACE. */
const isWhitespaceByte = (byte: number): boolean =>
  byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;

/** The pattern matching algorithm (§6), plus the tag-terminating-byte check of §7.1's HTML rows. */
const matches = (bytes: Uint8Array, row: BytePattern): boolean => {
  const start = row.skipWhitespace
    ? Option.getOrElse(
        Arr.findFirstIndex(Array.from(bytes), (byte) => !isWhitespaceByte(byte)),
        () => bytes.length,
      )
    : 0;
  if (bytes.length - start < row.pattern.length) return false;
  const matched = row.pattern.every(
    (expected, index) => ((bytes[start + index] ?? 0) & (row.mask[index] ?? 0)) === expected,
  );
  if (!matched || !row.tagTerminated) return matched;
  const next = bytes[start + row.pattern.length];
  return next === 0x20 || next === 0x3e;
};

const matchTable =
  (table: ReadonlyArray<BytePattern>): Signature =>
  (bytes) =>
    Option.map(
      Arr.findFirst(table, (row) => matches(bytes, row)),
      (row) => row.mimeType,
    );

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** §6.2.1, "matches the signature for MP4". */
const isMp4 = (bytes: Uint8Array): boolean => {
  if (bytes.length < 12) return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (bytes.length < boxSize || boxSize % 4 !== 0) return false;
  if (ascii(bytes, 4, 4) !== "ftyp") return false;
  if (ascii(bytes, 8, 3) === "mp4") return true;
  return Arr.some(
    Arr.filter(
      Arr.range(16, Math.max(16, boxSize - 1)),
      (at) => (at - 16) % 4 === 0 && at < boxSize,
    ),
    (at) => ascii(bytes, at, 3) === "mp4",
  );
};

/** §6.2.2's "parse a vint": the number of bytes the vint starting at `at` occupies. */
const vintSize = (bytes: Uint8Array, at: number): number => {
  const first = bytes[at] ?? 0;
  const size = Arr.findFirstIndex(Arr.range(0, 7), (bit) => (first & (0x80 >> bit)) !== 0);
  return Math.min(
    Option.getOrElse(
      Option.map(size, (bit) => bit + 1),
      () => 8,
    ),
    bytes.length,
  );
};

/** §6.2.2's "matching a padded sequence": `webm`, after any 0x00 bytes, from `at`. */
const isPaddedWebm = (bytes: Uint8Array, at: number): boolean => {
  const start = Option.getOrElse(
    Arr.findFirstIndex(Array.from(bytes.subarray(at)), (byte) => byte !== 0x00),
    () => bytes.length - at,
  );
  return ascii(bytes, at + start, 4) === "webm";
};

/**
 * One DocType candidate (`0x42 0x82`) at `at` in the §6.2.2 loop: `true` or
 * `false` ends the scan with that verdict; a number is where it resumes.
 */
const webmCandidate = (bytes: Uint8Array, at: number): boolean | number => {
  const sizeAt = at + 2;
  if (sizeAt >= bytes.length) return false;
  const valueAt = sizeAt + vintSize(bytes, sizeAt);
  if (valueAt >= bytes.length - 4) return false;
  return isPaddedWebm(bytes, valueAt) || valueAt + 1;
};

/** §6.2.2, "matches the signature for WebM". */
const isWebm = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4 || ascii(bytes, 0, 4) !== "\u001aE\u00df\u00a3") return false;
  // The §6.2.2 loop: a DocType candidate whose value is not `webm` does not
  // end the scan, which resumes just after the candidate's size.
  let iter = 4;
  // oxlint-disable-next-line effect/imperative-loops -- the specification's bounded cursor scan, transcribed step for step.
  while (iter < bytes.length && iter < 38) {
    const step =
      bytes[iter] === 0x42 && bytes[iter + 1] === 0x82 ? webmCandidate(bytes, iter) : iter + 1;
    if (Predicate.isBoolean(step)) return step;
    iter = step;
  }
  return false;
};

/** §6.2.3's mp3-rates table: MPEG-1 Layer III bit rates, by bit-rate index. */
const MP3_RATES: ReadonlyArray<number> = [
  0, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 160000, 192000, 224000,
  256000, 320000,
];

/** §6.2.3's mp2.5-rates table: MPEG-2 and MPEG-2.5 Layer III bit rates, by bit-rate index. */
const MP25_RATES: ReadonlyArray<number> = [
  0, 8000, 16000, 24000, 32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, 144000,
  160000,
];

/** §6.2.3's sample-rate table, by sample-rate index (3 is reserved). */
const SAMPLE_RATES: ReadonlyArray<number> = [44100, 48000, 32000];

/**
 * §6.2.3, "match an mp3 header" at `at`: a frame sync, a Layer III frame, and
 * neither the reserved bit-rate index (15) nor the reserved sample-rate
 * index (3). The specification's "not 0xFF *and* not 0xE0" is read as the
 * frame sync it describes: both bytes must carry it.
 */
const isMp3Header = (bytes: Uint8Array, at: number): boolean => {
  if (bytes.length < at + 4) return false;
  const second = bytes[at + 1] ?? 0;
  const third = bytes[at + 2] ?? 0;
  if (bytes[at] !== 0xff || (second & 0xe0) !== 0xe0) return false;
  const layer = (second & 0x06) >> 1;
  // `final-layer`, 4 - layer, must be 3: Layer III (the layer field's 1).
  return layer === 1 && (third & 0xf0) >> 4 !== 15 && (third & 0x0c) >> 2 !== 3;
};

/**
 * §6.2.3, "parse an mp3 frame" then "compute an mp3 frame size", for the
 * header at `at`: the frame's length in bytes. Read as MPEG audio defines
 * the version field (3 is MPEG-1; 2 MPEG-2 and 0 MPEG-2.5 halve and quarter
 * the sample rate): MPEG-1 takes the mp3-rates table and a scale of 144,
 * the others mp2.5-rates and 72. (The specification's text keys both
 * choices on `version & 1` and `version == 1`, which would measure an
 * MPEG-1 frame with the MPEG-2 tables; the web-platform-tests MP3 vector
 * is an MPEG-1 stream whose second frame is found only this way.)
 */
const mp3FrameSize = (bytes: Uint8Array, at: number): number => {
  const second = bytes[at + 1] ?? 0;
  const third = bytes[at + 2] ?? 0;
  const version = (second & 0x18) >> 3;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? MP3_RATES : MP25_RATES)[(third & 0xf0) >> 4] ?? 0;
  const base = SAMPLE_RATES[(third & 0x0c) >> 2] ?? 0;
  const freq = version === 2 ? base / 2 : version === 0 ? base / 4 : base;
  const padding = (third & 0x02) >> 1;
  return Math.floor((bitrate * (mpeg1 ? 144 : 72)) / freq) + padding;
};

/**
 * §6.2.3, "matches the signature for MP3 without ID3": a valid Layer III
 * frame header at the start, and another exactly one frame later.
 */
const isMp3WithoutId3 = (bytes: Uint8Array): boolean => {
  if (!isMp3Header(bytes, 0)) return false;
  const skipped = mp3FrameSize(bytes, 0);
  // The specification's "greater than s - length" is the remaining length.
  if (skipped < 4 || skipped > bytes.length) return false;
  return isMp3Header(bytes, skipped);
};

/**
 * The image type pattern matching algorithm (§6.1): ICO, CUR, BMP, GIF,
 * WebP, PNG and JPEG.
 *
 * @example
 * ```ts
 * import { Sniff } from "@thomasfosterau/effect-mime"
 *
 * console.log(Sniff.matchImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
 * // Option.some("image/png")
 * ```
 *
 * @since 0.1.0
 * @category patterns
 */
export const matchImage: Signature = matchTable(IMAGE);

/**
 * The audio or video type pattern matching algorithm (§6.2): AIFF, MP3
 * with an ID3 tag, Ogg, MIDI, AVI, WAVE, then the MP4 and WebM
 * signatures, then MP3 without an ID3 tag (§6.2.3: two consecutive valid
 * Layer III frame headers).
 *
 * @example
 * ```ts
 * import { Sniff } from "@thomasfosterau/effect-mime"
 *
 * console.log(Sniff.matchAudioOrVideo(new TextEncoder().encode("OggS\u0000"))) // Option.some("application/ogg")
 * ```
 *
 * @since 0.1.0
 * @category patterns
 */
export const matchAudioOrVideo: Signature = (bytes) =>
  Option.orElse(matchTable(AUDIO_VIDEO)(bytes), () => {
    if (isMp4(bytes)) return Option.some("video/mp4");
    if (isWebm(bytes)) return Option.some("video/webm");
    if (isMp3WithoutId3(bytes)) return Option.some("audio/mpeg");
    return Option.none();
  });

/**
 * The font type pattern matching algorithm (§6.3): Embedded OpenType,
 * TrueType, OpenType, TrueType collections, WOFF and WOFF2.
 *
 * @example
 * ```ts
 * import { Sniff } from "@thomasfosterau/effect-mime"
 *
 * console.log(Sniff.matchFont(new TextEncoder().encode("wOF2...."))) // Option.some("font/woff2")
 * ```
 *
 * @since 0.1.0
 * @category patterns
 */
export const matchFont: Signature = matchTable(FONT);

/**
 * The archive type pattern matching algorithm (§6.4): GZIP, ZIP and RAR.
 * A ZIP-based format (OOXML, ODF, EPUB) matches as `application/zip`; a
 * {@link Signature} that looks inside the archive can refine it.
 *
 * @example
 * ```ts
 * import { Sniff } from "@thomasfosterau/effect-mime"
 *
 * console.log(Sniff.matchArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))) // Option.some("application/zip")
 * ```
 *
 * @since 0.1.0
 * @category patterns
 */
export const matchArchive: Signature = matchTable(ARCHIVE);

/** Binary data bytes (§3): 0x00–0x08, 0x0B, 0x0E–0x1A and 0x1C–0x1F. */
const isBinaryDataByte = (byte: number): boolean =>
  byte <= 0x08 || byte === 0x0b || (byte >= 0x0e && byte <= 0x1a) || (byte >= 0x1c && byte <= 0x1f);

/**
 * Options for {@link sniff}.
 *
 * @since 0.1.0
 * @category models
 */
export interface SniffOptions {
  /** The type the resource was supplied with (a `Content-Type`, say). */
  readonly supplied?: string | undefined;
  /** `X-Content-Type-Options: nosniff`: the supplied type stands. Defaults to `false`. */
  readonly noSniff?: boolean | undefined;
  /**
   * Whether HTML, XML and PDF may be detected in an unknown resource (the
   * specification's "sniff-scriptable flag"). Defaults to `true`; a
   * browser clears it where a scriptable type would be unsafe. `noSniff`
   * clears it too, as §7 requires.
   */
  readonly scriptable?: boolean | undefined;
  /**
   * Extra signatures for an unknown resource, tried in order where the
   * standard's patterns found nothing specific: over a generic
   * `application/zip` match (so a detector that looks inside the archive
   * can name OOXML, ODF or EPUB), and before the text-or-binary fallback.
   */
  readonly signatures?: ReadonlyArray<Signature> | undefined;
  /**
   * Whether to apply the specification's check-for-apache-bug flag (§5.1):
   * when `supplied` is exactly `text/plain`, `text/plain; charset=ISO-8859-1`,
   * `text/plain; charset=iso-8859-1` or `text/plain; charset=UTF-8` (the
   * byte-for-byte values old Apache servers sent for unknown files), the
   * computed type is decided by the rules for distinguishing text or binary
   * (§7.2): `text/plain` or `application/octet-stream`, never a scriptable
   * type. The specification sets the flag for a resource fetched over HTTP;
   * set this when `supplied` is a `Content-Type` header. Defaults to `false`.
   */
  readonly checkForApacheBug?: boolean | undefined;
}

/** The exact `Content-Type` values that set the check-for-apache-bug flag (§5.1). */
const APACHE_BUG_TYPES: ReadonlyArray<string> = [
  "text/plain",
  "text/plain; charset=ISO-8859-1",
  "text/plain; charset=iso-8859-1",
  "text/plain; charset=UTF-8",
];

const UNKNOWN_TYPES: ReadonlyArray<string> = ["unknown/unknown", "application/unknown", "*/*"];

/**
 * Standard matches that only name a container: a custom signature that
 * looks inside it (OOXML, ODF, EPUB in a ZIP) refines them.
 */
const GENERIC_CONTAINERS: ReadonlyArray<string> = ["application/zip"];

const firstMatch = (
  signatures: ReadonlyArray<Signature>,
  bytes: Uint8Array,
): Option.Option<string> => Arr.findFirst(signatures, (signature) => signature(bytes));

/**
 * §7.1, "rules for identifying an unknown MIME type", with the custom
 * signatures tried where the standard's patterns found nothing specific:
 * before the text-or-binary fallback, and over a generic container match.
 */
const identifyUnknown = (bytes: Uint8Array, options: SniffOptions): string => {
  const standard = firstMatch(
    [
      // §7: the sniff-scriptable flag is the inverse of the no-sniff flag.
      options.scriptable === false || options.noSniff === true
        ? () => Option.none()
        : matchTable(SCRIPTABLE),
      matchTable(TEXT),
      matchImage,
      matchAudioOrVideo,
      matchArchive,
    ],
    bytes,
  );
  const custom = () => firstMatch(options.signatures ?? [], bytes);
  return Option.match(standard, {
    onSome: (type) =>
      GENERIC_CONTAINERS.includes(type) ? Option.getOrElse(custom(), () => type) : type,
    onNone: () =>
      Option.getOrElse(custom(), () =>
        bytes.some(isBinaryDataByte) ? "application/octet-stream" : "text/plain",
      ),
  });
};

/**
 * §7.2, "rules for distinguishing if a resource is text or binary": a
 * UTF-16 or UTF-8 byte order mark, or no binary data byte, is text.
 */
const textOrBinary = (bytes: Uint8Array): string => {
  const [first, second, third] = bytes;
  const utf16Bom = (first === 0xfe && second === 0xff) || (first === 0xff && second === 0xfe);
  const utf8Bom = first === 0xef && second === 0xbb && third === 0xbf;
  return utf16Bom || utf8Bom || !bytes.some(isBinaryDataByte)
    ? "text/plain"
    : "application/octet-stream";
};

/**
 * Determines a resource's computed MIME type (§7.1), from up to its first
 * 1445 bytes and the type it was supplied with:
 *
 * - no supplied type (or `unknown/unknown`, `application/unknown`, `*\/*`):
 *   the rules for an unknown type, with `signatures` tried over a generic
 *   `application/zip` match and before the text-or-binary fallback, and
 *   HTML, XML and PDF not detected under `noSniff`;
 * - `noSniff`, or an XML or HTML supplied type: the supplied type (a
 *   supplied `text/html` is never sniffed as a feed: the specification
 *   dropped its feed-or-HTML rules);
 * - under `checkForApacheBug`, a supplied type that is exactly one of the
 *   old Apache `text/plain` values: `text/plain` or
 *   `application/octet-stream`, from the bytes (§7.2);
 * - a supplied image, audio or video type (`application/ogg` included):
 *   the matching pattern, if any, else the supplied type.
 *
 * A supplied type that does not parse counts as absent.
 *
 * @example
 * ```ts
 * import { MimeType, Sniff } from "@thomasfosterau/effect-mime"
 *
 * const pdf = new TextEncoder().encode("%PDF-1.7\n")
 * console.log(MimeType.essence(Sniff.sniff(pdf))) // "application/pdf"
 *
 * const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
 * console.log(MimeType.essence(Sniff.sniff(png, { supplied: "image/jpeg" }))) // "image/png"
 * console.log(MimeType.essence(Sniff.sniff(png, { supplied: "image/jpeg", noSniff: true }))) // "image/jpeg"
 * ```
 *
 * @since 0.1.0
 * @category sniffing
 */
export const sniff = (bytes: Uint8Array, options: SniffOptions = {}): MimeType => {
  const header = bytes.subarray(0, 1445);
  const supplied = Option.flatMap(Option.fromNullishOr(options.supplied), parse);
  const computed = (type: string): MimeType =>
    Option.getOrElse(parse(type), () => ({
      type: "application",
      subtype: "octet-stream",
      parameters: [],
    }));
  return Option.match(
    Option.filter(supplied, (mimeType) => !UNKNOWN_TYPES.includes(essence(mimeType))),
    {
      onNone: () => computed(identifyUnknown(header, options)),
      onSome: (mimeType) => {
        if (options.noSniff === true || isXml(mimeType) || essence(mimeType) === "text/html") {
          return mimeType;
        }
        if (
          options.checkForApacheBug === true &&
          APACHE_BUG_TYPES.includes(options.supplied ?? "")
        ) {
          return computed(textOrBinary(header));
        }
        const pattern =
          mimeType.type === "image"
            ? matchImage
            : mimeType.type === "audio" ||
                mimeType.type === "video" ||
                essence(mimeType) === "application/ogg"
              ? matchAudioOrVideo
              : undefined;
        return Predicate.isUndefined(pattern)
          ? mimeType
          : Option.getOrElse(Option.map(pattern(header), computed), () => mimeType);
      },
    },
  );
};
