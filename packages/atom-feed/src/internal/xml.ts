/**
 * XML text helpers for the renderer. Not part of the public API.
 */

/**
 * Characters XML 1.0 forbids anywhere in a document, escaped or not: the C0
 * controls other than tab, LF and CR, the two non-characters U+FFFE / U+FFFF,
 * and lone surrogates. Authored text pasted from elsewhere carries them; one
 * would make the whole feed unparseable, so they are dropped.
 */
// oxlint-disable-next-line no-control-regex -- matching the control characters XML 1.0 forbids is the point.
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|\p{Cs}/gu;

/** Text safe for element content and double-quoted attribute values. */
export const escapeXml = (value: string): string =>
  value
    .replace(FORBIDDEN, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** `<name>text</name>`, the text escaped. */
export const element = (name: string, text: string): string =>
  `<${name}>${escapeXml(text)}</${name}>`;

/** {@link element}, or nothing when the text is absent. */
export const optionalElement = (name: string, text: string | undefined): string =>
  text === undefined ? "" : element(name, text);

/** The declaration every document opens with. */
export const XML_DECLARATION = `<?xml version="1.0" encoding="UTF-8"?>`;
