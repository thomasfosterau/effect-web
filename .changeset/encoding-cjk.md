---
"@thomasfosterau/effect-encoding": minor
---

The CJK encodings: `Encoding.encode` and `encodeStream` encode Shift_JIS, EUC-JP, ISO-2022-JP, gb18030, GBK, Big5 and EUC-KR, and `decode` / `decodeStream` decode them by the Encoding Standard's algorithms, once their indexes are provided with `Encoding.tablesLayer`. The indexes are opt-in entries (`@thomasfosterau/effect-encoding/japanese`, `/gb18030`, `/big5`, `/euc-kr`), so a bundle that never meets a CJK encoding never loads them. `isSupported` and `canEncode` take the tables as an optional second argument. Checked against the web-platform-tests ISO-2022-JP, gb18030, GBK and Big5 vectors.
