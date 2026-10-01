---
"@thomasfosterau/effect-web": minor
---

**Breaking:** requires `effect@>=4.0.0-rc.118`; import paths moved from `effect/unstable/*` to `effect/*` (`effect/unstable/http` is now `effect/http`, `effect/unstable/httpapi` is `effect/http-api`). Effect 4.0.0-rc.118 removed the `effect/unstable/*` export paths, so the previous build fails to import on it. The peer floor is raised from `>=4.0.0-rc.115` to `>=4.0.0-rc.118`.

The optional `@thomasfosterau/effect-jsonapi` peer (the `./negotiate` entry) is raised to `>=0.16.1`, the first release built on rc.118.
