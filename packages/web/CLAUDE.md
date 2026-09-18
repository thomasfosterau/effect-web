# packages/web — `@thomasfosterau/effect-web`

The framework-neutral half of the family: request/response utilities that serve a SvelteKit hook, an `HttpApi` middleware or a bare Worker equally. Peer: `effect` only.

## Terms

- **Fetch adapter** — the thin boundary that lets a helper written over `effect/unstable/http` types (`HttpServerRequest` / `HttpServerResponse`) be applied to a raw `Request` / `Response` from a SvelteKit hook.

## Local invariants

- **No SvelteKit, Alchemy or Cloudflare dependency**, at the type level included. Anything that needs a Worker binding lives in `effect-web-cloudflare`; anything that needs `$app/*` lives in `effect-svelte`.
- **No application vocabulary**: no viewer or session shape beyond "a viewer was resolved", no route names, no app-specific span names — allow-lists and predicates are constructor parameters.

## Boundary

Imports nothing from this workspace (`.fallowrc.json` zone `web`, no outbound rule).
