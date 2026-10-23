# @thomasfosterau/effect-encoding

The [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) on [Effect](https://effect.website): resolve an encoding label, sniff a byte-order mark, and decode bytes or a byte stream. Decoding is fatal by default: malformed input fails with a typed `DecodeError` that says which byte went wrong, never a silent U+FFFD.

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
```

## API

| Export | What it does |
| --- | --- |
| `ENCODING_NAMES`, `EncodingName` | The standard's 40 encodings (`UTF-8`, `windows-1252`, `Shift_JIS`, …), as a literal union. |
| `getEncoding(label)` | A label to its encoding (§4.2): ASCII whitespace trimmed, ASCII case-insensitive, against the standard's 228 labels. `Option.none()` for an unknown label. |
| `sniffBom(bytes)` | The BOM sniff (§6): `Option<{ encoding: "UTF-8" \| "UTF-16LE" \| "UTF-16BE", length }>`, a standalone step for hosts that layer their own detection on top (XML Appendix F, HTML `<meta charset>`). |
| `decode(bytes, options?)` | Bytes to a string. `Effect<string, DecodeError \| UnsupportedEncodingError>`. |
| `decodeStream(stream, options?)` / `stream.pipe(decodeStream(options?))` | A `Stream<Uint8Array>` to a `Stream<string>`, with sequences split across chunks handled. Offsets count from the start of the stream. |
| `isSupported(encoding)` | Whether this runtime can decode the encoding. |
| `DecodeError` | `{ encoding, offset, message }`: the byte offset the error was detected at (the input's length for a sequence cut short by the end of input). |
| `UnsupportedEncodingError` | `{ encoding, message }`: the runtime's `TextDecoder` lacks the encoding and no table for it is bundled. |

`DecodeOptions`:

- `encoding` — defaults to `UTF-8`.
- `fatal` — defaults to `true`; `false` decodes malformed input to U+FFFD.
- `bomHandling` — `"sniff"` (default: the standard's "decode", where a BOM overrides `encoding` and is removed), `"strip"` (the requested encoding stands, its own BOM removed) or `"keep"` (a BOM decodes as U+FEFF).

## Runtime support

Decoding uses the runtime's `TextDecoder`. Some runtimes ship it without the legacy encodings (small-ICU Node builds, some edge runtimes), and even full-ICU Node lacks `ISO-8859-16` and `x-user-defined`; those two are decoded from tables bundled here. Any other missing encoding fails with `UnsupportedEncodingError`; check with `isSupported` first if you need to choose.

Encoding to the legacy encodings (`TextEncoder` only does UTF-8) is not here yet.

## Licence

MIT. The label table and the ISO-8859-16 index come from the Encoding Standard (© WHATWG, CC BY 4.0). Some test vectors come from web-platform-tests (BSD-3-Clause).
