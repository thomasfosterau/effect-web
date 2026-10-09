---
"@thomasfosterau/effect-web": patch
---

The `fetchFollowingRedirects` docs now say that the structured `cause` on a rejection can be read in the same realm only, because across `structuredClone`, `postMessage` or Workers RPC it arrives as a plain `Error` that keeps only its message.
