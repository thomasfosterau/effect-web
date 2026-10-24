/**
 * Compile-time assertions for the encoding-name union and the decoder's
 * error channel. Every binding is exported so an unused-local error can
 * never stand in for the assertion a directive expects.
 */
import type * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-encoding";

export const name: Encoding.EncodingName = "windows-1252";

// A label is not an encoding name: resolve it with getEncoding.
// @ts-expect-error — "latin1" is a label
export const label: Encoding.EncodingName = "latin1";

// @ts-expect-error — an unknown encoding
export const unknown = Encoding.decode(new Uint8Array(), { encoding: "utf-7" });

export const decoded: Effect.Effect<
  string,
  Encoding.DecodeError | Encoding.UnsupportedEncodingError
> = Encoding.decode(new Uint8Array());
