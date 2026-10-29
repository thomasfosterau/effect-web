# @thomasfosterau/effect-encoding

The [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) on [Effect](https://effect.website): resolve an encoding label, sniff a byte-order mark, decode bytes or a byte stream, and encode text to UTF-8 or a legacy single-byte encoding. Both directions are fatal by default: malformed input fails with a typed `DecodeError` that says which byte went wrong, and an unmappable character with an `EncodeError` that says which character, never a silent U+FFFD or `?`.

```sh
pnpm add @thomasfosterau/effect-encoding effect
```

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Encoding } from "@thomasfosterau/effect-encoding";

const encoding = Option.getOrElse(Encoding.getEncoding("latin1"), () => "UTF-8" as const); // "windows-1252"
const text = await Effect.runPromise(
  Encoding.decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { encoding }),
); // "café"

const decoded = Stream.make(new Uint8Array([0xe2, 0x82]), new Uint8Array([0xac])).pipe(
  Encoding.decodeStream(),
  Stream.runCollect,
); // ["€"]

const csv = await Effect.runPromise(Encoding.encode("Café;5 €", { encoding: "windows-1252" })); // Uint8Array [0x43, 0x61, 0x66, 0xe9, …]
```

## API

| Export | What it does |
| --- | --- |
| `ENCODING_NAMES`, `EncodingName` | The standard's 40 encodings (`UTF-8`, `windows-1252`, `Shift_JIS`, …), as a literal union. |
| `getEncoding(label)` | A label to its encoding (§4.2): ASCII whitespace trimmed, ASCII case-insensitive, against the standard's 228 labels. `Option.none()` for an unknown label. |
| `sniffBom(bytes)` | The BOM sniff (§6): `Option<{ encoding: "UTF-8" \| "UTF-16LE" \| "UTF-16BE", length }>`, a standalone step for hosts that layer their own detection on top (XML Appendix F, HTML `<meta charset>`). |
| `decode(bytes, options?)` | Bytes to a string. `Effect<string, DecodeError \| UnsupportedEncodingError>`. |
| `decodeStream(stream, options?)` / `stream.pipe(decodeStream(options?))` | A `Stream<Uint8Array>` to a `Stream<string>`, with sequences split across chunks handled. Offsets count from the start of the stream. |
| `isSupported(encoding, tables?)` | Whether this runtime (or the given tables) can decode the encoding. |
| `DecodeError` | `{ encoding, offset, message }`: the byte offset the error was detected at (the input's length for a sequence cut short by the end of input). |
| `encode(text, options?)` | Text to bytes (§4.3). `Effect<Uint8Array, EncodeError \| UnsupportedEncodingError>`. A lone surrogate is encoded as U+FFFD. |
| `encodeStream(stream, options?)` / `stream.pipe(encodeStream(options?))` | A `Stream<string>` to a `Stream<Uint8Array>`, with surrogate pairs split across chunks handled. Offsets count from the start of the stream. |
| `canEncode(encoding, tables?)` | Whether there is an encoder: UTF-8, every single-byte encoding and `x-user-defined`, and a CJK encoding when `tables` hold its index. |
| `tablesLayer(...tables)`, `EncodingTables`, `Tables` | Provide the CJK indexes from the opt-in entries (`/japanese`, `/gb18030`, `/big5`, `/euc-kr`) to `encode` / `decode` and their stream forms. |
| `getOutputEncoding(encoding)` | §4.3's "get an output encoding": `replacement`, `UTF-16BE` and `UTF-16LE` (which have no encoder) become `UTF-8`. |
| `EncodeError` | `{ encoding, offset, codePoint, message }`: the unmappable code point and its UTF-16 code-unit offset (a string index). |
| `UnsupportedEncodingError` | `{ encoding, message }`: the runtime's `TextDecoder` lacks the encoding and no table for it is bundled, or there is no encoder for it. |

`DecodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `fatal` — defaults to `true`; `false` decodes malformed input to U+FFFD.
- `bomHandling` — `"sniff"` (default: the standard's "decode", where a BOM overrides `encoding` and is removed), `"strip"` (the requested encoding stands, its own BOM removed) or `"keep"` (a BOM decodes as U+FEFF).

`EncodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `errorMode` — `"fatal"` (default) fails on an unmappable code point; `"html"` writes `&#N;`, as an HTML form does (which silently loses the difference from text that already read `&#N;`).

## Runtime support

The single-byte encodings and `x-user-defined` are decoded and encoded from the standard's indexes, bundled here (about 25 KB of source), whatever the runtime has: some runtimes ship a `TextDecoder` without the legacy encodings (small-ICU Node builds, some edge runtimes), full-ICU Node lacks `ISO-8859-16` and `x-user-defined`, and Node's ICU decodes `IBM866`, `KOI8-U`, `windows-874`, `windows-1253` and `windows-1255` differently from the standard. UTF-8, UTF-16 and the CJK encodings are decoded with the runtime's `TextDecoder`; a CJK encoding it lacks fails with `UnsupportedEncodingError` (check with `isSupported` first if you need to choose).

The CJK encodings (Shift_JIS, EUC-JP, ISO-2022-JP, GBK / gb18030, Big5, EUC-KR) encode, and decode by the standard's own algorithms, once their indexes are provided. The indexes are opt-in entries, so a bundle that never meets them never loads them (each is 70 to 95 KB of source):

```ts
import * as Effect from "effect/Effect";
import { Encoding } from "@thomasfosterau/effect-encoding";
import * as Japanese from "@thomasfosterau/effect-encoding/japanese"; // Shift_JIS, EUC-JP, ISO-2022-JP
import * as Gb18030 from "@thomasfosterau/effect-encoding/gb18030"; // gb18030, GBK
import * as Big5 from "@thomasfosterau/effect-encoding/big5";
import * as EucKr from "@thomasfosterau/effect-encoding/euc-kr";

const sjis = await Effect.runPromise(
  Encoding.encode("日本語", { encoding: "Shift_JIS" }).pipe(
    Effect.provide(Encoding.tablesLayer(Japanese.tables)),
  ),
);
```

Without them, a CJK encoding decodes through the runtime's `TextDecoder` (a small-ICU runtime lacks it: `UnsupportedEncodingError`) and does not encode (`UnsupportedEncodingError`).

## Licence

MIT. The label table and the single-byte indexes come from the Encoding Standard (© WHATWG, CC BY 4.0). Some test vectors come from web-platform-tests (BSD-3-Clause).
