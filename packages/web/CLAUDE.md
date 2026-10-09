# @thomasfosterau/effect-web

The framework-neutral half of the family: request/response utilities that serve a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally.

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `web`, no outbound rule). Peer: `effect`; `@thomasfosterau/effect-jsonapi` is an optional peer that only the `./negotiate` entry may import.

## Invariants

- **No SvelteKit, Alchemy or Cloudflare dependency**, at the type level included. Anything that needs a Worker binding lives in the consuming application; anything that needs `$app/*` lives in `effect-svelte`.
- **Allow-lists and predicates are parameters**: no viewer or session shape beyond "a viewer was resolved", no route names, no span names. `spanTracer` takes its allow-list; it is never a constant.
- **The stage is the caller's**: nothing here reads an environment (`stageNoindex` takes `indexable`).
- **`logStructured` keeps the flat line shape** (`{"event":…}`), never Effect's logger envelope: the line shape is a stable output contract that log dashboards and queries key on.
- **The `Accept` `q` split is effect-jsonapi's; the weight is local.** Each `Accept` entry, trimmed and with empty `;` parts dropped, goes to `Middleware.contentTypeIsAcceptable`, which ends the media type at the first `q` (RFC 9110 §12.4.2) from the `>=0.16.1` peer floor on. The weight (the first `q`) is read locally, because effect-jsonapi exports no per-entry weight and its `acceptIsAcceptable` reads an unparsable `q` as a refusal, where `./negotiate` reads it as `1` (a malformed weight is a client bug, not a refusal). The local weight goes once effect-jsonapi exports a per-entry weight, or under #58 (whether `./negotiate` defers to effect-jsonapi's `Negotiation`).
- **The plain-`Promise` / plain-`Error` forms** (`assertAllowedUrl`, `fetchFollowingRedirects`) keep fixed message wording (the `UnsafeUrl` and `RedirectRejected` messages), stable because callers' tests pin it; the tests here pin it too. The tagged `cause` they carry is readable in the same realm only.

## Terms

- **Header policy** — a pure `(headers: Headers.Headers) => Headers.Headers`. Composed, then applied once: `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only on change) or `applyToWebHeaders` (in place).
- **Fetch adapter** — the boundary to the Fetch types a SvelteKit hook deals in: Effect's own `HttpServerRequest.fromWeb` / `HttpServerResponse.toWeb`, this package's header adapters, and the `*Web` pre-applied forms.
- **Route class** — `"locale-invariant" | "format-negotiated" | "negotiated"`: what decides a response's `Vary`. Classification is injected; the locale-invariant set ships as the default.
- **Verdict** — a `Negotiation`: representation token, dispatch flag, Markdown flag, §6 error. Decided from the request line and headers alone.
- **Ranking** — the one part of content negotiation that stays local: whether the JSON:API / Markdown instance outranks every other media type the client offered. The §5/§6 parameter rules are effect-jsonapi's.
