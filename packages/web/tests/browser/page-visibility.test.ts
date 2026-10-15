/**
 * Unit tests for `./browser`'s `PageVisibility`, driven through
 * `./testing`'s `TestPageVisibility`.
 */

/*
 * A vitest test body IS the runtime boundary — it is the entrypoint that runs
 * the effect under test, and `effect-run-in-body` has no entrypoint detection.
 */
/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { PageVisibility } from "@thomasfosterau/effect-web/browser";
import { TestPageVisibility, observe } from "@thomasfosterau/effect-web/testing";

describe("PageVisibility", () => {
  it("reads and follows the visibility state", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestPageVisibility.Control;
          const seen = yield* observe(PageVisibility.changes, 3);
          yield* control.set("hidden");
          yield* control.set("hidden");
          yield* control.set("visible");
          return { seen: yield* Fiber.join(seen), now: yield* PageVisibility.state };
        }),
        TestPageVisibility.layer(),
      ),
    );
    expect(result).toStrictEqual({ seen: ["visible", "hidden", "visible"], now: "visible" });
  });

  it("is always visible without a document, and under Node's live layer", async () => {
    const visibility = PageVisibility.make(undefined);
    expect(await Effect.runPromise(Stream.runCollect(visibility.changes))).toStrictEqual([
      "visible",
    ]);
    expect(
      await Effect.runPromise(Effect.provide(PageVisibility.state, PageVisibility.layer)),
    ).toBe("visible");
  });

  it("waits for visibility with awaitVisible", async () => {
    const log = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestPageVisibility.Control;
          const entries: Array<string> = [];
          const fiber = yield* Effect.forkChild(
            Effect.andThen(
              PageVisibility.awaitVisible,
              Effect.sync(() => entries.push("visible")),
            ),
          );
          entries.push("hidden");
          yield* control.set("visible");
          yield* Fiber.join(fiber);
          return entries;
        }),
        TestPageVisibility.layer("hidden"),
      ),
    );
    expect(log).toStrictEqual(["hidden", "visible"]);
  });

  it("runs work only while visible, restarting it on each return", async () => {
    const log = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestPageVisibility.Control;
          const events = yield* Queue.unbounded<string>();
          const work = Queue.offer(events, "start").pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Queue.offer(events, "stop")),
          );
          const fiber = yield* Effect.forkChild(PageVisibility.whileVisible(work));
          const entries = [yield* Queue.take(events)];
          yield* control.set("hidden");
          entries.push(yield* Queue.take(events));
          yield* control.set("visible");
          entries.push(yield* Queue.take(events));
          yield* Fiber.interrupt(fiber);
          entries.push(yield* Queue.take(events));
          return entries;
        }),
        TestPageVisibility.layer(),
      ),
    );
    expect(log).toStrictEqual(["start", "stop", "start", "stop"]);
  });

  it("fails whileVisible when the work fails", async () => {
    const error = await Effect.runPromise(
      Effect.provide(
        Effect.flip(PageVisibility.whileVisible(Effect.fail("boom"))),
        TestPageVisibility.layer(),
      ),
    );
    expect(error).toBe("boom");
  });
});
