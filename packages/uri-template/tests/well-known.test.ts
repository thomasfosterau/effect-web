/**
 * Unit tests for `WellKnown`: building and recognising RFC 8615 URLs.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { WellKnown } from "@thomasfosterau/effect-uri-template";

const href = (origin: string | URL, suffix: string) =>
  Result.map(WellKnown.url(origin, suffix), (url) => url.href);

describe("WellKnown.url", () => {
  it("builds the URL at the root of the origin, whatever the path", () => {
    expect(href("https://example.org/tables/1.csv?x#y", "csvm")).toStrictEqual(
      Result.succeed("https://example.org/.well-known/csvm"),
    );
    expect(href(new URL("http://localhost:8080/a"), "security.txt")).toStrictEqual(
      Result.succeed("http://localhost:8080/.well-known/security.txt"),
    );
    expect(href("wss://chat.example/", "host-meta.json")).toStrictEqual(
      Result.succeed("wss://chat.example/.well-known/host-meta.json"),
    );
  });

  it.each(["", ".", "..", "a/b", "a?b", "a#b", "a b"])("rejects the suffix %j", (suffix) => {
    const result = WellKnown.url("https://example.org", suffix);
    expect(Result.isFailure(result) && result.failure.reason).toBe("InvalidSuffix");
  });

  it.each(["/relative", "not a url", "ftp://example.org", "mailto:a@example.org"])(
    "rejects the origin %j",
    (origin) => {
      const result = WellKnown.url(origin, "csvm");
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "WellKnownError",
        reason: "InvalidOrigin",
      });
    },
  );

  it("accepts every registered suffix", () => {
    expect(WellKnown.registeredSuffixes.every(WellKnown.isValidSuffix)).toBe(true);
  });
});

describe("WellKnown.suffixOf", () => {
  it("reads the suffix of a well-known URL, and None otherwise", () => {
    expect(
      WellKnown.suffixOf("https://example.org/.well-known/acme-challenge/token"),
    ).toStrictEqual(Option.some("acme-challenge"));
    expect(WellKnown.suffixOf(new URL("https://example.org/.well-known/csvm"))).toStrictEqual(
      Option.some("csvm"),
    );
    expect(WellKnown.suffixOf("https://example.org/docs/.well-known/csvm")).toStrictEqual(
      Option.none(),
    );
    expect(WellKnown.suffixOf("https://example.org/.well-known/")).toStrictEqual(Option.none());
    expect(WellKnown.suffixOf("not a url")).toStrictEqual(Option.none());
  });
});
