---
"@thomasfosterau/effect-encoding": minor
---

New package `@thomasfosterau/effect-encoding`: the WHATWG Encoding Standard on Effect. `Encoding.getEncoding` resolves a label against the standard's 228 labels; `Encoding.sniffBom` is the BOM sniff as a standalone step; `Encoding.decode` and `Encoding.decodeStream` decode bytes and byte streams (multi-byte sequences split across chunks included), fatal by default with a typed `DecodeError { encoding, offset }` that gives the exact byte offset, and `"sniff"` / `"strip"` / `"keep"` BOM handling; `Encoding.isSupported` reports what the runtime can decode, with `ISO-8859-16` and `x-user-defined` bundled for runtimes (Node among them) whose `TextDecoder` lacks them, and `UnsupportedEncodingError` for any other missing encoding.
