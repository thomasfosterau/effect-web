---
"@thomasfosterau/effect-encoding": minor
---

Encode text: `Encoding.encode` and `Encoding.encodeStream` write UTF-8, every single-byte encoding and `x-user-defined`, failing on an unmappable character with a typed `EncodeError { encoding, offset, codePoint }`, or writing `&#N;` under `errorMode: "html"`. `canEncode` and `getOutputEncoding` (§4.3) go with them. Every single-byte encoding now decodes from the standard's bundled indexes rather than the runtime's `TextDecoder`, so it decodes the same on every runtime (Node's ICU disagrees with the standard on `IBM866`, `KOI8-U`, `windows-874`, `windows-1253` and `windows-1255`), and a runtime without the legacy encodings still decodes them. Checked against the web-platform-tests single-byte vectors.
