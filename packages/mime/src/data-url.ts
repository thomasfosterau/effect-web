/**
 * `data:` URLs as the Fetch Standard's "data: URL processor" (§4.2) reads
 * them: the MIME type and the body bytes, percent- or base64-decoded.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { parse as parseMimeType, type MimeType } from "./mime-type.ts";

/**
 * A processed `data:` URL: its MIME type (`text/plain;charset=US-ASCII`
 * when the URL names none, or a malformed one) and its body.
 *
 * @since 0.1.0
 * @category models
 */
export interface DataUrl {
  readonly mimeType: MimeType;
  readonly body: Uint8Array;
}

const DEFAULT_MIME_TYPE: MimeType = {
  type: "text",
  subtype: "plain",
  parameters: [["charset", "US-ASCII"]],
};

const ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const BASE64_SUFFIX = /; *base64$/i;
const HEX = /^[0-9A-Fa-f]{2}$/;

/** Percent-decodes the UTF-8 bytes of `input` (URL Standard, "percent-decode"). */
const percentDecode = (input: string): Uint8Array => {
  const bytes = new TextEncoder().encode(input);
  const output: Array<number> = [];
  let index = 0;
  // oxlint-disable-next-line effect/imperative-loops -- a byte cursor that skips the two hex digits of each escape.
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    const hex = String.fromCharCode(bytes[index + 1] ?? 0, bytes[index + 2] ?? 0);
    if (byte === 0x25 && HEX.test(hex)) {
      output.push(Number.parseInt(hex, 16));
      index += 3;
    } else {
      output.push(byte);
      index += 1;
    }
  }
  return Uint8Array.from(output);
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The Infra Standard's "forgiving-base64 decode": ASCII whitespace
 * ignored, padding optional, `None` for anything else malformed.
 *
 * @example
 * ```ts
 * import { DataUrl } from "@thomasfosterau/effect-mime"
 *
 * console.log(DataUrl.forgivingBase64Decode(" ab cd")) // Option.some(Uint8Array [105, 183, 29])
 * ```
 *
 * @since 0.1.0
 * @category decoding
 */
export const forgivingBase64Decode = (input: string): Option.Option<Uint8Array> => {
  let data = input.replace(/[\t\n\f\r ]/g, "");
  if (data.length % 4 === 0) data = data.replace(/={1,2}$/, "");
  if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) return Option.none();
  const sextets = Array.from(data, (char) => BASE64_ALPHABET.indexOf(char));
  const bytes = Array.from({ length: Math.floor((sextets.length * 6) / 8) }, (_, index) => {
    const bit = index * 8;
    const first = sextets[Math.floor(bit / 6)] ?? 0;
    const second = sextets[Math.floor(bit / 6) + 1] ?? 0;
    const shift = bit % 6;
    // The byte spans two sextets: the low (6 - shift) bits of the first, then the high bits of the second.
    return ((first << (2 + shift)) | (second >> (4 - shift))) & 0xff;
  });
  return Option.some(Uint8Array.from(bytes));
};

/**
 * Processes a `data:` URL (Fetch §4.2): the URL is parsed and serialised
 * without its fragment; everything before the first `,` is the MIME type
 * (a trailing `;base64` switching the body to forgiving-base64), and the
 * rest is the percent-decoded body. `None` when the string is not a
 * `data:` URL, has no `,`, or has a malformed base64 body.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { DataUrl, MimeType } from "@thomasfosterau/effect-mime"
 *
 * const processed = DataUrl.process("data:image/png;base64,iVBORw0KGgo=")
 * console.log(Option.map(processed, ({ mimeType }) => MimeType.serialize(mimeType))) // Option.some("image/png")
 * console.log(Option.map(processed, ({ body }) => body.length)) // Option.some(8)
 *
 * const text = DataUrl.process("data:,Hello%2C%20World")
 * console.log(Option.map(text, ({ body }) => new TextDecoder().decode(body))) // Option.some("Hello, World")
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const process = (input: string | URL): Option.Option<DataUrl> => {
  const url = URL.parse(input);
  if (url === null || url.protocol !== "data:") return Option.none();
  const serialised = url.href.split("#")[0] ?? "";
  const rest = serialised.slice("data:".length);
  const comma = rest.indexOf(",");
  if (comma < 0) return Option.none();
  let mimeType = rest.slice(0, comma).replace(ASCII_WHITESPACE, "");
  let body = percentDecode(rest.slice(comma + 1));
  if (BASE64_SUFFIX.test(mimeType)) {
    const decoded = forgivingBase64Decode(
      Array.from(body, (byte) => String.fromCharCode(byte)).join(""),
    );
    if (Option.isNone(decoded)) return Option.none();
    body = decoded.value;
    mimeType = mimeType.slice(0, -"base64".length).replace(/ +$/, "").slice(0, -1);
  }
  if (Str.startsWith(";")(mimeType)) mimeType = `text/plain${mimeType}`;
  return Option.some({
    mimeType: Option.getOrElse(parseMimeType(mimeType), () => DEFAULT_MIME_TYPE),
    body,
  });
};
