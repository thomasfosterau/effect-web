# @thomasfosterau/effect-encoding

## 0.1.0

### Minor Changes

- [#161](https://github.com/thomasfosterau/effect-web/pull/161) [`0d61df6`](https://github.com/thomasfosterau/effect-web/commit/0d61df62fd7a15d672a06c729aef9ba99a904281) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - New package `@thomasfosterau/effect-encoding`: the WHATWG Encoding Standard on Effect. `Encoding.getEncoding` resolves a label against the standard's 228 labels; `Encoding.sniffBom` is the BOM sniff as a standalone step; `Encoding.decode` and `Encoding.decodeStream` decode bytes and byte streams (multi-byte sequences split across chunks included), fatal by default with a typed `DecodeError { encoding, offset }` that gives the exact byte offset, and `"sniff"` / `"strip"` / `"keep"` BOM handling; `Encoding.isSupported` reports what the runtime can decode, with `ISO-8859-16` and `x-user-defined` bundled for runtimes (Node among them) whose `TextDecoder` lacks them, and `UnsupportedEncodingError` for any other missing encoding.
