# @thomasfosterau/effect-mime

MIME types for [Effect](https://effect.website), after the [WHATWG MIME Sniffing](https://mimesniff.spec.whatwg.org/) and [Fetch](https://fetch.spec.whatwg.org/#data-urls) standards: parse and serialise `type/subtype;name=value`, decide what a resource is from its leading bytes, map file extensions, and process `data:` URLs. Checked against the web-platform-tests vectors for MIME type parsing and `data:` URLs.

```sh
pnpm add @thomasfosterau/effect-mime effect
```

```ts
import * as Option from "effect/Option";
import { DataUrl, Extension, MimeType, Sniff } from "@thomasfosterau/effect-mime";

MimeType.parse('Text/HTML; Charset="utf-8"').pipe(Option.map(MimeType.serialize)); // Option.some("text/html;charset=utf-8")

const bytes = new TextEncoder().encode("%PDF-1.7\n");
MimeType.essence(Sniff.sniff(bytes)); // "application/pdf"

Extension.mimeTypeFor("Report.DOCX"); // Option.some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")

DataUrl.parse("data:,Hello%2C%20World").pipe(
  Option.map(({ body }) => new TextDecoder().decode(body)),
); // Option.some("Hello, World")
```

## `MimeType`

| Export | What it does |
| --- | --- |
| `parse(string)` | §4.4: `Option<MimeType>`, `None` without a valid `type/subtype`. Type, subtype and parameter names lower-cased; parameters ordered, first value of a repeated name wins; a malformed parameter skipped. |
| `serialize(mimeType)` | §4.5: `type/subtype;name=value`, quoting a value that is empty or not a token. |
| `essence`, `parameter(mimeType, name)`, `isXml` | `type/subtype`; a parameter by case-insensitive name; whether it is an XML MIME type (`+xml`, `text/xml`, `application/xml`). |
| `MimeType`, `MimeTypeFromString` | The record's `Schema` (`{ type, subtype, parameters: ReadonlyArray<[name, value]> }`) and the string codec (decode by `parse`, encode by `serialize`). |

## `Sniff`

| Export | What it does |
| --- | --- |
| `sniff(bytes, { supplied?, noSniff?, scriptable? = true, signatures? })` | §7.1's computed MIME type, from the first 1445 bytes: an unknown type is identified (HTML / XML / PDF while `scriptable`, PostScript, BOM-led text, images, audio and video, archives, your `signatures`, then text or binary); a supplied image, audio or video type is corrected from the bytes; anything else (or `noSniff`) keeps the supplied type. |
| `matchImage`, `matchAudioOrVideo`, `matchFont`, `matchArchive` | The §6 pattern matchers, each a `Signature`: `(bytes) => Option<string>`. Audio / video includes the MP4 and WebM signatures; MP3 without an ID3 tag is not detected yet. |
| `Signature` | Your own detector: register OOXML / ODF (zip inspection), CFB, RTF and the like through `signatures`, tried after the standard patterns. |

## `Extension`

`DEFAULT_EXTENSIONS` is a curated table of web formats, images, audio and video, fonts, documents (PDF, RTF, EPUB, OOXML, ODF) and archives, not a mime-db copy. `mimeTypeFor(nameOrExtension, table?)`, `extensionFor(mimeType, table?)` (the preferred extension: `jpg` for `image/jpeg`) and `extend(entries, base?)` for custom entries.

## `DataUrl`

`parse(url)` is Fetch's `data:` URL processor: `Option<{ mimeType, body: Uint8Array }>`, percent-decoding the body or forgiving-base64-decoding it under `;base64`, with `text/plain;charset=US-ASCII` for a missing or malformed type. `forgivingBase64Decode` is exported on its own.

## Licence

MIT. Test vectors from web-platform-tests (BSD-3-Clause).
