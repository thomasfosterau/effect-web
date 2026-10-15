/**
 * Unit tests for `./testing`'s `observe`.
 */

/*
 * A vitest test body IS the runtime boundary — it is the entrypoint that runs
 * the effect under test, and `effect-run-in-body` has no entrypoint detection.
 */
/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { observe } from "@thomasfosterau/effect-web/testing";

describe("observe", () => {
  it("returns once the first element is out, and collects `count` elements", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(observe(Stream.make(1, 2, 3), 2), Fiber.join),
    );
    expect(result).toStrictEqual([1, 2]);
  });

  it("returns when the stream ends, or fails, before emitting", async () => {
    const empty = await Effect.runPromise(Effect.flatMap(observe(Stream.empty, 1), Fiber.join));
    expect(empty).toStrictEqual([]);
    const failed = await Effect.runPromise(
      Effect.flip(Effect.flatMap(observe(Stream.fail("boom"), 1), Fiber.join)),
    );
    expect(failed).toBe("boom");
  });
});
