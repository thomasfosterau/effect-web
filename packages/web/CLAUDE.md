# @thomasfosterau/effect-web

The framework-neutral half of the family: request/response utilities that serve a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally.

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `web`, no outbound rule). Peer: `effect`; `@thomasfosterau/effect-jsonapi` is an optional peer that only the `./negotiate` entry may import.

## Invariants

- **No SvelteKit, Alchemy or Cloudflare dependency**, at the type level included. Anything that needs a Worker binding lives in the consuming application; anything that needs `$app/*` lives in `effect-svelte`.
- **Allow-lists and predicates are parameters**: no viewer or session shape beyond "a viewer was resolved", no route names, no span names. `spanTracer` takes its allow-list; it is never a constant.
- **The stage is the caller's**: nothing here reads an environment (`stageNoindex` takes `indexable`).
- **`logStructured` keeps the flat line shape** (`{"event":…}`), never Effect's logger envelope: the applications' dashboards read it.
- **The `Accept` `q` split is effect-jsonapi's; the weight is local.** Each `Accept` entry goes whole to `Middleware.contentTypeIsAcceptable`, which ends the media type at `q` (RFC 9110 §12.4.2) from the `>=0.16.1` peer floor on. `q` itself is read locally, because effect-jsonapi exports no per-entry weight and its `acceptIsAcceptable` reads an unparsable `q` as a refusal where the applications read it as `1`. Empty `;` parts are dropped before the hand-off.
- **The plain-`Promise` / plain-`Error` forms** (`assertAllowedUrl`, `fetchFollowingRedirects`) keep the applications' message wording; their tests pin it.

## Terms

- **Header policy** — a pure `(headers: Headers.Headers) => Headers.Headers`. Composed, then applied once: `updateHeaders` (an `HttpServerResponse`), `updateWebHeaders` (a Fetch `Response`, cloned only on change) or `applyToWebHeaders` (in place).
- **Fetch adapter** — the boundary to the Fetch types a SvelteKit hook deals in: Effect's own `HttpServerRequest.fromWeb` / `HttpServerResponse.toWeb`, this package's header adapters, and the `*Web` pre-applied forms.
- **Route class** — `"locale-invariant" | "format-negotiated" | "negotiated"`: what decides a response's `Vary`. Classification is injected; the locale-invariant set ships as the default.
- **Verdict** — a `Negotiation`: representation token, dispatch flag, Markdown flag, §6 error. Decided from the request line and headers alone.
- **Ranking** — the one part of content negotiation that stays local: whether the JSON:API / Markdown instance outranks every other media type the client offered. The §5/§6 parameter rules are effect-jsonapi's.
