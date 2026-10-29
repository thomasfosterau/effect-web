# @thomasfosterau/effect-encoding

The WHATWG Encoding Standard: `Encoding` (labels to encoding names, BOM sniffing, fatal decoding of bytes and byte streams with a typed `DecodeError` carrying the byte offset, `isSupported` for runtimes whose `TextDecoder` lacks the legacy encodings, and encoding text to UTF-8 and the single-byte encodings with a typed `EncodeError` or the `html` error mode).

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `encoding` allows none). The single-byte encodings and `x-user-defined` decode and encode through the bundled indexes (in the main entry, by owner decision on #160); UTF-8, UTF-16 and the CJK encodings decode through the runtime's `TextDecoder`. `src/internal/` holds the label table, the single-byte indexes (`single-byte.ts`, with `tables.ts` over them), the incremental decoder and the incremental encoder; nothing outside `src/` imports it.

## Invariants

- **The label table and the bundled index are generated data, never edited by hand.** `src/internal/labels.ts` is the Encoding Standard's `encodings.json`; `src/internal/single-byte.ts` its `index-<name>.txt` files (each entry names its file and identifier). The label test checks every entry against the runtime's own `TextDecoder`; `tests/encode.test.ts` checks the tables against the web-platform-tests single-byte vectors, on this runtime and on one whose `TextDecoder` knows only UTF-8.
- **A single-byte encoding always decodes from its bundled index, never the runtime's `TextDecoder`**: Node's ICU disagrees with the standard on five of them (`IBM866`, `KOI8-U`, `windows-874`, `windows-1253`, `windows-1255`).
- **Decoding is fatal by default.** Malformed input fails with `DecodeError`, never U+FFFD, unless the caller passes `fatal: false`.
- **A `DecodeError`'s offset is exact for every encoding.** A fatal decoder runs a shadow backend in lockstep, fed only accepted input; on a failure the shadow is fed the failing chunk a byte at a time. Only fatal decoding pays for the shadow, and only the failing chunk is fed byte-wise. Offsets count from the start of the input, a BOM included; a sequence cut short by the end of input reports the input's length.
- **`"sniff"` is the standard's "decode"**: a BOM overrides the requested encoding and is removed by the decoder here (the backend is built with `ignoreBOM: true`), so a second BOM survives as U+FEFF. `"strip"` leaves the requested encoding's own BOM to `TextDecoder`.
- **Encoding is fatal by default** (`EncodeError { encoding, offset, codePoint }`, the offset in UTF-16 code units); `errorMode: "html"` writes `&#N;`. A lone surrogate encodes as U+FFFD; a stream keeps a trailing high surrogate for the next chunk. `replacement` and UTF-16 have no encoder (the standard's `getOutputEncoding` maps them to UTF-8); the CJK encoders are not here yet.
- **Each stream run gets its own decoder or encoder** (`Stream.unwrap`), so a `decodeStream` or `encodeStream` can be run twice.
- **Nothing runs at import** (`"sideEffects": false`): the bundled tables are string literals, and backends are built on first use.

## Terms

- **Label** — any of the 228 strings that name an encoding (`latin1`, `utf8`, `sjis`).
- **Encoding name** — one of the 40 canonical names (`windows-1252`, `UTF-8`, `Shift_JIS`).
- **Backend** — one encoding's chunk decoder: a bundled single-byte table, the runtime's `TextDecoder`, or `replacement`.
- **Error mode** — what an encoder does with an unmappable code point: `fatal` or `html` (§4.1).
