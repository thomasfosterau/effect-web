/**
 * Unit tests for the combined layers: `./browser`'s live `layer` (built
 * under Node, where most APIs are missing) and `./testing`'s `layer`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Geolocation from "@effect/platform-browser/Geolocation";
import * as Permissions from "@effect/platform-browser/Permissions";
import * as Effect from "effect/Effect";
import {
  Battery,
  Broadcast,
  IdleDetection,
  layer as browserLayer,
  Locks,
  MediaQuery,
  Navigator,
  PageVisibility,
  WakeLock,
} from "@thomasfosterau/effect-web/browser";
import {
  layer as testLayer,
  TestBattery,
  TestBroadcast,
  TestClipboard,
  TestGeolocation,
  TestIdleDetection,
  TestMediaQuery,
  TestNavigator,
  TestPageVisibility,
  TestPermissions,
  TestWakeLock,
} from "@thomasfosterau/effect-web/testing";

const everyService = Effect.all([
  Broadcast.Broadcast,
  Locks.Locks,
  MediaQuery.MediaQuery,
  Navigator.Navigator,
  PageVisibility.PageVisibility,
  WakeLock.WakeLock,
  Clipboard.Clipboard,
  Geolocation.Geolocation,
  Permissions.Permissions,
  Battery.Battery,
  IdleDetection.IdleDetection,
]);

describe("browser layer", () => {
  it("builds every live service, degrading where the runtime lacks the API", async () => {
    const [broadcast, locks, , , , wakeLock, , , , battery, idle] = await Effect.runPromise(
      Effect.provide(everyService, browserLayer),
    );
    expect({
      broadcast: broadcast.supported,
      locks: locks.supported,
      wakeLock: wakeLock.supported,
      battery: battery.supported,
      idle: idle.supported,
    }).toStrictEqual({
      broadcast: true,
      // Node 24 ships `navigator.locks`; no Node has a wake lock.
      locks: globalThis.navigator?.locks !== undefined,
      wakeLock: false,
      // No Node has `navigator.getBattery` or `IdleDetector`.
      battery: false,
      idle: false,
    });
  });
});

describe("testing layer", () => {
  it("provides every service and every Control", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const [, locks, , , , wakeLock, , , , battery, idle] = yield* everyService;
          yield* Effect.all([
            TestBattery.Control,
            TestBroadcast.Control,
            TestClipboard.Control,
            TestGeolocation.Control,
            TestIdleDetection.Control,
            TestMediaQuery.Control,
            TestNavigator.Control,
            TestPageVisibility.Control,
            TestPermissions.Control,
            TestWakeLock.Control,
          ]);
          return {
            locks: locks.supported,
            wakeLock: wakeLock.supported,
            battery: battery.supported,
            idle: idle.supported,
          };
        }),
        testLayer,
      ),
    );
    expect(result).toStrictEqual({ locks: true, wakeLock: true, battery: true, idle: true });
  });
});
