---
"@thomasfosterau/effect-robots": patch
---

`parse` ends a line at a bare CR as well as at LF and CRLF (RFC 9309 §2.2's `EOL`). A CR-only robots.txt was read as one line, losing every rule, so a crawler failed open; `evaluateRobots(parse("User-agent: *\rDisallow: /\r"), "examplebot", "/x").allowed` is now `false`. LF and CRLF files parse as before.
