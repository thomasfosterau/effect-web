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
  Fullscreen,
  IdleDetection,
  layer as browserLayer,
  Locks,
  MediaQuery,
  Navigator,
  Notifications,
  PageVisibility,
  ScreenOrientation,
  WakeLock,
} from "@thomasfosterau/effect-web/browser";
import {
  layer as testLayer,
  TestBattery,
  TestBroadcast,
  TestClipboard,
  TestFullscreen,
  TestGeolocation,
  TestIdleDetection,
  TestMediaQuery,
  TestNavigator,
  TestNotifications,
  TestPageVisibility,
  TestPermissions,
  TestScreenOrientation,
  TestWakeLock,
} from "@thomasfosterau/effect-web/testing";

const everyService = Effect.all([
  Broadcast.Broadcast,
  Locks.Locks,
  MediaQuery.MediaQuery,
  Navigator.Navigator,
  Notifications.Notifications,
  PageVisibility.PageVisibility,
  WakeLock.WakeLock,
  Clipboard.Clipboard,
  Geolocation.Geolocation,
  Permissions.Permissions,
  Battery.Battery,
  IdleDetection.IdleDetection,
  Fullscreen.Fullscreen,
  ScreenOrientation.ScreenOrientation,
]);

describe("browser layer", () => {
  it("builds every live service, degrading where the runtime lacks the API", async () => {
    const [
      broadcast,
      locks,
      ,
      ,
      notifications,
      ,
      wakeLock,
      ,
      ,
      ,
      battery,
      idle,
      fullscreen,
      orientation,
    ] = await Effect.runPromise(Effect.provide(everyService, browserLayer));
    expect({
      broadcast: broadcast.supported,
      locks: locks.supported,
      notifications: notifications.supported,
      wakeLock: wakeLock.supported,
      battery: battery.supported,
      idle: idle.supported,
      fullscreen: fullscreen.supported,
      orientation: orientation.supported,
    }).toStrictEqual({
      broadcast: true,
      // Node 24 ships `navigator.locks`; no Node has a wake lock.
      locks: globalThis.navigator?.locks !== undefined,
      // No Node has `Notification`.
      notifications: false,
      wakeLock: false,
      // No Node has `navigator.getBattery` or `IdleDetector`.
      battery: false,
      idle: false,
      // Node has neither a `document` nor a `screen`.
      fullscreen: false,
      orientation: false,
    });
  });
});

describe("testing layer", () => {
  it("provides every service and every Control", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const [
            ,
            locks,
            ,
            ,
            notifications,
            ,
            wakeLock,
            ,
            ,
            ,
            battery,
            idle,
            fullscreen,
            orientation,
          ] = yield* everyService;
          yield* Effect.all([
            TestBattery.Control,
            TestBroadcast.Control,
            TestClipboard.Control,
            TestFullscreen.Control,
            TestGeolocation.Control,
            TestIdleDetection.Control,
            TestMediaQuery.Control,
            TestNavigator.Control,
            TestNotifications.Control,
            TestPageVisibility.Control,
            TestPermissions.Control,
            TestScreenOrientation.Control,
            TestWakeLock.Control,
          ]);
          return {
            locks: locks.supported,
            notifications: notifications.supported,
            wakeLock: wakeLock.supported,
            battery: battery.supported,
            idle: idle.supported,
            fullscreen: fullscreen.supported,
            orientation: orientation.supported,
          };
        }),
        testLayer,
      ),
    );
    expect(result).toStrictEqual({
      locks: true,
      notifications: true,
      wakeLock: true,
      battery: true,
      idle: true,
      fullscreen: true,
      orientation: true,
    });
  });
});
