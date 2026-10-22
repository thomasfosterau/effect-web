/**
 * Unit tests for `./browser`'s `ScreenOrientation`, driven through
 * `./testing`'s `TestScreenOrientation` (and `TestFullscreen` for the
 * composed form).
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Fullscreen, ScreenOrientation } from "@thomasfosterau/effect-web/browser";
import { observe, TestFullscreen, TestScreenOrientation } from "@thomasfosterau/effect-web/testing";

const run = <A, E>(
  effect: Effect.Effect<A, E, ScreenOrientation.ScreenOrientation | TestScreenOrientation.Control>,
  options?: TestScreenOrientation.Options,
) => Effect.runPromise(Effect.provide(effect, TestScreenOrientation.layer(options)));

describe("ScreenOrientation readings", () => {
  it("reads the orientation and follows each rotation", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestScreenOrientation.Control;
        const seen = yield* observe(ScreenOrientation.changes, 3);
        yield* control.rotate("landscape-primary");
        yield* control.rotate("landscape-primary");
        yield* control.rotate("landscape-secondary", 270);
        return { seen: yield* Fiber.join(seen), current: yield* ScreenOrientation.current };
      }),
    );
    expect(result).toStrictEqual({
      seen: [
        { type: "portrait-primary", angle: 0 },
        { type: "landscape-primary", angle: 90 },
        { type: "landscape-secondary", angle: 270 },
      ],
      current: Option.some({ type: "landscape-secondary", angle: 270 }),
    });
  });

  it("degrades without the API: None, an empty stream, Unsupported", async () => {
    const { orientation } = TestScreenOrientation.make({ supported: false });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return {
          type: yield* orientation.type,
          angle: yield* orientation.angle,
          changes: yield* Stream.runCollect(orientation.changes),
          lock: (yield* Effect.flip(Effect.scoped(orientation.lock("landscape")))).reason,
        };
      }),
    );
    expect({ supported: orientation.supported, ...result }).toStrictEqual({
      supported: false,
      type: Option.none(),
      angle: Option.none(),
      changes: [],
      lock: "Unsupported",
    });
  });
});

describe("ScreenOrientation.lock", () => {
  it("locks for the scope and unlocks when it closes", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestScreenOrientation.Control;
        const during = yield* Effect.scoped(
          Effect.andThen(
            ScreenOrientation.ScreenOrientation.use((orientation) => orientation.lock("landscape")),
            control.locked,
          ),
        );
        return { during, after: yield* control.locked };
      }),
    );
    expect(result).toStrictEqual({ during: Option.some("landscape"), after: Option.none() });
  });

  it("maps each refusal onto its reason", async () => {
    const reasons = await Effect.runPromise(
      Effect.forEach(
        ["NotSupportedError", "SecurityError", "AbortError"] as const,
        (refuse) => {
          const { orientation } = TestScreenOrientation.make({ refuse });
          return Effect.map(
            Effect.flip(Effect.scoped(orientation.lock("portrait"))),
            (error) => error.reason,
          );
        },
        { concurrency: 1 },
      ),
    );
    expect(reasons).toStrictEqual(["Unsupported", "NotAllowed", "Aborted"]);
    const { orientation } = TestScreenOrientation.make({ lockable: false });
    expect(orientation.supported).toBe(true);
    const missing = await Effect.runPromise(
      Effect.flip(Effect.scoped(orientation.lock("portrait"))),
    );
    expect(missing.reason).toBe("Unsupported");
    const odd = ScreenOrientation.make(
      Object.assign(new EventTarget(), {
        type: "portrait-primary" as const,
        angle: 0,
        lock: () => Promise.reject(new DOMException("odd", "UnknownError")),
        unlock: () => {},
      }),
    );
    const failed = await Effect.runPromise(Effect.flip(Effect.scoped(odd.lock("portrait"))));
    expect(failed.reason).toBe("Failed");
  });
});

describe("ScreenOrientation.withLock", () => {
  it("locks inside fullscreen, releasing both in reverse", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const orientation = yield* TestScreenOrientation.Control;
          const fullscreen = yield* TestFullscreen.Control;
          const video = yield* fullscreen.element("video");
          const during = yield* Effect.all([orientation.locked, Fullscreen.element], {
            concurrency: 1,
          }).pipe(ScreenOrientation.withLock("landscape"), Fullscreen.withFullscreen(video));
          return {
            locked: during[0],
            fullscreen: Option.contains(during[1], video),
            after: [yield* orientation.locked, yield* Fullscreen.element],
          };
        }),
        Layer.merge(TestScreenOrientation.layer(), TestFullscreen.layer()),
      ),
    );
    expect(result).toStrictEqual({
      locked: Option.some("landscape"),
      fullscreen: true,
      after: [Option.none(), Option.none()],
    });
  });

  it("does not run the effect when the lock is refused", async () => {
    const ran: Array<string> = [];
    const error = await run(
      Effect.flip(
        ScreenOrientation.withLock(
          Effect.sync(() => ran.push("ran")),
          "landscape",
        ),
      ),
      { refuse: "NotSupportedError" },
    );
    expect(error.reason).toBe("Unsupported");
    expect(ran).toStrictEqual([]);
  });
});
