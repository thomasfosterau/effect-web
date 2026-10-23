/**
 * The `data:` URL processor and forgiving-base64 against the
 * web-platform-tests vectors (`tests/fixtures/data-urls.json`,
 * `base64.json`; BSD-3-Clause, see `tests/fixtures/README.md`).
 */
import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { DataUrl, MimeType } from "@thomasfosterau/effect-mime";
import base64 from "./fixtures/base64.json" with { type: "json" };
import dataUrls from "./fixtures/data-urls.json" with { type: "json" };

const DataUrlVectors = Schema.Array(
  Schema.Union([
    Schema.Tuple([Schema.String, Schema.Null]),
    Schema.Tuple([Schema.String, Schema.String, Schema.Array(Schema.Number)]),
  ]),
);

const Base64Vectors = Schema.Array(
  Schema.Tuple([Schema.String, Schema.NullOr(Schema.Array(Schema.Number))]),
);

const render = (input: string) =>
  Option.map(DataUrl.process(input), ({ mimeType, body }) => [
    MimeType.serialize(mimeType),
    Array.from(body),
  ]);

describe("DataUrl.process (web-platform-tests)", () => {
  it("matches every vector in data-urls.json", () => {
    const vectors = Schema.decodeUnknownSync(DataUrlVectors)(dataUrls);
    expect(vectors.length).toBeGreaterThan(50);
    expect(Arr.map(vectors, (vector) => [vector[0], render(vector[0])])).toEqual(
      Arr.map(vectors, (vector) => [
        vector[0],
        vector[1] === null ? Option.none() : Option.some([vector[1], vector[2]]),
      ]),
    );
  });

  it("matches every forgiving-base64 vector in base64.json, through data:;base64,", () => {
    const vectors = Schema.decodeUnknownSync(Base64Vectors)(base64);
    const body = (input: string) =>
      Option.map(DataUrl.process(`data:;base64,${input}`), (url) => Array.from(url.body));
    expect(Arr.map(vectors, ([input]) => [input, body(input)])).toEqual(
      Arr.map(vectors, ([input, expected]) => [input, Option.fromNullishOr(expected)]),
    );
  });
});

describe("DataUrl.process", () => {
  it("accepts a URL object and rejects other schemes", () => {
    expect(Option.isSome(DataUrl.process(new URL("data:,x")))).toBe(true);
    expect(Option.isNone(DataUrl.process("https://example.com/,x"))).toBe(true);
    expect(Option.isNone(DataUrl.process("not a url"))).toBe(true);
  });

  it("decodes a base64 image", () => {
    const parsed = DataUrl.process("data:image/png;base64,iVBORw0KGgo=");
    expect(Option.map(parsed, ({ mimeType }) => MimeType.essence(mimeType))).toStrictEqual(
      Option.some("image/png"),
    );
    expect(Option.map(parsed, ({ body }) => Array.from(body))).toStrictEqual(
      Option.some([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
