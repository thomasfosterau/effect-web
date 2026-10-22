/**
 * Percent-encoding (RFC 3986 §2.1), as RFC 6570 §1.5 uses it: `unreserved`
 * keeps only the unreserved characters; `reserved` also keeps the reserved
 * ones and every existing pct-encoded triplet. Both encode a character as
 * the UTF-8 octets of its code point, uppercase hex.
 */

/**
 * `%XX` for each UTF-8 octet of `character`. The encoder is made per call,
 * never at module scope: the package is `"sideEffects": false`.
 */
export const pctEncode = (character: string): string =>
  Array.from(
    new TextEncoder().encode(character),
    (octet) => `%${octet.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("");

const NOT_UNRESERVED = /[^A-Za-z0-9\-._~]/gu;
const NOT_RESERVED_OR_TRIPLET = /%[0-9A-Fa-f]{2}|[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/gu;

/** Encodes everything but the unreserved characters (`U` in RFC 6570). */
export const encodeUnreserved = (value: string): string => value.replace(NOT_UNRESERVED, pctEncode);

/** Encodes everything but the unreserved and reserved characters and pct-encoded triplets (`U+R`). */
export const encodeReserved = (value: string): string =>
  value.replace(NOT_RESERVED_OR_TRIPLET, (match) =>
    match.length === 3 && match.startsWith("%") ? match : pctEncode(match),
  );
