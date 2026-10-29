# Test fixtures

`css-parsing-tests/` vendors the css-parsing-tests suite; its own README pins the commit and licence.

`wpt-color-mix.json` records the vectors of `css/css-color/parsing/color-valid-color-mix-function.html`, `color-invalid-color-mix-function.html` and `color-computed-color-mix-function.html` from [web-platform-tests](https://github.com/web-platform-tests/wpt) (`master` at `ce5ca39`, fetched 2026-10-29), under the 3-Clause BSD License in [`LICENSE.wpt.md`](LICENSE.wpt.md). The files build their cases in script loops, so each was run with its assertions recorded instead of checked. Never edited by hand.

| Key | Entries |
| --- | --- |
| `valid` | `[input, expected specified value, epsilon]`: `epsilon` is the numeric tolerance `fuzzy_test_valid_color` allows, `null` for an exact match |
| `invalid` | inputs that must not parse as a `<color>` |
| `computed` | `[input, expected computed value, epsilon]`, from `fuzzy_test_computed_color` / `test_computed_value` |

`wpt-color-invalid.json` records, from the same commit, the inputs of every `css/css-color/parsing/color-invalid*.html` file but the `color-mix()`, `contrast-color()`, `color-layers()` and relative-colour ones (`color-invalid-color-function`, `-hex-color`, `-hsl`, `-hwb`, `-lab`, `-named-color`, `-rgb` and `color-invalid`), keyed by file: each must not parse as a `<color>`.

`wpt-color-valid.json` records, from the same commit, the vectors of the `css/css-color/parsing/color-valid*.html` files, again leaving out the `color-mix()`, `contrast-color()`, `color-layers()`, relative-colour and system-colour ones. It covers `color-valid-color-function`, `-hsl`, `-hwb`, `-lab`, `-rgb` and `color-valid`, keyed by file, with entries shaped like `wpt-color-mix.json`'s `valid` ones: `[input, expected specified value, epsilon]`.
