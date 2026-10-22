/**
 * Unit tests for `LanguageRange`: the RFC 4647 §3.3 and §3.4 examples.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { LanguageRange } from "@thomasfosterau/effect-langtag";

describe("LanguageRange syntax", () => {
  it("tells basic and extended ranges apart", () => {
    expect(["en", "de-CH", "*", "zh-Hant-1996"].map(LanguageRange.isBasic)).toStrictEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["en-*", "*-CH", "1en", "", "en-"].map(LanguageRange.isBasic)).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(["*-CH", "de-*-DE", "*", "en"].map(LanguageRange.isExtended)).toStrictEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["**", "de-", "1-CH"].map(LanguageRange.isExtended)).toStrictEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("LanguageRange basic filtering", () => {
  // RFC 4647 §3.3.1.
  it("matches a range equal to the tag or a prefix ending at a hyphen", () => {
    expect(LanguageRange.matchesBasic("de-de", "de-DE-1996")).toBe(true);
    expect(LanguageRange.matchesBasic("de-de", "de-DE")).toBe(true);
    expect(LanguageRange.matchesBasic("de-de", "de-Deva")).toBe(false);
    expect(LanguageRange.matchesBasic("de-de", "de-Latn-DE")).toBe(false);
    expect(LanguageRange.matchesBasic("de", "dee")).toBe(false);
    expect(LanguageRange.matchesBasic("*", "anything")).toBe(true);
  });

  it("filters in priority order, each tag once", () => {
    expect(
      LanguageRange.filterBasic(["de-CH", "en", "de"], ["en-US", "de", "de-CH-1996", "fr"]),
    ).toStrictEqual(["de-CH-1996", "en-US", "de"]);
  });
});

describe("LanguageRange extended filtering", () => {
  // RFC 4647 §3.3.2: "de-*-DE" (and "de-DE") matches these…
  it.each([
    "de-DE",
    "de-de",
    "de-Latn-DE",
    "de-Latf-DE",
    "de-DE-x-goethe",
    "de-Latn-DE-1996",
    "de-Deva-DE",
  ])("de-*-DE and de-DE match %s", (tag) => {
    expect(LanguageRange.matchesExtended("de-*-DE", tag)).toBe(true);
    expect(LanguageRange.matchesExtended("de-DE", tag)).toBe(true);
  });

  // …and not these.
  it.each(["de", "de-x-DE", "de-Deva"])("de-*-DE does not match %s", (tag) => {
    expect(LanguageRange.matchesExtended("de-*-DE", tag)).toBe(false);
  });

  it("matches a wildcard primary subtag, and filters in priority order", () => {
    expect(LanguageRange.matchesExtended("*-CH", "fr-CH")).toBe(true);
    expect(LanguageRange.matchesExtended("*", "fr-CH")).toBe(true);
    expect(
      LanguageRange.filterExtended(["*-CH"], ["de-CH", "fr-CH", "de-DE", "it-Latn-CH"]),
    ).toStrictEqual(["de-CH", "fr-CH", "it-Latn-CH"]);
  });
});

describe("LanguageRange lookup", () => {
  // RFC 4647 §3.4.
  it("truncates a range from the end, dropping a dangling singleton", () => {
    expect(LanguageRange.fallbacks("zh-Hant-CN-x-private1-private2")).toStrictEqual([
      "zh-Hant-CN-x-private1-private2",
      "zh-Hant-CN-x-private1",
      "zh-Hant-CN",
      "zh-Hant",
      "zh",
    ]);
    expect(LanguageRange.fallbacks("de-CH-1996")).toStrictEqual(["de-CH-1996", "de-CH", "de"]);
  });

  it("returns the first available tag a range's fallbacks reach, ignoring case", () => {
    expect(LanguageRange.lookup(["de-CH-1996", "fr"], ["fr-FR", "de"])).toStrictEqual(
      Option.some("de"),
    );
    expect(LanguageRange.lookup(["fr-FR", "de"], ["fr", "de"])).toStrictEqual(Option.some("fr"));
    expect(LanguageRange.lookup(["EN-us"], ["en-US"])).toStrictEqual(Option.some("en-US"));
  });

  it("never widens a range, and skips *", () => {
    // Lookup truncates the range, never the tag: `de` does not reach `de-DE`.
    expect(LanguageRange.lookup(["de"], ["de-DE"])).toStrictEqual(Option.none());
    expect(LanguageRange.lookup(["*"], ["en"])).toStrictEqual(Option.none());
  });
});
