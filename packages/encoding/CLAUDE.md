# @thomasfosterau/effect-encoding

The WHATWG Encoding Standard: `Encoding` (labels to encoding names, BOM sniffing, fatal decoding of bytes and byte streams with a typed `DecodeError` carrying the byte offset, and `isSupported` for runtimes whose `TextDecoder` lacks the legacy encodings).

## Boundary

Peer: `effect`. No workspace dependency (`.fallowrc.json` zone `encoding` allows none). Decoding goes through the runtime's `TextDecoder`; the only tables bundled are the ones a common runtime lacks (`ISO-8859-16` and `x-user-defined`, missing from Node's). `src/internal/` holds the label table, the bundled index and the incremental decoder; nothing outside `src/` imports it.

## Invariants

- **The label table and the bundled index are generated data, never edited by hand.** `src/internal/labels.ts` is the Encoding Standard's `encodings.json`; `src/internal/iso-8859-16.ts` its `index-iso-8859-16.txt`. Each header names its source. The label test checks every entry against the runtime's own `TextDecoder`.
- **Decoding is fatal by default.** Malformed input fails with `DecodeError`, never U+FFFD, unless the caller passes `fatal: false`.
- **A `DecodeError`'s offset is exact for every encoding.** A fatal decoder runs a shadow backend in lockstep, fed only accepted input; on a failure the shadow is fed the failing chunk a byte at a time. Only fatal decoding pays for the shadow, and only the failing chunk is fed byte-wise. Offsets count from the start of the input, a BOM included; a sequence cut short by the end of input reports the input's length.
- **`"sniff"` is the standard's "decode"**: a BOM overrides the requested encoding and is removed by the decoder here (the backend is built with `ignoreBOM: true`), so a second BOM survives as U+FEFF. `"strip"` leaves the requested encoding's own BOM to `TextDecoder`.
- **Each stream run gets its own decoder** (`Stream.unwrap`), so a `decodeStream` can be run twice.
- **Nothing runs at import** (`"sideEffects": false`): the bundled tables are string literals, and backends are built on first use.

## Terms

- **Label** — any of the 228 strings that name an encoding (`latin1`, `utf8`, `sjis`).
- **Encoding name** — one of the 40 canonical names (`windows-1252`, `UTF-8`, `Shift_JIS`).
- **Backend** — one encoding's chunk decoder: the runtime's `TextDecoder`, a bundled single-byte table, or `replacement`.
