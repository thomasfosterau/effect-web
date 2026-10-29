/**
 * Inputs web-platform-tests rejects as a `<color>` (`css/css-color/parsing`,
 * BSD-3-Clause; see `fixtures/README.md`): `Color.parse` must return `None`
 * for each.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import { Color } from "@thomasfosterau/effect-css";
import vectors from "./fixtures/wpt-color-invalid.json" with { type: "json" };

describe.each(Record.toEntries(vectors))("WPT %s", (_file, inputs) => {
  it.each(inputs)("%s", (input) => {
    expect(Color.parse(input)).toStrictEqual(Option.none());
  });
});
