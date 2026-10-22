/**
 * Compile-time assertions for the language-tag brand and the matching
 * functions' return types. Every binding is exported so an unused-local
 * error can never stand in for the assertion a directive expects.
 */
import * as Option from "effect/Option";
import { LanguageRange, LanguageTag, negotiateLanguage } from "@thomasfosterau/effect-langtag";

// A plain string is not a LanguageTag.
// @ts-expect-error — not branded
export const unbranded: LanguageTag.LanguageTag = "en-US";

export const parsed: Option.Option<LanguageTag.LanguageTag> = LanguageTag.parse("en-US");

// The accessors take a parsed tag only.
// @ts-expect-error — a raw string
export const rawDirection = LanguageTag.direction("ar");

// Matching hands back the caller's own (narrow) values.
const available = ["en", "de"] as const;
export const negotiated: Option.Option<"en" | "de"> = negotiateLanguage(available, "de");
export const looked: Option.Option<"en" | "de"> = LanguageRange.lookup(["de"], available);
export const filtered: ReadonlyArray<"en" | "de"> = LanguageRange.filterBasic(["*"], available);
