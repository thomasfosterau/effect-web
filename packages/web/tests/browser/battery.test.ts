/**
 * Unit tests for `./browser`'s `Battery`, driven through `./testing`'s
 * `TestBattery`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Battery } from "@thomasfosterau/effect-web/browser";
import { observe, TestBattery } from "@thomasfosterau/effect-web/testing";

const run = <A, E>(
  effect: Effect.Effect<A, E, Battery.Battery | TestBattery.Control>,
  options?: TestBattery.Options,
) => Effect.runPromise(Effect.provide(effect, TestBattery.layer(options)));

describe("Battery.status", () => {
  it("reads the battery, with Infinity times as None, acquiring the manager once", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestBattery.Control;
        const first = yield* Battery.status;
        const second = yield* Battery.status;
        return { first, same: second, requests: yield* control.requests };
      }),
      {
        charging: false,
        level: 0.5,
        chargingTime: Number.POSITIVE_INFINITY,
        dischargingTime: 3600,
      },
    );
    const expected = Option.some({
      charging: false,
      level: 0.5,
      chargingTime: Option.none(),
      dischargingTime: Option.some(Duration.hours(1)),
    });
    expect(result).toStrictEqual({ first: expected, same: expected, requests: 1 });
  });

  it("is None without the API, or when getBattery rejects", async () => {
    const missing = TestBattery.make({ supported: false });
    expect(missing.battery.supported).toBe(false);
    expect(await Effect.runPromise(missing.battery.status)).toStrictEqual(Option.none());
    expect(await Effect.runPromise(Stream.runCollect(missing.battery.changes))).toStrictEqual([]);
    const rejected = TestBattery.make({ reject: true });
    expect(rejected.battery.supported).toBe(true);
    expect(await Effect.runPromise(rejected.battery.status)).toStrictEqual(Option.none());
    expect(await Effect.runPromise(Stream.runCollect(rejected.battery.changes))).toStrictEqual([]);
    const live = await Effect.runPromise(Effect.provide(Battery.status, Battery.layer));
    expect(live).toStrictEqual(Option.none());
  });
});

describe("Battery.changes", () => {
  it("emits the reading now, then each change, deduplicated", async () => {
    const seen = await run(
      Effect.gen(function* () {
        const control = yield* TestBattery.Control;
        const fiber = yield* observe(Battery.changes, 3);
        yield* control.set({
          charging: false,
          chargingTime: Number.POSITIVE_INFINITY,
          dischargingTime: 7200,
        });
        yield* control.set({ charging: false });
        yield* control.set({ level: 0.9 });
        return yield* Fiber.join(fiber);
      }),
    );
    expect(seen.map((state) => [state.charging, state.level])).toStrictEqual([
      [true, 1],
      [false, 1],
      [false, 0.9],
    ]);
    expect(seen[0]?.chargingTime).toStrictEqual(Option.some(Duration.zero));
    expect(seen[1]?.dischargingTime).toStrictEqual(Option.some(Duration.hours(2)));
  });
});
