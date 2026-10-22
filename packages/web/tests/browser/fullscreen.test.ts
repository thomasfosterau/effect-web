/**
 * Unit tests for `./browser`'s `Fullscreen`, driven through `./testing`'s
 * `TestFullscreen`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import { Fullscreen } from "@thomasfosterau/effect-web/browser";
import { observe, TestFullscreen } from "@thomasfosterau/effect-web/testing";

const run = <A, E>(
  effect: Effect.Effect<A, E, Fullscreen.Fullscreen | TestFullscreen.Control>,
  options?: TestFullscreen.Options,
) => Effect.runPromise(Effect.provide(effect, TestFullscreen.layer(options)));

describe("Fullscreen.enter", () => {
  it("shows the element for the scope, and leaves fullscreen when it closes", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestFullscreen.Control;
        const video = yield* control.element("video");
        const seen = yield* observe(Fullscreen.changes, 3);
        const during = yield* Effect.scoped(
          Effect.andThen(
            Fullscreen.Fullscreen.use((f) => f.enter(video)),
            Fullscreen.element,
          ),
        );
        const changes = (yield* Fiber.join(seen)).map(Option.map((element) => element === video));
        return {
          during: Option.contains(during, video),
          after: yield* Fullscreen.element,
          changes,
        };
      }),
    );
    expect(result).toStrictEqual({
      during: true,
      after: Option.none(),
      changes: [Option.none(), Option.some(true), Option.none()],
    });
  });

  it("does not leave fullscreen for an element that is no longer fullscreen", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestFullscreen.Control;
        const video = yield* control.element("video");
        const slides = yield* control.element("slides");
        yield* Effect.scoped(
          Effect.gen(function* () {
            const fullscreen = yield* Fullscreen.Fullscreen;
            yield* fullscreen.enter(video);
            // A later request puts another element up; the first scope's
            // release must not undo it.
            yield* Effect.forkDetach(
              Effect.scoped(Effect.andThen(fullscreen.enter(slides), Effect.never)),
            );
            yield* Effect.yieldNow;
          }),
        );
        const afterSwap = yield* Fullscreen.element;
        // The user leaving with Esc before the scope closes is fine too.
        yield* control.exit;
        const left = yield* Effect.scoped(
          Effect.gen(function* () {
            const fullscreen = yield* Fullscreen.Fullscreen;
            yield* fullscreen.enter(video);
            yield* control.exit;
            return yield* Fullscreen.element;
          }),
        );
        return {
          slides: Option.contains(afterSwap, slides),
          left,
          requests: yield* control.requests,
        };
      }),
    );
    expect(result).toStrictEqual({ slides: true, left: Option.none(), requests: 3 });
  });

  it("fails NotAllowed when refused, and Unsupported without the API", async () => {
    const refused = await run(
      Effect.gen(function* () {
        const control = yield* TestFullscreen.Control;
        const video = yield* control.element("video");
        return yield* Effect.flip(Effect.scoped(Fullscreen.Fullscreen.use((f) => f.enter(video))));
      }),
      { allow: false },
    );
    expect(refused).toMatchObject({
      _tag: "FullscreenError",
      reason: "NotAllowed",
      message: "fullscreen: NotAllowed",
    });
    const disabled = TestFullscreen.make({ supported: false });
    expect(disabled.fullscreen.supported).toBe(false);
    const element = await Effect.runPromise(disabled.control.element("x"));
    const unsupported = await Effect.runPromise(
      Effect.flip(Effect.scoped(disabled.fullscreen.enter(element))),
    );
    expect(unsupported.reason).toBe("Unsupported");
    const missing = Fullscreen.make(undefined);
    expect(await Effect.runPromise(missing.element)).toStrictEqual(Option.none());
  });

  it("maps an unknown rejection to Failed", async () => {
    const fullscreen = Fullscreen.make(
      Object.assign(new EventTarget(), {
        fullscreenElement: null,
        fullscreenEnabled: true,
        exitFullscreen: () => Promise.resolve(),
      }),
    );
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.scoped(
          fullscreen.enter({
            requestFullscreen: () => Promise.reject(new DOMException("odd", "UnknownError")),
          }),
        ),
      ),
    );
    expect(error.reason).toBe("Failed");
  });
});

describe("Fullscreen.withFullscreen", () => {
  it("holds fullscreen exactly while the effect runs, in either argument order", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestFullscreen.Control;
        const video = yield* control.element("video");
        const piped = yield* Fullscreen.element.pipe(Fullscreen.withFullscreen(video));
        const direct = yield* Fullscreen.withFullscreen(Fullscreen.element, video, {
          navigationUI: "hide",
        });
        return {
          piped: Option.contains(piped, video),
          direct: Option.contains(direct, video),
          after: yield* Fullscreen.element,
        };
      }),
    );
    expect(result).toStrictEqual({ piped: true, direct: true, after: Option.none() });
  });

  it("does not run the effect when refused", async () => {
    const ran: Array<string> = [];
    const error = await run(
      Effect.gen(function* () {
        const control = yield* TestFullscreen.Control;
        const video = yield* control.element("video");
        return yield* Effect.flip(
          Fullscreen.withFullscreen(
            Effect.sync(() => ran.push("ran")),
            video,
          ),
        );
      }),
      { allow: false },
    );
    expect(error.reason).toBe("NotAllowed");
    expect(ran).toStrictEqual([]);
  });
});
