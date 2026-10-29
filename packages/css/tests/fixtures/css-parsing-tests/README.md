# css-parsing-tests

Vendored from [SimonSapin/css-parsing-tests](https://github.com/SimonSapin/css-parsing-tests) at commit `203ce36bffd617db7f118c551e32794561fb273d`, dedicated to the public domain (CC0; see [`LICENSE`](LICENSE)). Never edited by hand; refresh by copying the same files from a newer commit.

Copied: the syntax vectors (`component_value_list`, `one_component_value`, `declaration_list`, `one_declaration`, `one_rule`, `rule_list`, `stylesheet`, `blocks_contents`, `An+B`) and the colour vectors (`color_*`). `color_functions_5.json` covers Color 5: `device-cmyk()`, `light-dark()` and custom spaces. Not copied: `stylesheet_bytes.json`, which parses a stylesheet from bytes (the §3.2 encoding sniff). The package parses text only and leaves decoding to the caller ([#186](https://github.com/thomasfosterau/effect-web/issues/186)).
