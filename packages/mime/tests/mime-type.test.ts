/**
 * MIME type parsing and serialisation against the web-platform-tests
 * vectors (`tests/fixtures/mime-types.json`, `generated-mime-types.json`;
 * BSD-3-Clause, see `tests/fixtures/README.md`), plus the accessors and the
 * schema.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { MimeType } from "@thomasfosterau/effect-mime";
import generated from "./fixtures/generated-mime-types.json" with { type: "json" };
import handWritten from "./fixtures/mime-types.json" with { type: "json" };

const Vectors = Schema.Array(
  Schema.Struct({ input: Schema.String, output: Schema.NullOr(Schema.String) }),
);

/** The vectors of a fixture, its section-heading strings left out. */
const vectors = (fixture: ReadonlyArray<unknown>) =>
  Schema.decodeUnknownSync(Vectors)(fixture.filter(Predicate.isObject));

describe("parse / serialize (web-platform-tests)", () => {
  it.each([
    ["mime-types.json", handWritten],
    ["generated-mime-types.json", generated],
  ] as const)("matches every vector in %s", (_, fixture) => {
    const all = vectors(fixture);
    expect(all.length).toBeGreaterThan(50);
    const mismatches = all.filter(
      ({ input, output }) =>
        Option.getOrNull(Option.map(MimeType.parse(input), MimeType.serialize)) !== output,
    );
    expect(mismatches).toEqual([]);
  });
});

describe("accessors", () => {
  const parsed = Option.getOrElse(MimeType.parse('Text/HTML;Charset="utf-8";x=y'), () => ({
    type: "",
    subtype: "",
    parameters: [],
  }));

  it("lower-cases type, subtype and parameter names, keeping values", () => {
    expect(parsed).toStrictEqual({
      type: "text",
      subtype: "html",
      parameters: [
        ["charset", "utf-8"],
        ["x", "y"],
      ],
    });
    expect(MimeType.essence(parsed)).toBe("text/html");
  });

  it("reads a parameter case-insensitively", () => {
    expect(MimeType.parameter(parsed, "CHARSET")).toStrictEqual(Option.some("utf-8"));
    expect(MimeType.parameter(parsed, "boundary")).toStrictEqual(Option.none());
  });

  it("recognises XML MIME types", () => {
    const xml = (input: string) => Option.map(MimeType.parse(input), MimeType.isXml);
    expect(xml("image/svg+xml")).toStrictEqual(Option.some(true));
    expect(xml("text/xml")).toStrictEqual(Option.some(true));
    expect(xml("application/xml;charset=utf-8")).toStrictEqual(Option.some(true));
    expect(xml("text/html")).toStrictEqual(Option.some(false));
  });

  it("quotes and escapes a value that is not a token", () => {
    expect(
      MimeType.serialize({ type: "a", subtype: "b", parameters: [["x", 'say "hi" \\ bye']] }),
    ).toBe('a/b;x="say \\"hi\\" \\\\ bye"');
    expect(MimeType.serialize({ type: "a", subtype: "b", parameters: [["x", ""]] })).toBe(
      'a/b;x=""',
    );
  });
});

describe("MimeTypeFromString", () => {
  it("decodes and normalises, and encodes back", () => {
    const decoded = Schema.decodeUnknownSync(MimeType.MimeTypeFromString)(
      " Application/JSON ; Charset=UTF-8",
    );
    expect(decoded.subtype).toBe("json");
    expect(Schema.encodeSync(MimeType.MimeTypeFromString)(decoded)).toBe(
      "application/json;charset=UTF-8",
    );
  });

  it("fails on a string that is not a MIME type", () => {
    expect(() => Schema.decodeUnknownSync(MimeType.MimeTypeFromString)("text")).toThrow(
      /not a MIME type/,
    );
  });
});

describe("review regressions", () => {
  it("finds parameter delimiters by UTF-16 offset, past supplementary characters", () => {
    // A quoted value holding astral characters and an escaped quote: the value
    // is dropped (not HTTP quoted-string token code points), and nothing
    // inside it may surface as a parameter of its own (`b` did, before).
    const parsed = MimeType.parse('text/plain;a="\u{1F600}\u{1F600}\\";b=c";d=e');
    expect(Option.map(parsed, MimeType.serialize)).toStrictEqual(Option.some("text/plain;d=e"));
  });

  it("rejects a non-ASCII parameter name before lowercasing (the Kelvin sign)", () => {
    const parsed = MimeType.parse("text/plain;K=bad;k=good");
    expect(Option.flatMap(parsed, (mimeType) => MimeType.parameter(mimeType, "k"))).toStrictEqual(
      Option.some("good"),
    );
    expect(Option.map(parsed, MimeType.serialize)).toStrictEqual(Option.some("text/plain;k=good"));
  });
});
