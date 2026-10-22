/**
 * Unit tests for `./browser`'s `IdleDetection`, driven through
 * `./testing`'s `TestIdleDetection`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { IdleDetection } from "@thomasfosterau/effect-web/browser";
import { observe, TestIdleDetection } from "@thomasfosterau/effect-web/testing";

const run = <A, E>(
  effect: Effect.Effect<A, E, IdleDetection.IdleDetection | TestIdleDetection.Control>,
  options?: TestIdleDetection.Options,
) => Effect.runPromise(Effect.provide(effect, TestIdleDetection.layer(options)));

describe("IdleDetection.watch", () => {
  it("emits the state now, then each change, and stops the detector when it ends", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestIdleDetection.Control;
        const seen = yield* observe(IdleDetection.watch({ threshold: "2 minutes" }), 3);
        const running = yield* control.running;
        yield* control.setUser("idle");
        yield* control.setUser("idle");
        yield* control.setScreen("locked");
        return {
          seen: yield* Fiber.join(seen),
          running,
          after: yield* control.running,
          thresholds: yield* control.thresholds,
        };
      }),
      { permission: "granted" },
    );
    expect(result).toStrictEqual({
      seen: [
        { user: "active", screen: "unlocked" },
        { user: "idle", screen: "unlocked" },
        { user: "idle", screen: "locked" },
      ],
      running: 1,
      after: 0,
      thresholds: [120_000],
    });
  });

  it("stops the detector when the stream is interrupted", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestIdleDetection.Control;
        const fiber = yield* observe(IdleDetection.watch({ threshold: 60_000 }), 2);
        const during = yield* control.running;
        yield* Fiber.interrupt(fiber);
        return { during, after: yield* control.running };
      }),
      { permission: "granted" },
    );
    expect(result).toStrictEqual({ during: 1, after: 0 });
  });

  it("fails InvalidRequest under a minute, before starting anything", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestIdleDetection.Control;
        const short = yield* Effect.flip(
          Stream.runDrain(IdleDetection.watch({ threshold: "59 seconds" })),
        );
        return { reason: short.reason, thresholds: yield* control.thresholds };
      }),
      { permission: "granted" },
    );
    expect(result).toStrictEqual({ reason: "InvalidRequest", thresholds: [] });
  });

  it("fails NotAllowed until the permission is granted", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestIdleDetection.Control;
        const refused = yield* Effect.flip(
          Stream.runDrain(IdleDetection.watch({ threshold: "1 minute" })),
        );
        yield* control.setPermission("granted");
        const first = yield* Stream.runHead(IdleDetection.watch({ threshold: "1 minute" }));
        return { reason: refused.reason, granted: first._tag };
      }),
    );
    expect(result).toStrictEqual({ reason: "NotAllowed", granted: "Some" });
  });

  it("fails Unsupported without the API", async () => {
    const { idleDetection } = TestIdleDetection.make({ supported: false });
    expect(idleDetection.supported).toBe(false);
    const watched = await Effect.runPromise(
      Effect.flip(Stream.runDrain(idleDetection.watch({ threshold: "1 minute" }))),
    );
    const asked = await Effect.runPromise(Effect.flip(idleDetection.requestPermission));
    expect([watched.reason, asked.reason]).toStrictEqual(["Unsupported", "Unsupported"]);
    expect(watched).toMatchObject({ _tag: "IdleError", message: "idle detection: Unsupported" });
  });
});

describe("IdleDetection.requestPermission", () => {
  it("returns the user's answer, which becomes the permission", async () => {
    const result = await run(
      Effect.gen(function* () {
        const answer = yield* IdleDetection.requestPermission;
        const watched = yield* Effect.flip(
          Stream.runDrain(IdleDetection.watch({ threshold: "1 minute" })),
        );
        return { answer, watched: watched.reason };
      }),
      { answer: "denied" },
    );
    expect(result).toStrictEqual({ answer: "denied", watched: "NotAllowed" });
  });

  it("maps a rejection without user activation to NotAllowed", async () => {
    const idle = IdleDetection.make(
      class extends EventTarget {
        static requestPermission = (): Promise<"granted" | "denied"> =>
          Promise.reject(new DOMException("Must be handling a user gesture", "NotAllowedError"));
        readonly userState = null;
        readonly screenState = null;
        start(): Promise<void> {
          return Promise.reject(new DOMException("odd", "UnknownError"));
        }
      },
    );
    const asked = await Effect.runPromise(Effect.flip(idle.requestPermission));
    expect(asked.reason).toBe("NotAllowed");
    const started = await Effect.runPromise(
      Effect.flip(Stream.runDrain(idle.watch({ threshold: "1 minute" }))),
    );
    expect(started.reason).toBe("Failed");
  });
});
