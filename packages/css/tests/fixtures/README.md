# Test fixtures

`css-parsing-tests/` vendors the css-parsing-tests suite; its own README pins the commit and licence.

`wpt-color-mix.json` records the vectors of `css/css-color/parsing/color-valid-color-mix-function.html` and `color-invalid-color-mix-function.html` from [web-platform-tests](https://github.com/web-platform-tests/wpt) (`master` at `ce5ca39`, fetched 2026-10-29), under the 3-Clause BSD License in [`LICENSE.wpt.md`](LICENSE.wpt.md). The files build their cases in script loops, so each was run with its assertions recorded instead of checked. Never edited by hand.

| Key | Entries |
| --- | --- |
| `valid` | `[input, expected specified value, epsilon]`: `epsilon` is the numeric tolerance `fuzzy_test_valid_color` allows, `null` for an exact match |
| `invalid` | inputs that must not parse as a `<color>` |
