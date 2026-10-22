/**
 * The robots.txt line grammar (an effect-parse parser): its edge cases, and a
 * differential check against the hand-written line splitter it replaced.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import { encode, parse, RobotsTxt, RobotsTxtFromString, Rule } from "@thomasfosterau/effect-robots";

/** A failing case's input as a JSON string literal, so control characters show. */
const quoted = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/**
 * The line splitter the grammar replaced: comment cut, CRLF split, trim,
 * split at the first colon, colon-less lines dropped. Its output is the
 * canonical `field: value` text, so `parse` of it is the oracle for `parse`
 * of the original (the grouping layer underneath is shared).
 */
const referenceLines = (content: string): string =>
  content
    .split(/\r?\n/)
    .flatMap((rawLine) => {
      const commentIndex = rawLine.indexOf("#");
      const line = (commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine).trim();
      const colon = line.indexOf(":");
      return colon < 0 ? [] : [`${line.slice(0, colon).trim()}: ${line.slice(colon + 1).trim()}`];
    })
    .join("\n");

const fragments = [
  "User-agent: a",
  "USER-AGENT:B",
  "Disallow: /x",
  "Allow:/y:z",
  " Crawl-delay : 2 # slow",
  "crawl-delay: -1",
  "Sitemap: https://example.com/s.xml#frag",
  "# comment: not a directive",
  "a#b:c",
  "no colon here",
  ":",
  "Disallow:",
  "\t",
  "\r",
  "",
];
const separators = ["\n", "\r\n", "\r"];

describe("line grammar", () => {
  it("drops a line whose colon is inside its comment", () => {
    expect(parse("User-agent: *\nDisallow # : /x\nDisallow: /y").groups[0]?.rules).toEqual([
      new Rule({ path: "/y", allow: false }),
    ]);
  });

  it("keeps a colon in the value and cuts the value at `#`", () => {
    expect(parse("User-agent: *\nDisallow: /a:b # c").groups[0]?.rules).toEqual([
      new Rule({ path: "/a:b", allow: false }),
    ]);
  });

  it("parses CRLF and an empty document", () => {
    expect(parse("User-agent: *\r\nDisallow: /x\r\n").groups[0]?.rules).toHaveLength(1);
    expect(parse("")).toEqual(new RobotsTxt({ groups: [], sitemaps: [] }));
  });

  it("decodes any string without a schema issue", () => {
    Arr.forEach(["\u0000", "#", "\n\n\n", ":::", "\uD800", "\r\r\n#\n:"], (input) => {
      expect(Schema.decodeUnknownSync(RobotsTxtFromString)(input)).toBeInstanceOf(RobotsTxt);
    });
  });

  it("matches the hand-written line splitter it replaced on every pair and triple of tricky lines", () => {
    const contents = Arr.flatMap(separators, (separator) =>
      Arr.flatMap(fragments, (a) =>
        Arr.flatMap(fragments, (b) =>
          Arr.map(["User-agent: z", "Disallow: /q", "#", ""], (c) => [a, b, c].join(separator)),
        ),
      ),
    );
    Arr.forEach(contents, (content) => {
      expect(parse(content), quoted(content)).toEqual(parse(referenceLines(content)));
    });
  });

  it("round-trips through encode", () => {
    const contents = Arr.flatMap(separators, (separator) =>
      Arr.map(fragments, (a) => ["User-agent: a", a, "Disallow: /q", a].join(separator)),
    );
    Arr.forEach(contents, (content) => {
      const parsed = parse(content);
      expect(parse(encode(parsed))).toEqual(parsed);
    });
  });
});
