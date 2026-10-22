/**
 * The `Accept-Language` request header (RFC 9110 §12.5.4): parse it into a
 * weighted priority list of language ranges (`negotiateLanguage` chooses
 * the language to serve from it).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { isBasic } from "./language-range.ts";

/**
 * One `Accept-Language` entry: a basic language `range` (`en-GB`, `*`) and
 * its `quality`, from `0` (not acceptable) to `1` (the default).
 *
 * @since 0.1.0
 * @category models
 */
export interface Preference {
  readonly range: string;
  readonly quality: number;
}

const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * The weight of one entry's parameters: the first `q`, or `1` when there
 * is none — or when it is malformed, which is a client bug, not a refusal.
 */
const qualityOf = (parameters: ReadonlyArray<string>): number => {
  const q = Arr.findFirst(parameters, (parameter) => {
    const [name, value] = parameter.split("=").map((part) => part.trim());
    return name?.toLowerCase() === "q" && value !== undefined ? Option.some(value) : Option.none();
  });
  return Option.match(q, {
    onNone: () => 1,
    onSome: (value) => (QVALUE.test(value) ? Number(value) : 1),
  });
};

const entryOf = (entry: string): Option.Option<Preference> => {
  const [range = "", ...parameters] = entry.split(";").map((part) => part.trim());
  return isBasic(range) ? Option.some({ range, quality: qualityOf(parameters) }) : Option.none();
};

const byQualityDescending: Order.Order<Preference> = Order.mapInput(
  Order.flip(Order.Number),
  (preference: Preference) => preference.quality,
);

/**
 * Parses an `Accept-Language` value into its {@link Preference}s, highest
 * quality first; entries of equal quality keep the header's order (RFC
 * 4647 §2.3 reads the header as a priority list). An entry whose range is
 * not a basic language range is dropped; a malformed `q` reads as `1`.
 * Entries with `q=0` are kept: they say what is *not* acceptable.
 *
 * @example
 * ```ts
 * import { AcceptLanguage } from "@thomasfosterau/effect-langtag"
 *
 * console.log(AcceptLanguage.parse("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5"))
 * // [{ range: "fr-CH", quality: 1 }, { range: "fr", quality: 0.9 }, …, { range: "*", quality: 0.5 }]
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (header: string): ReadonlyArray<Preference> =>
  Arr.sort(
    Arr.getSomes(
      Arr.map(
        Arr.filter(header.split(","), (entry) => entry.trim() !== ""),
        entryOf,
      ),
    ),
    byQualityDescending,
  );
