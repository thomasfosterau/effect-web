# @thomasfosterau/effect-langtag

BCP 47 language tags ([RFC 5646](https://www.rfc-editor.org/rfc/rfc5646)) and language-range matching ([RFC 4647](https://www.rfc-editor.org/rfc/rfc4647)) for [Effect](https://effect.website).

`Intl.Locale` canonicalises tags but rejects some well-formed ones (grandfathered and private-use forms), and there is no built-in RFC 4647 matching. This package parses every well-formed tag, matches the way RFC 4647 specifies, and negotiates a language from `Accept-Language`.

```sh
pnpm add @thomasfosterau/effect-langtag effect
```

## `LanguageTag`

```ts
import * as Option from "effect/Option";
import { LanguageTag } from "@thomasfosterau/effect-langtag";

LanguageTag.parse("zh-hant-tw"); // Some("zh-Hant-TW")
LanguageTag.parse("de-419-DE"); // None: two regions

const tag = Option.getOrThrow(LanguageTag.parse("ar-EG"));
LanguageTag.primaryLanguage(tag); // Some("ar")
LanguageTag.region(tag); // Some("EG")
LanguageTag.direction(tag); // "rtl"
```

- `parse(string): Option<LanguageTag>` — any case in, canonical case out (`en-us` → `en-US`, `ZH-HANT` → `zh-Hant`, `I-KLINGON` → `i-klingon`). A `LanguageTag` is a branded string, so two tags are equal exactly when they are `===`.
- `LanguageTagFromString` — the same as a `Schema` codec (string → `LanguageTag`); `LanguageTag` is the schema of the branded, canonical-case value itself.
- `isWellFormed(string)` — the RFC 5646 §2.1 ABNF: language, extlangs, script, region, variants, extensions, private use, and the grandfathered tags.
- `subtags(tag)` — `{ kind, language, extlangs, script, region, variants, extensions, privateUse }`, with `Option` for the single subtags.
- `primaryLanguage`, `script`, `region` — the single subtags as `Option`s.
- `direction(tag)` — `"rtl"` or `"ltr"`, a hint for an HTML `dir`: from the script where there is one (`az-Arab`), else from the language (`ar`, `he`, `fa`, `ur`, `yi`, …).

**Well-formed, not valid.** Nothing here consults the IANA Language Subtag Registry: `qq-Zzzz` is accepted, `iw` is not mapped to `he`, and a repeated singleton (`ar-a-aaa-b-bbb-a-ccc`) is not rejected.

## `LanguageRange`

```ts
import { LanguageRange } from "@thomasfosterau/effect-langtag";

LanguageRange.filterBasic(["de-CH", "en"], ["en-US", "de", "de-CH-1996"]); // ["de-CH-1996", "en-US"]
LanguageRange.filterExtended(["*-CH"], ["de-CH", "fr-CH", "de-DE"]); // ["de-CH", "fr-CH"]
LanguageRange.lookup(["de-CH-1996", "fr"], ["fr-FR", "de"]); // Some("de")
```

- `matchesBasic` / `filterBasic` — RFC 4647 §3.3.1: a range matches a tag equal to it or starting with it and a `-`; `*` matches everything.
- `matchesExtended` / `filterExtended` — §3.3.2: subtags match in order, skipping tag subtags (never past a singleton), `*` matching any subtag.
- `lookup` / `fallbacks` — §3.4: each range, truncated from the end (`de-CH-1996` → `de-CH` → `de`), against the available tags; `None` for the caller's default. Lookup truncates the _range_: `de` does not select an available `de-DE`.
- `isBasic`, `isExtended` — range syntax.

Every function compares case-insensitively and returns the caller's own values.

## `AcceptLanguage` and `negotiateLanguage`

```ts
import { AcceptLanguage, negotiateLanguage } from "@thomasfosterau/effect-langtag";

AcceptLanguage.parse("fr-CH, fr;q=0.9, en;q=0.8"); // [{ range: "fr-CH", quality: 1 }, …]
negotiateLanguage(["en", "de", "fr"], request.headers.get("accept-language") ?? undefined);
```

- `AcceptLanguage.parse(header)` — `{ range, quality }` entries, highest quality first, ties in header order. Bad ranges are dropped; a malformed `q` reads as `1`; `q=0` entries are kept.
- `negotiateLanguage(available, header)` — lookup over the positive-quality ranges in order, never choosing a tag a `q=0` range matches; `*` takes the first remaining available tag. `None` when nothing is acceptable.

## License

MIT — see [LICENSE](LICENSE).
