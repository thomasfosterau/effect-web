# @thomasfosterau/effect-mime

## 0.1.0

### Minor Changes

- [#165](https://github.com/thomasfosterau/effect-web/pull/165) [`3d98af8`](https://github.com/thomasfosterau/effect-web/commit/3d98af8a85d150d65cc2c00f34f44f4c61727ede) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - New package `@thomasfosterau/effect-mime`, after the WHATWG MIME Sniffing and Fetch standards: `MimeType` parses and serialises `type/subtype;parameters` (with `essence`, `parameter`, `isXml` and the `MimeTypeFromString` schema), `Sniff.sniff` computes a resource's MIME type from its leading bytes and supplied type (images, audio and video including MP4 and WebM, fonts, archives, HTML / XML / PDF, text or binary) and takes custom signatures, `Extension` maps file extensions through a curated, extendable table, and `DataUrl.process` processes `data:` URLs. Checked against the web-platform-tests MIME type and `data:` URL vectors.

- [#175](https://github.com/thomasfosterau/effect-web/pull/175) [`6556ddc`](https://github.com/thomasfosterau/effect-web/commit/6556ddc864f8ff0dbbd37d165e7b66e09de14823) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Sniff` detects MP3 without an ID3 tag (MIME Sniffing §6.2.3: two consecutive Layer III frame headers) in `matchAudioOrVideo` and `sniff`, and takes a `checkForApacheBug` option (§5.1, §7.2): when set and the supplied type is byte-for-byte one of old Apache's `text/plain` values, the computed type is `text/plain` or `application/octet-stream` from the bytes, never a scriptable type. Checked against the web-platform-tests `mimesniff/media/` and `mimesniff/sniffing/` resources.
