---
"@thomasfosterau/effect-web": patch
---

Documentation: invariant ids in doc comments now sit on the exports that enforce them. `isCrossOriginRejected` and `crossOriginMutationRejection` cite SEC-CSRF-001; `classifyRoute` cites PERF-CACHE-001 in place of `LOCALE_INVARIANT_ASSET_PATHS` and `isOpenGraphCard`; `LOCALE_INVARIANT_ASSET_PATHS` cites OG-IMG-001 for the default share card; `negotiateRepresentation` and `makeMarkdownPathMatcher` cite DISC-009; PERF-CACHE-005 moves from the `Representation` type to `Negotiation.representation`; `fetchFollowingRedirects` cites SEC-SSRF-003. The `effect-web/net` module description now says the plain `Promise` / `Error` adapters throw or reject with the tagged failures' messages. No code changes.
