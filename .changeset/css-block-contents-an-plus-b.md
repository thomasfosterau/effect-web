---
"@thomasfosterau/effect-css": minor
---

`Syntax.parseBlockContents` parses a block's contents with CSS nesting (declarations, at-rules and nested qualified rules in order), and the new `AnPlusB` module parses the `An+B` microsyntax of `:nth-child()` into `[a, b]`. Both are checked against css-parsing-tests' `blocks_contents.json` and `An+B.json`.
