---
"@thomasfosterau/effect-robots": minor
---

robots.txt lines are now parsed by an `@thomasfosterau/effect-parse` grammar, which is a new required peer (`^0.1.0`). Install it alongside the package: `pnpm add @thomasfosterau/effect-parse`.

`parse`, `encode` and the parsing behaviour are unchanged: the acceptance suite and a differential test against the previous parser pin them. `RobotsTxtFromString` is now typed as `Schema.Codec<RobotsTxt, string>`, so its `from` / `to` members are no longer part of the public type.
