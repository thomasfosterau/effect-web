# @thomasfosterau/effect-uri-template

URI Templates ([RFC 6570](https://www.rfc-editor.org/rfc/rfc6570)), Web Linking ([RFC 8288](https://www.rfc-editor.org/rfc/rfc8288)) and well-known URIs ([RFC 8615](https://www.rfc-editor.org/rfc/rfc8615)) for [Effect](https://effect.website).

```sh
pnpm add @thomasfosterau/effect-uri-template effect
```

## `UriTemplate`

```ts
import * as Result from "effect/Result";
import { UriTemplate } from "@thomasfosterau/effect-uri-template";

const template = UriTemplate.parse("https://api.example/users{/id}{?fields*}");
Result.flatMap(template, (t) => UriTemplate.expand(t, { id: "42", fields: ["name", "email"] }));
// Success("https://api.example/users/42?fields=name&fields=email")
```

- `parse(source): Result<UriTemplate, TemplateError>`. The error carries a `reason` (`UnmatchedBrace`, `InvalidLiteral`, `ReservedOperator`, `InvalidVariable`) and the 0-based `position` of the fault.
- `expand(template, variables): Result<string, TemplateError>` covers all four levels: simple, `+` reserved, `#` fragment, `.` label, `/` path segment, `;` path-style parameter, `?` query and `&` continuation, prefix `:n` and explode `*`, with lists and associative arrays. A value is a string, number or boolean, a list of them, or a flat record of them. `null`, `undefined`, `[]` and `{}` count as undefined. The only failure is `PrefixOnComposite` (a prefix on a list or record).
- `variables(template)` lists each variable name once, in order.
- `UriTemplateFromString` is the same as a `Schema` codec.

Conformance is checked against the [uritemplate-test](https://github.com/uri-templates/uritemplate-test) suite: the RFC's examples, the extended tests and the negative tests.

## `LinkHeader`

```ts
import { LinkHeader } from "@thomasfosterau/effect-uri-template";

const links = LinkHeader.parse(response.headers.get("link") ?? "", response.url);
LinkHeader.findRel(links, "describedby"); // Option<Link>
LinkHeader.serialize([LinkHeader.make("/items?page=3", { rel: "next" })]); // "</items?page=3>; rel=next"
```

- `parse(header, base?)` returns `Link`s, each with `target`, a `rel` set, `anchor`, `type`, `media`, `title`, `titleStar` (RFC 8187, decoded with its language), `hreflang` and the remaining `params`. Targets and anchors are resolved against `base` when one is given. It never fails: malformed link-values are skipped, as RFC 8288 Appendix B describes.
- `serialize(links)` produces one header value. Values are quoted where needed, and `title*` is written as UTF-8.
- `make(target, options)` builds a link. `hasRel`, `findRel` and `filterRel` query by relation type: registered types are compared ignoring case, extension URIs exactly.
- `LinkHeaderFromString` is the header value as a `Schema` codec.

## `WellKnown`

```ts
import { WellKnown } from "@thomasfosterau/effect-uri-template";

WellKnown.url("https://example.org/tables/1.csv", "csvm"); // Success(URL "https://example.org/.well-known/csvm")
WellKnown.suffixOf("https://example.org/.well-known/acme-challenge/x"); // Some("acme-challenge")
```

- `url(origin, suffix): Result<URL, WellKnownError>` builds the URL at the root of the origin. It fails with `InvalidSuffix` (not a path segment, or `.` / `..`) or `InvalidOrigin` (a scheme other than `http`, `https`, `ws` or `wss`).
- `suffixOf(url)` returns the suffix a well-known URL addresses. `isValidSuffix` checks suffix syntax.
- `RegisteredSuffix` / `registeredSuffixes` list suffixes in common use (`csvm`, `security.txt`, `change-password`, `openid-configuration`, …).

## License

MIT — see [LICENSE](LICENSE). The test fixtures under `tests/fixtures/uritemplate-test` are Apache-2.0 and are not published.
