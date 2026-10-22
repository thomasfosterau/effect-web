/**
 * Unit tests for `./testing`'s `TestClipboard`, the in-memory double for
 * `@effect/platform-browser`'s `Clipboard`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Effect from "effect/Effect";
import { TestClipboard } from "@thomasfosterau/effect-web/testing";

describe("TestClipboard", () => {
  it("reads and writes text, clears, and exposes the contents", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard.Clipboard;
          const control = yield* TestClipboard.Control;
          const seeded = yield* clipboard.readString;
          yield* clipboard.writeString("copied");
          const written = yield* control.text;
          yield* control.setText("pasted by the user");
          const pasted = yield* clipboard.readString;
          yield* clipboard.clear;
          return { seeded, written, pasted, cleared: yield* control.text };
        }),
        TestClipboard.layer("seed"),
      ),
    );
    expect(result).toStrictEqual({
      seeded: "seed",
      written: "copied",
      pasted: "pasted by the user",
      cleared: "",
    });
  });

  it("stores written items in place of text", async () => {
    const { clipboard, control } = TestClipboard.make("text");
    // `ClipboardItem` is browser-only; the double stores whatever it is given.
    const items: ClipboardItems = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* clipboard.write(items);
        return {
          read: yield* clipboard.read,
          items: yield* control.items,
          text: yield* control.text,
        };
      }),
    );
    expect(result).toStrictEqual({ read: items, items, text: "" });
  });

  it("fails every operation while denied", async () => {
    const { clipboard, control } = TestClipboard.make();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* control.setDenied(true);
        const errors = yield* Effect.all([
          Effect.flip(clipboard.readString),
          Effect.flip(clipboard.read),
          Effect.flip(clipboard.writeString("x")),
          Effect.flip(clipboard.write([])),
        ]);
        yield* control.setDenied(false);
        yield* clipboard.writeString("ok");
        return { messages: errors.map((error) => error.message), text: yield* control.text };
      }),
    );
    expect(result).toStrictEqual({
      messages: [
        "Unable to read a string from clipboard",
        "Unable to read from clipboard",
        "Unable to write a string to clipboard",
        "Unable to write to clipboard",
      ],
      text: "ok",
    });
  });
});
