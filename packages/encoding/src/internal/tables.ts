/**
 * Lookups over the bundled single-byte indexes (`single-byte.ts`): an
 * encoding's high half for the decoder, and the reverse map for the
 * encoder.
 */
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import type { Name as EncodingName } from "./labels.ts";
import { SINGLE_BYTE } from "./single-byte.ts";

/**
 * A single-byte encoding's high half (bytes 0x80 to 0xFF, U+FFFD where
 * unmapped), `None` for an encoding that is not single-byte.
 * `ISO-8859-8-I` shares `ISO-8859-8`'s index.
 */
export const singleByteHigh = (encoding: EncodingName): Option.Option<string> =>
  Record.get<string, string>(SINGLE_BYTE, encoding === "ISO-8859-8-I" ? "ISO-8859-8" : encoding);
