/**
 * Unit tests for `LanguageTag`: the RFC 5646 Appendix A examples, the
 * §2.1.1 case conventions, and the subtag accessors.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { LanguageTag } from "@thomasfosterau/effect-langtag";

const tag = (value: string): LanguageTag.LanguageTag =>
  Schema.decodeUnknownSync(LanguageTag.LanguageTagFromString)(value);

describe("LanguageTag.parse", () => {
  // RFC 5646 Appendix A, every well-formed example, already in canonical case.
  it.each([
    "de",
    "fr",
    "ja",
    "i-enochian",
    "zh-Hant",
    "zh-Hans",
    "sr-Cyrl",
    "sr-Latn",
    "zh-cmn-Hans-CN",
    "cmn-Hans-CN",
    "zh-yue-HK",
    "yue-HK",
    "zh-Hans-CN",
    "sr-Latn-RS",
    "sl-rozaj",
    "sl-rozaj-biske",
    "sl-nedis",
    "de-CH-1901",
    "sl-IT-nedis",
    "hy-Latn-IT-arevela",
    "de-DE",
    "en-US",
    "es-419",
    "de-CH-x-phonebk",
    "x-whatever",
    "qaa-Qaaa-QM-x-southern",
    "de-Qaaa",
    "sr-Latn-QM",
    "sr-Qaaa-RS",
    "en-US-u-islamcal",
    "zh-CN-a-myext-x-private",
    "en-a-myext-b-another",
  ])("accepts %s unchanged", (value) => {
    expect(LanguageTag.parse(value)).toStrictEqual(Option.some(value));
  });

  it.each([
    ["en-us", "en-US"],
    ["ZH-HANT-tw", "zh-Hant-TW"],
    ["az-Arab-x-AZE-derbend", "az-Arab-x-aze-derbend"],
    ["EN-a-BBB-x-CC", "en-a-bbb-x-cc"],
    ["X-PRIVATE-AB", "x-private-ab"],
    ["I-KLINGON", "i-klingon"],
    ["en-gb-OED", "en-GB-oed"],
    ["sgn-be-fr", "sgn-BE-FR"],
    ["ZH-MIN-NAN", "zh-min-nan"],
    ["de-ch-1996", "de-CH-1996"],
  ])("puts %s in canonical case as %s", (input, canonical) => {
    expect(LanguageTag.parse(input)).toStrictEqual(Option.some(canonical));
  });

  it.each([
    "",
    "en-",
    "-en",
    "en--US",
    "de-419-DE", // two regions
    "a-DE", // a singleton as the primary subtag
    "en-a", // a singleton with no subtags
    "en-x", // private use with no subtags
    "abcdefghi", // a subtag over 8 characters
    "en_US",
    "1234",
    "zh-cmn-yue-wuu-min", // four extlangs
    "en-US-u", // a dangling singleton
  ])("rejects %j", (value) => {
    expect(LanguageTag.parse(value)).toStrictEqual(Option.none());
    expect(LanguageTag.isWellFormed(value)).toBe(false);
  });

  it("checks well-formedness, not validity", () => {
    // RFC 5646 Appendix A: invalid (a repeated singleton), but well-formed.
    expect(LanguageTag.isWellFormed("ar-a-aaa-b-bbb-a-ccc")).toBe(true);
    // Not in the registry, but well-formed.
    expect(LanguageTag.isWellFormed("qq-Zzzz")).toBe(true);
  });
});

describe("LanguageTag schemas", () => {
  it("decodes to canonical case and encodes as itself", () => {
    const decoded = Schema.decodeUnknownSync(LanguageTag.LanguageTagFromString)("pt-br");
    expect(decoded).toBe("pt-BR");
    expect(Schema.encodeSync(LanguageTag.LanguageTagFromString)(decoded)).toBe("pt-BR");
    expect(() => Schema.decodeUnknownSync(LanguageTag.LanguageTagFromString)("pt_BR")).toThrow();
  });

  it("accepts only canonical-case tags as LanguageTag", () => {
    expect(Schema.is(LanguageTag.LanguageTag)("en-US")).toBe(true);
    expect(Schema.is(LanguageTag.LanguageTag)("en-us")).toBe(false);
    expect(Schema.is(LanguageTag.LanguageTag)("en-")).toBe(false);
  });
});

describe("LanguageTag.subtags", () => {
  it("splits a full tag by production", () => {
    expect(LanguageTag.subtags(tag("zh-yue-Hant-HK-1996-u-ca-chinese-x-private"))).toStrictEqual({
      kind: "langtag",
      language: Option.some("zh"),
      extlangs: ["yue"],
      script: Option.some("Hant"),
      region: Option.some("HK"),
      variants: ["1996"],
      extensions: [{ singleton: "u", subtags: ["ca", "chinese"] }],
      privateUse: ["private"],
    });
  });

  it("has no parts for private-use and grandfathered tags", () => {
    const privateUse = LanguageTag.subtags(tag("x-foo-bar"));
    expect(privateUse.kind).toBe("privateuse");
    expect(privateUse.privateUse).toStrictEqual(["foo", "bar"]);
    expect(privateUse.language).toStrictEqual(Option.none());
    const grandfathered = LanguageTag.subtags(tag("i-klingon"));
    expect(grandfathered.kind).toBe("grandfathered");
    expect(grandfathered.language).toStrictEqual(Option.none());
  });

  it("reads the primary language, script and region", () => {
    const zh = tag("zh-Hant-TW");
    expect([
      LanguageTag.primaryLanguage(zh),
      LanguageTag.script(zh),
      LanguageTag.region(zh),
    ]).toStrictEqual([Option.some("zh"), Option.some("Hant"), Option.some("TW")]);
    const es = tag("es-419");
    expect([LanguageTag.script(es), LanguageTag.region(es)]).toStrictEqual([
      Option.none(),
      Option.some("419"),
    ]);
  });
});

describe("LanguageTag.direction", () => {
  it.each([
    ["ar", "rtl"],
    ["ar-EG", "rtl"],
    ["he-IL", "rtl"],
    ["fa", "rtl"],
    ["ur-PK", "rtl"],
    ["yi", "rtl"],
    ["ckb", "rtl"],
    ["az-Arab", "rtl"],
    ["pa-Arab-PK", "rtl"],
    ["ar-Latn", "ltr"],
    ["en", "ltr"],
    ["zh-Hant", "ltr"],
    ["ku", "ltr"],
    ["x-ar", "ltr"],
    ["i-klingon", "ltr"],
  ] as const)("reads %s as %s", (value, expected) => {
    expect(LanguageTag.direction(tag(value))).toBe(expected);
  });
});
