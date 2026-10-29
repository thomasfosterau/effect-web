# Test fixtures

Vendored from [web-platform-tests](https://github.com/web-platform-tests/wpt) (`master`; the JSON files fetched 2026-10-23, the `mimesniff/` files 2026-10-29 at `ce5ca39`), under the 3-Clause BSD License in [`LICENSE.wpt.md`](LICENSE.wpt.md). Never edited by hand; refresh them by fetching the same paths again.

| File | Source |
| --- | --- |
| `mime-types.json` | `mimesniff/mime-types/resources/mime-types.json` |
| `generated-mime-types.json` | `mimesniff/mime-types/resources/generated-mime-types.json` |
| `data-urls.json` | `fetch/data-urls/resources/data-urls.json` |
| `base64.json` | `fetch/data-urls/resources/base64.json` |
| `mimesniff/media/*` (`mp3-raw.mp3`, `mp3-with-id3.mp3`, `flac.flac`, `ogg.ogg`, `mp4.mp4`, `wav.wav`, `webm.webm`) | `mimesniff/media/resources/` |
| `mimesniff/sniffing/{binary-data.bin,html-content.html,png-image.png,test-file.zip}` | `mimesniff/sniffing/resources/` |
| `mimesniff/sniffing/{rss.html,atom.html,html-comment}` | `mimesniff/sniffing/support/` |

The `mimesniff/` files are the resources of WPT's `media-sniff.window.js`, `html.window.js`, `html-comment.tentative.window.js` and `mislabeled-binary-resource.tentative.window.js`, which drive a browser; `tests/wpt-sniffing.test.ts` asserts what `Sniff` computes for the same bytes and `Content-Type`s.
