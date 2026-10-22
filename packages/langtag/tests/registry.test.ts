/**
 * Unit tests for `./registry`: RFC 5646 §2.2.9 validity and §4.5
 * canonicalisation against the IANA Language Subtag Registry snapshot.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { LanguageTag } from "@thomasfosterau/effect-langtag";
import {
  canonicalize,
  isValid,
  registryDate,
  suppressScript,
} from "@thomasfosterau/effect-langtag/registry";

const tag = (value: string): LanguageTag.LanguageTag =>
  Schema.decodeUnknownSync(LanguageTag.LanguageTagFromString)(value);

describe("registryDate", () => {
  it("is the snapshot's File-Date", () => {
    expect(registryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isValid", () => {
  // RFC 5646 Appendix A's valid examples.
  it.each([
    "de",
    "zh-Hant",
    "zh-cmn-Hans-CN",
    "yue-HK",
    "sr-Latn-RS",
    "sl-rozaj-biske",
    "de-CH-1901",
    "hy-Latn-IT-arevela",
    "es-419",
    "de-CH-x-phonebk",
    "x-whatever",
    "qaa-Qaaa-QM-x-southern",
    "en-US-u-islamcal",
    "zh-CN-a-myext-x-private",
    "en-a-myext-b-another",
    "i-enochian",
    "zh-min-nan",
  ])("accepts %s", (value) => {
    expect(isValid(tag(value))).toBe(true);
  });

  it.each([
    ["qq-Zzzz", "an unregistered language"],
    ["en-Abcd", "an unregistered script"],
    ["en-QA1", "not a tag"],
    ["de-AA", "region AA is registered (private use), so this one is valid"],
    ["en-ZZZ-US", "an unregistered extlang"],
    ["de-DE-1901-1901", "a repeated variant"],
    ["ar-a-aaa-b-bbb-a-ccc", "a repeated singleton"],
    ["en-fakevar", "an unregistered variant"],
  ])("decides %s (%s)", (value, why) => {
    const parsed = LanguageTag.parse(value);
    const expected = why.includes("is valid");
    expect(Option.map(parsed, isValid)).toStrictEqual(
      why === "not a tag" ? Option.none() : Option.some(expected),
    );
  });

  it("accepts the private-use ranges, expanded", () => {
    expect([isValid(tag("qtz")), isValid(tag("en-Qabx")), isValid(tag("en-XZ"))]).toStrictEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("canonicalize", () => {
  it.each([
    ["iw-IL", "he-IL"],
    ["in", "id"],
    ["en-BU", "en-MM"],
    ["zh-yue-HK", "yue-HK"],
    ["zh-cmn-Hans-CN", "cmn-Hans-CN"],
    ["i-klingon", "tlh"],
    ["art-lojban", "jbo"],
    ["zh-guoyu", "cmn"],
    ["sgn-BR", "bzs"],
    ["en-b-ccc-a-bbb", "en-a-bbb-b-ccc"],
    ["en-US", "en-US"],
    ["i-default", "i-default"],
    ["x-private", "x-private"],
  ])("puts %s in canonical form as %s", (input, canonical) => {
    expect(canonicalize(tag(input))).toBe(canonical);
  });

  it("drops a suppressed script only when asked", () => {
    expect(canonicalize(tag("en-Latn-US"))).toBe("en-Latn-US");
    expect(canonicalize(tag("en-Latn-US"), { suppressScript: true })).toBe("en-US");
    expect(canonicalize(tag("sr-Latn"), { suppressScript: true })).toBe("sr-Latn");
  });

  it.each(["iw-IL", "zh-yue-HK", "en-BU", "sgn-BR"])("gives a valid tag for %s", (value) => {
    expect(isValid(canonicalize(tag(value)))).toBe(true);
  });
});

describe("suppressScript", () => {
  it("reads the registry's Suppress-Script", () => {
    expect([suppressScript("en"), suppressScript("AR"), suppressScript("zh")]).toStrictEqual([
      Option.some("Latn"),
      Option.some("Arab"),
      Option.none(),
    ]);
  });
});
