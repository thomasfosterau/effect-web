/**
 * The web-platform-tests `mimesniff/` resources (`tests/fixtures/mimesniff/`;
 * BSD-3-Clause, see `tests/fixtures/README.md`) run against `Sniff`. WPT's
 * own tests load them in a browser (an `<audio>` element, a popup, an
 * iframe); these assert the computed MIME type for the same bytes and the
 * same supplied `Content-Type`s.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { MimeType, Sniff } from "@thomasfosterau/effect-mime";

const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/mimesniff/${path}`, import.meta.url)));

const sniffed = (input: Uint8Array, options?: Sniff.SniffOptions): string =>
  MimeType.essence(Sniff.sniff(input, options));

describe("mimesniff/media (media-sniff.window.js)", () => {
  // The audio or video pattern each vector matches; FLAC has none in §6.2.
  const vectors: ReadonlyArray<readonly [string, Option.Option<string>]> = [
    ["mp3-raw.mp3", Option.some("audio/mpeg")],
    ["mp3-with-id3.mp3", Option.some("audio/mpeg")],
    ["flac.flac", Option.none()],
    ["ogg.ogg", Option.some("application/ogg")],
    ["mp4.mp4", Option.some("video/mp4")],
    ["wav.wav", Option.some("audio/wave")],
    ["webm.webm", Option.some("video/webm")],
  ];

  it.each(vectors)("%s matches its audio or video signature", (name, expected) => {
    expect(Sniff.matchAudioOrVideo(fixture(`media/${name}`))).toStrictEqual(expected);
  });

  it.each(vectors)("%s, supplied as the WPT Content-Types", (name, expected) => {
    const bytes = fixture(`media/${name}`);
    // No type: the rules for an unknown type find the media signature (FLAC
    // has none, and its frames are binary data).
    expect(sniffed(bytes)).toBe(Option.getOrElse(expected, () => "application/octet-stream"));
    // A supplied audio type is corrected by the bytes.
    expect(sniffed(bytes, { supplied: "audio/ogg; codec=vorbis" })).toBe(
      Option.getOrElse(expected, () => "audio/ogg"),
    );
    // Any other supplied type stands.
    ["bogus/mime", "application/octet-stream", "text/html", "application/pdf"].forEach(
      (supplied) => {
        expect(sniffed(bytes, { supplied })).toBe(supplied);
      },
    );
  });
});

describe("mimesniff/sniffing (html.window.js, html-comment.tentative.window.js)", () => {
  it.each(["rss.html", "atom.html"])("%s supplied as text/html stays HTML, not a feed", (name) => {
    expect(sniffed(fixture(`sniffing/${name}`), { supplied: "text/html" })).toBe("text/html");
  });

  it("does not take `<!--` without a tag-terminating byte as HTML (the spec's TT; WPT's test is tentative)", () => {
    expect(sniffed(fixture("sniffing/html-comment"))).toBe("text/plain");
  });
});

describe("mimesniff/sniffing (mislabeled-binary-resource.tentative.window.js)", () => {
  const apache = { supplied: "text/plain", checkForApacheBug: true } as const;

  it("computes octet-stream for binary bytes served as text/plain, never a privileged type", () => {
    expect(sniffed(fixture("sniffing/test-file.zip"), apache)).toBe("application/octet-stream");
    expect(sniffed(fixture("sniffing/binary-data.bin"), apache)).toBe("application/octet-stream");
    expect(sniffed(fixture("sniffing/png-image.png"), apache)).toBe("application/octet-stream");
  });

  it("keeps HTML served as text/plain as text/plain, never text/html", () => {
    expect(sniffed(fixture("sniffing/html-content.html"), apache)).toBe("text/plain");
  });

  it("keeps the supplied type without the flag", () => {
    expect(sniffed(fixture("sniffing/png-image.png"), { supplied: "text/plain" })).toBe(
      "text/plain",
    );
  });
});
