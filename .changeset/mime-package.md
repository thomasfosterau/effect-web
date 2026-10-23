---
"@thomasfosterau/effect-mime": minor
---

New package `@thomasfosterau/effect-mime`, after the WHATWG MIME Sniffing and Fetch standards: `MimeType` parses and serialises `type/subtype;parameters` (with `essence`, `parameter`, `isXml` and the `MimeTypeFromString` schema), `Sniff.sniff` computes a resource's MIME type from its leading bytes and supplied type (images, audio and video including MP4 and WebM, fonts, archives, HTML / XML / PDF, text or binary) and takes custom signatures, `Extension` maps file extensions through a curated, extendable table, and `DataUrl.parse` processes `data:` URLs. Checked against the web-platform-tests MIME type and `data:` URL vectors.
