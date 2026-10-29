---
"@thomasfosterau/effect-mime": minor
---

`Sniff` detects MP3 without an ID3 tag (MIME Sniffing §6.2.3: two consecutive Layer III frame headers) in `matchAudioOrVideo` and `sniff`, and takes a `checkForApacheBug` option (§5.1, §7.2): when set and the supplied type is byte-for-byte one of old Apache's `text/plain` values, the computed type is `text/plain` or `application/octet-stream` from the bytes, never a scriptable type. Checked against the web-platform-tests `mimesniff/media/` and `mimesniff/sniffing/` resources.
