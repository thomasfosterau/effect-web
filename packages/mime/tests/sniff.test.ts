/**
 * MIME sniffing (§6 pattern tables, the MP4 and WebM signatures, §7.1's
 * rules) and the extension table.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { Extension, MimeType, Sniff } from "@thomasfosterau/effect-mime";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const bytes = (...values: ReadonlyArray<number>): Uint8Array => Uint8Array.from(values);
const sniffed = (input: Uint8Array, options?: Sniff.SniffOptions): string =>
  MimeType.essence(Sniff.sniff(input, options));

/** An `ftyp` box of `size` bytes whose major brand is `major` and compatible brands follow. */
const ftyp = (major: string, ...compatible: ReadonlyArray<string>): Uint8Array => {
  const size = 16 + compatible.length * 4;
  const box = new Uint8Array(size);
  new DataView(box.buffer).setUint32(0, size);
  box.set(ascii("ftyp"), 4);
  box.set(ascii(major), 8);
  compatible.forEach((brand, index) => box.set(ascii(brand), 16 + index * 4));
  return box;
};

describe("pattern tables", () => {
  it.each([
    [bytes(0, 0, 1, 0), "image/x-icon"],
    [ascii("BM...."), "image/bmp"],
    [ascii("GIF89a"), "image/gif"],
    [ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "), "image/webp"],
    [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    [bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
  ])("matchImage %#", (input, expected) => {
    expect(Sniff.matchImage(input)).toStrictEqual(Option.some(expected));
  });

  it.each([
    [ascii("ID3\u0004"), "audio/mpeg"],
    [ascii("OggS\u0000"), "application/ogg"],
    [ascii("MThd\u0000\u0000\u0000\u0006"), "audio/midi"],
    [ascii("RIFF\u0001\u0002\u0003\u0004WAVE"), "audio/wave"],
    [ascii("RIFF\u0001\u0002\u0003\u0004AVI "), "video/avi"],
    [ascii("FORM\u0001\u0002\u0003\u0004AIFF"), "audio/aiff"],
    [ftyp("mp42"), "video/mp4"],
    [ftyp("isom", "avc1", "mp41"), "video/mp4"],
    [
      bytes(
        0x1a,
        0x45,
        0xdf,
        0xa3,
        0x9f,
        0x42,
        0x86,
        0x81,
        0x01,
        0x42,
        0x82,
        0x84,
        ...ascii("webm"),
        0x42,
      ),
      "video/webm",
    ],
  ])("matchAudioOrVideo %#", (input, expected) => {
    expect(Sniff.matchAudioOrVideo(input)).toStrictEqual(Option.some(expected));
  });

  it("does not take an MP4 without an mp4 brand, or a short WebM header", () => {
    expect(Sniff.matchAudioOrVideo(ftyp("qt  ", "qt  "))).toStrictEqual(Option.none());
    expect(Sniff.matchAudioOrVideo(bytes(0x1a, 0x45, 0xdf, 0xa3))).toStrictEqual(Option.none());
  });

  it.each([
    [bytes(0, 1, 0, 0), "font/ttf"],
    [ascii("OTTO"), "font/otf"],
    [ascii("ttcf"), "font/collection"],
    [ascii("wOFF"), "font/woff"],
    [ascii("wOF2"), "font/woff2"],
    [
      Uint8Array.from([...Array.from({ length: 34 }, () => 7), 0x4c, 0x50]),
      "application/vnd.ms-fontobject",
    ],
  ])("matchFont %#", (input, expected) => {
    expect(Sniff.matchFont(input)).toStrictEqual(Option.some(expected));
  });

  it.each([
    [bytes(0x1f, 0x8b, 0x08), "application/x-gzip"],
    [ascii("PK\u0003\u0004"), "application/zip"],
    [ascii("Rar!\u001a\u0007\u0000"), "application/x-rar-compressed"],
  ])("matchArchive %#", (input, expected) => {
    expect(Sniff.matchArchive(input)).toStrictEqual(Option.some(expected));
  });
});

describe("sniff, an unknown type", () => {
  it("finds HTML after leading whitespace, case-insensitively, before a tag-terminating byte", () => {
    expect(sniffed(ascii("  \n<!doctype html>"))).toBe("text/html");
    expect(sniffed(ascii("<p>hello"))).toBe("text/html");
    expect(sniffed(ascii("<pre>"))).toBe("text/plain");
    expect(sniffed(ascii("<?xml version='1.0'?>"))).toBe("text/xml");
    expect(sniffed(ascii("%PDF-1.7"))).toBe("application/pdf");
  });

  it("does not sniff scriptable types when scriptable is false", () => {
    expect(sniffed(ascii("<html>"), { scriptable: false })).toBe("text/plain");
    expect(sniffed(ascii("%PDF-1.7"), { scriptable: false })).toBe("text/plain");
  });

  it("detects PostScript and BOM-led text", () => {
    expect(sniffed(ascii("%!PS-Adobe-3.0"))).toBe("application/postscript");
    expect(sniffed(bytes(0xff, 0xfe, 0x41, 0x00))).toBe("text/plain");
  });

  it("falls back to text or binary", () => {
    expect(sniffed(ascii("plain words\r\n"))).toBe("text/plain");
    expect(sniffed(bytes(0x41, 0x00, 0x42))).toBe("application/octet-stream");
    expect(sniffed(bytes())).toBe("text/plain");
  });

  it("treats unknown/unknown, application/unknown, */* and an unparsable type as unknown", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(sniffed(png, { supplied: "unknown/unknown" })).toBe("image/png");
    expect(sniffed(png, { supplied: "application/unknown" })).toBe("image/png");
    expect(sniffed(png, { supplied: "*/*" })).toBe("image/png");
    expect(sniffed(png, { supplied: "not a type" })).toBe("image/png");
  });

  it("tries extra signatures after the standard patterns, before text or binary", () => {
    const rtf: Sniff.Signature = (input) =>
      String.fromCharCode(...input.subarray(0, 5)) === "{\\rtf"
        ? Option.some("application/rtf")
        : Option.none();
    expect(sniffed(ascii("{\\rtf1\\ansi"), { signatures: [rtf] })).toBe("application/rtf");
    expect(sniffed(ascii("{\\rtf1\\ansi"))).toBe("text/plain");
    // A standard pattern still wins.
    expect(sniffed(ascii("%PDF-1.7"), { signatures: [() => Option.some("x/y")] })).toBe(
      "application/pdf",
    );
  });
});

describe("sniff, a supplied type", () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

  it("corrects an image or audio / video type from the bytes", () => {
    expect(sniffed(png, { supplied: "image/jpeg" })).toBe("image/png");
    expect(sniffed(ascii("OggS\u0000"), { supplied: "audio/mpeg" })).toBe("application/ogg");
    expect(sniffed(ascii("not an image"), { supplied: "image/jpeg" })).toBe("image/jpeg");
  });

  it("keeps the supplied type under noSniff, for XML and HTML, and for other types", () => {
    expect(sniffed(png, { supplied: "image/jpeg", noSniff: true })).toBe("image/jpeg");
    expect(sniffed(png, { supplied: "image/svg+xml" })).toBe("image/svg+xml");
    expect(sniffed(ascii("%PDF-"), { supplied: "text/html" })).toBe("text/html");
    expect(sniffed(png, { supplied: "application/json" })).toBe("application/json");
  });

  it("keeps the supplied type's parameters", () => {
    expect(
      MimeType.serialize(Sniff.sniff(ascii("x"), { supplied: "text/csv; charset=utf-8" })),
    ).toBe("text/csv;charset=utf-8");
  });
});

describe("Extension", () => {
  it("maps a file name, path or bare extension to a MIME type, case-insensitively", () => {
    expect(Extension.mimeTypeFor("photo.JPG")).toStrictEqual(Option.some("image/jpeg"));
    expect(Extension.mimeTypeFor("/a/b.c/archive.tar.gz")).toStrictEqual(
      Option.some("application/gzip"),
    );
    expect(Extension.mimeTypeFor("epub")).toStrictEqual(Option.some("application/epub+zip"));
    expect(Extension.mimeTypeFor("file.unknownext")).toStrictEqual(Option.none());
  });

  it("gives the preferred extension for a MIME type", () => {
    expect(Extension.extensionFor("image/jpeg")).toStrictEqual(Option.some("jpg"));
    expect(Extension.extensionFor("TEXT/HTML; charset=utf-8")).toStrictEqual(Option.some("html"));
    expect(Extension.extensionFor("x/unknown")).toStrictEqual(Option.none());
  });

  it("extends the table with custom entries", () => {
    const table = Extension.extend({ ".GeoJSON": "application/geo+json", jpg: "image/x-custom" });
    expect(Extension.mimeTypeFor("map.geojson", table)).toStrictEqual(
      Option.some("application/geo+json"),
    );
    expect(Extension.mimeTypeFor("a.jpg", table)).toStrictEqual(Option.some("image/x-custom"));
    expect(Extension.mimeTypeFor("a.jpg")).toStrictEqual(Option.some("image/jpeg"));
  });
});

describe("review regressions", () => {
  it("does not sniff scriptable types in an unknown resource under noSniff (§7)", () => {
    expect(sniffed(ascii("<html>"), { noSniff: true })).toBe("text/plain");
    expect(sniffed(ascii("<html>"), { supplied: "*/*", noSniff: true })).toBe("text/plain");
    expect(sniffed(ascii("%PDF-1.7"), { supplied: "not a type", noSniff: true })).toBe(
      "text/plain",
    );
    expect(sniffed(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), { noSniff: true })).toBe(
      "image/png",
    );
  });

  it("keeps scanning after a DocType candidate that is not webm (§6.2.2)", () => {
    const input = bytes(
      0x1a,
      0x45,
      0xdf,
      0xa3,
      0x42,
      0x82,
      0x81,
      0x78,
      0x42,
      0x82,
      0x84,
      0x77,
      0x65,
      0x62,
      0x6d,
      0x42,
    );
    expect(Sniff.matchAudioOrVideo(input)).toStrictEqual(Option.some("video/webm"));
  });

  it("lets a custom signature refine a generic ZIP match, but not a specific one", () => {
    const zip = Uint8Array.from([...ascii("PK\u0003\u0004"), ...ascii("[Content_Types].xml")]);
    const ooxml: Sniff.Signature = (input) =>
      String.fromCharCode(...input.subarray(4, 23)) === "[Content_Types].xml"
        ? Option.some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        : Option.none();
    expect(sniffed(zip, { signatures: [ooxml] })).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(sniffed(zip)).toBe("application/zip");
    expect(sniffed(zip, { signatures: [() => Option.none()] })).toBe("application/zip");
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(sniffed(png, { signatures: [() => Option.some("x/y")] })).toBe("image/png");
  });

  it("corrects a supplied application/ogg like any audio or video type (§4.6)", () => {
    expect(sniffed(ascii("ID3\u0004"), { supplied: "application/ogg" })).toBe("audio/mpeg");
  });
});

/** A Layer III stream: frame header `header`, then `size - 4` zero bytes, then `next`. */
const mp3 = (
  header: ReadonlyArray<number>,
  size: number,
  next: ReadonlyArray<number>,
): Uint8Array => {
  const stream = new Uint8Array(size + next.length);
  stream.set(header, 0);
  stream.set(next, size);
  return stream;
};

describe("MP3 without ID3 (§6.2.3)", () => {
  // MPEG-1 Layer III, 64 kbit/s, 44.1 kHz: 64000 × 144 / 44100 = 208 bytes.
  const mpeg1 = [0xff, 0xfb, 0x50, 0x00];
  // The same with the padding bit: 209 bytes.
  const mpeg1Padded = [0xff, 0xfb, 0x52, 0x00];
  // MPEG-2 Layer III, 64 kbit/s (mp2.5-rates index 8), 22.05 kHz: 64000 × 72 / 22050 = 208.
  const mpeg2 = [0xff, 0xf3, 0x80, 0x00];

  it("finds two consecutive Layer III frame headers", () => {
    expect(Sniff.matchAudioOrVideo(mp3(mpeg1, 208, mpeg1))).toStrictEqual(
      Option.some("audio/mpeg"),
    );
    expect(Sniff.matchAudioOrVideo(mp3(mpeg1Padded, 209, mpeg1))).toStrictEqual(
      Option.some("audio/mpeg"),
    );
    expect(Sniff.matchAudioOrVideo(mp3(mpeg2, 208, mpeg2))).toStrictEqual(
      Option.some("audio/mpeg"),
    );
    expect(sniffed(mp3(mpeg1, 208, mpeg1))).toBe("audio/mpeg");
  });

  it("needs the second header exactly one frame later", () => {
    expect(Sniff.matchAudioOrVideo(mp3(mpeg1, 207, mpeg1))).toStrictEqual(Option.none());
    expect(Sniff.matchAudioOrVideo(mp3(mpeg1Padded, 208, mpeg1))).toStrictEqual(Option.none());
    expect(Sniff.matchAudioOrVideo(mp3(mpeg1, 208, [0xff, 0xfb]))).toStrictEqual(Option.none());
    expect(Sniff.matchAudioOrVideo(bytes(...mpeg1))).toStrictEqual(Option.none());
  });

  it("rejects a header without a frame sync, outside Layer III, or with a reserved or free rate", () => {
    const rejected = [
      [0xfe, 0xfb, 0x50, 0x00], // no frame sync
      [0xff, 0x1b, 0x50, 0x00], // sync bits clear in the second byte
      [0xff, 0xfd, 0x50, 0x00], // Layer II
      [0xff, 0xf9, 0x50, 0x00], // layer 0 (reserved)
      [0xff, 0xfb, 0xf0, 0x00], // bit-rate index 15
      [0xff, 0xfb, 0x5c, 0x00], // sample-rate index 3
      [0xff, 0xfb, 0x00, 0x00], // bit-rate index 0 (free): a frame size under 4
    ];
    rejected.forEach((header) => {
      expect(Sniff.matchAudioOrVideo(mp3(header, 208, header))).toStrictEqual(Option.none());
    });
  });
});

describe("the check-for-apache-bug flag (§5.1, §7.2)", () => {
  const binary = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

  it("decides text or binary for the four exact Apache values", () => {
    [
      "text/plain",
      "text/plain; charset=ISO-8859-1",
      "text/plain; charset=iso-8859-1",
      "text/plain; charset=UTF-8",
    ].forEach((supplied) => {
      expect(sniffed(binary, { supplied, checkForApacheBug: true })).toBe(
        "application/octet-stream",
      );
      expect(sniffed(ascii("<html>"), { supplied, checkForApacheBug: true })).toBe("text/plain");
    });
  });

  it("reads a UTF-16 or UTF-8 byte order mark as text, whatever follows", () => {
    const options = { supplied: "text/plain", checkForApacheBug: true } as const;
    expect(sniffed(bytes(0xfe, 0xff, 0x00, 0x41), options)).toBe("text/plain");
    expect(sniffed(bytes(0xff, 0xfe, 0x41, 0x00), options)).toBe("text/plain");
    expect(sniffed(bytes(0xef, 0xbb, 0xbf, 0x00), options)).toBe("text/plain");
  });

  it("leaves any other spelling, and noSniff, to the supplied type", () => {
    expect(sniffed(binary, { supplied: "text/plain;charset=UTF-8", checkForApacheBug: true })).toBe(
      "text/plain",
    );
    expect(
      sniffed(binary, { supplied: "text/plain", checkForApacheBug: true, noSniff: true }),
    ).toBe("text/plain");
  });
});
