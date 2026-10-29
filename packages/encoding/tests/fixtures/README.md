# Test fixtures

`wpt-single-byte.json` is extracted from [web-platform-tests](https://github.com/web-platform-tests/wpt) (`master` at `ce5ca39`, fetched 2026-10-29), under the 3-Clause BSD License in [`LICENSE.wpt.md`](LICENSE.wpt.md). Never edited by hand; refresh it by extracting the same literals again.

| Key | Source |
| --- | --- |
| `indexes` | the `singleByteIndexes` object in `encoding/resources/single-byte-decoder.js` (the expected code point for each byte 0x80 to 0xFF, `null` where the index has no pointer), which `encoding/single-byte-decoder.any.js` asserts |
| `bad` | the `bad` lists in `encoding/textdecoder-fatal-single-byte.any.js` (the bytes a fatal decoder must reject), by encoding |

`wpt-cjk.json` records the vectors of `encoding/iso-2022-jp-decoder.any.js`, `encoding/big5-encoder.html`, `encoding/iso-2022-jp-encoder.html`, `encoding/legacy-mb-schinese/gb18030/gb18030-{decoder.any.js,encoder.html}` and `encoding/legacy-mb-schinese/gbk/gbk-{decoder.any.js,encoder.html}` (same commit), by running each file with its assertions recorded instead of checked: `decode` entries are bytes and the text a `TextDecoder` must produce (`firstCharacter` where the test reads only the first character); `encode` entries are the input and the URL query an HTML form encodes it to (unmappable characters as `%26%23N%3B`). The streaming cases in `iso-2022-jp-decoder.any.js` are not recorded; `tests/cjk.test.ts` covers streaming itself.
