# Test fixtures

`wpt-single-byte.json` is extracted from [web-platform-tests](https://github.com/web-platform-tests/wpt) (`master` at `ce5ca39`, fetched 2026-10-29), under the 3-Clause BSD License in [`LICENSE.wpt.md`](LICENSE.wpt.md). Never edited by hand; refresh it by extracting the same literals again.

| Key | Source |
| --- | --- |
| `indexes` | the `singleByteIndexes` object in `encoding/resources/single-byte-decoder.js` (the expected code point for each byte 0x80 to 0xFF, `null` where the index has no pointer), which `encoding/single-byte-decoder.any.js` asserts |
| `bad` | the `bad` lists in `encoding/textdecoder-fatal-single-byte.any.js` (the bytes a fatal decoder must reject), by encoding |
