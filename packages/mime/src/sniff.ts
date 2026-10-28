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

/** §6.2.2, "matches the signature for WebM". */
const isWebm = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4 || ascii(bytes, 0, 4) !== "\u001aE\u00df\u00a3") return false;
  // The §6.2.2 loop: a DocType candidate whose value is not `webm` does not
  // end the scan, which resumes just after the candidate's size.
  let iter = 4;
  // oxlint-disable-next-line effect/imperative-loops -- the specification's bounded cursor scan, transcribed step for step.
  while (iter < bytes.length && iter < 38) {
    if (bytes[iter] === 0x42 && bytes[iter + 1] === 0x82) {
      iter += 2;
      if (iter >= bytes.length) return false;
      iter += vintSize(bytes, iter);
      if (iter >= bytes.length - 4) return false;
      if (isPaddedWebm(bytes, iter)) return true;
    }
    iter += 1;
  }
  return false;
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
 * signatures. MP3 without an ID3 tag (§6.2.3) is not detected yet.
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
}

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
 * Determines a resource's computed MIME type (§7.1), from up to its first
 * 1445 bytes and the type it was supplied with:
 *
 * - no supplied type (or `unknown/unknown`, `application/unknown`, `*\/*`):
 *   the rules for an unknown type, with `signatures` tried over a generic
 *   `application/zip` match and before the text-or-binary fallback, and
 *   HTML, XML and PDF not detected under `noSniff`;
 * - `noSniff`, or an XML or HTML supplied type: the supplied type;
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
