/**
 * Unit tests for `./testing`'s `TestGeolocation`, the in-memory double for
 * `@effect/platform-browser`'s `Geolocation`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Geolocation from "@effect/platform-browser/Geolocation";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestGeolocation, observe } from "@thomasfosterau/effect-web/testing";

describe("TestGeolocation", () => {
  it("answers getCurrentPosition with the latest fix", async () => {
    const position = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Geolocation.Geolocation, (geolocation) => geolocation.getCurrentPosition()),
        TestGeolocation.layer({ latitude: 1, longitude: 2, altitude: 30, timestamp: 1000 }),
      ),
    );
    expect(position.coords).toMatchObject({
      latitude: 1,
      longitude: 2,
      accuracy: 10,
      altitude: 30,
    });
    expect(position.timestamp).toBe(1000);
    expect(position.toJSON()).toMatchObject({ timestamp: 1000 });
    expect(position.coords.toJSON()).toMatchObject({ latitude: 1, heading: null });
  });

  it("waits for a fix when there is none yet", async () => {
    const latitude = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const geolocation = yield* Geolocation.Geolocation;
          const control = yield* TestGeolocation.Control;
          const current = yield* Effect.forkChild(geolocation.getCurrentPosition());
          // Subscribed or not, the fiber sees this fix: it is also the latest.
          yield* control.setPosition({ latitude: 10, longitude: 0 });
          return (yield* Fiber.join(current)).coords.latitude;
        }),
        TestGeolocation.layer(),
      ),
    );
    expect(latitude).toBe(10);
  });

  it("streams the latest fix, then every later one", async () => {
    const watched = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const geolocation = yield* Geolocation.Geolocation;
          const control = yield* TestGeolocation.Control;
          const seen = yield* observe(
            Stream.map(geolocation.watchPosition(), (position) => position.coords.latitude),
            3,
          );
          yield* control.setPosition({ latitude: 10, longitude: 0 });
          yield* control.setPosition({ latitude: 20, longitude: 0 });
          return yield* Fiber.join(seen);
        }),
        TestGeolocation.layer({ latitude: 0, longitude: 0 }),
      ),
    );
    expect(watched).toStrictEqual([0, 10, 20]);
  });

  it("fails watchers with the given reason", async () => {
    const reasons = await Effect.runPromise(
      Effect.forEach(["PermissionDenied", "PositionUnavailable", "Timeout"] as const, (failure) =>
        Effect.gen(function* () {
          const { geolocation, control } = yield* TestGeolocation.make({
            latitude: 0,
            longitude: 0,
          });
          yield* control.fail(failure);
          const error = yield* Effect.flip(Stream.runDrain(geolocation.watchPosition()));
          return error.reason._tag;
        }),
      ),
    );
    expect(reasons).toStrictEqual(["PermissionDenied", "PositionUnavailable", "Timeout"]);
  });
});
