/**
 * Unit tests for `AcceptLanguage.parse` and `negotiateLanguage`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { AcceptLanguage, negotiateLanguage } from "@thomasfosterau/effect-langtag";

describe("AcceptLanguage.parse", () => {
  it("orders by quality, keeping the header's order between equals", () => {
    expect(AcceptLanguage.parse("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5")).toStrictEqual([
      { range: "fr-CH", quality: 1 },
      { range: "fr", quality: 0.9 },
      { range: "en", quality: 0.8 },
      { range: "de", quality: 0.7 },
      { range: "*", quality: 0.5 },
    ]);
    expect(AcceptLanguage.parse("da;q=0.5, en-GB;q=0.8, en;q=0.8")).toStrictEqual([
      { range: "en-GB", quality: 0.8 },
      { range: "en", quality: 0.8 },
      { range: "da", quality: 0.5 },
    ]);
  });

  it("tolerates whitespace and empty entries, drops bad ranges, reads a bad q as 1", () => {
    expect(AcceptLanguage.parse(" en ; Q = 0.3 ,, en-* , de;q=2, fr;level=1")).toStrictEqual([
      { range: "de", quality: 1 },
      { range: "fr", quality: 1 },
      { range: "en", quality: 0.3 },
    ]);
    expect(AcceptLanguage.parse("")).toStrictEqual([]);
  });

  it("keeps q=0 entries", () => {
    expect(AcceptLanguage.parse("en;q=0, de;q=0.000")).toStrictEqual([
      { range: "en", quality: 0 },
      { range: "de", quality: 0 },
    ]);
  });
});

describe("negotiateLanguage", () => {
  const available = ["en", "de", "fr-CA"] as const;

  it("looks up each preference in quality order", () => {
    expect(negotiateLanguage(available, "de-CH, fr;q=0.8")).toStrictEqual(Option.some("de"));
    expect(negotiateLanguage(available, "fr-CA-u-ca-gregory;q=0.9, en;q=0.1")).toStrictEqual(
      Option.some("fr-CA"),
    );
    expect(negotiateLanguage(available, "es, pt;q=0.5")).toStrictEqual(Option.none());
  });

  it("serves the first acceptable tag for *, never one refused with q=0", () => {
    expect(negotiateLanguage(available, "*")).toStrictEqual(Option.some("en"));
    expect(negotiateLanguage(available, "*, en;q=0")).toStrictEqual(Option.some("de"));
    expect(negotiateLanguage(available, "en, *;q=0.1")).toStrictEqual(Option.some("en"));
    expect(negotiateLanguage(["en-GB", "en-US"], "en-GB;q=0, en-US")).toStrictEqual(
      Option.some("en-US"),
    );
    expect(negotiateLanguage(["en-GB"], "en;q=0, *")).toStrictEqual(Option.none());
  });

  it("is None without a header", () => {
    expect(negotiateLanguage(available, undefined)).toStrictEqual(Option.none());
  });
});
