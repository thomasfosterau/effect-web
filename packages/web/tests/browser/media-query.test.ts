/**
 * Unit tests for `./browser`'s `MediaQuery`, driven through `./testing`'s
 * `TestMediaQuery`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { MediaQuery } from "@thomasfosterau/effect-web/browser";
import { TestMediaQuery, observe } from "@thomasfosterau/effect-web/testing";

describe("MediaQuery", () => {
  it("reads and follows a query", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestMediaQuery.Control;
          const seen = yield* observe(MediaQuery.changes("(min-width: 40rem)"), 3);
          yield* control.set("(min-width: 40rem)", false);
          yield* control.set("(min-width: 40rem)", true);
          yield* control.set("(max-width: 10rem)", true);
          yield* control.set("(min-width: 40rem)", false);
          return {
            seen: yield* Fiber.join(seen),
            narrow: yield* MediaQuery.matches("(max-width: 10rem)"),
          };
        }),
        TestMediaQuery.layer(),
      ),
    );
    expect(result).toStrictEqual({ seen: [false, true, false], narrow: true });
  });

  it("maps the preference queries", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.all({
          colorScheme: Stream.runCollect(Stream.take(MediaQuery.colorScheme, 1)),
          reducedMotion: Stream.runCollect(Stream.take(MediaQuery.reducedMotion, 1)),
          moreContrast: Stream.runCollect(Stream.take(MediaQuery.moreContrast, 1)),
          reducedData: Stream.runCollect(Stream.take(MediaQuery.reducedData, 1)),
        }),
        TestMediaQuery.layer({
          "(prefers-color-scheme: dark)": true,
          "(prefers-reduced-motion: reduce)": true,
          "(prefers-contrast: more)": true,
        }),
      ),
    );
    expect(result).toStrictEqual({
      colorScheme: ["dark"],
      reducedMotion: [true],
      moreContrast: [true],
      reducedData: [false],
    });
    const light = await Effect.runPromise(
      Effect.provide(
        Stream.runCollect(Stream.take(MediaQuery.colorScheme, 1)),
        TestMediaQuery.layer(),
      ),
    );
    expect(light).toStrictEqual(["light"]);
  });

  it("matches nothing without matchMedia, and under Node's live layer", async () => {
    const mediaQuery = MediaQuery.make(undefined);
    expect(await Effect.runPromise(Stream.runCollect(mediaQuery.changes("print")))).toStrictEqual([
      false,
    ]);
    expect(
      await Effect.runPromise(Effect.provide(MediaQuery.matches("all"), MediaQuery.layer)),
    ).toBe(false);
  });
});
