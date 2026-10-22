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
  Broadcast,
  layer as browserLayer,
  Locks,
  MediaQuery,
  Navigator,
  PageVisibility,
  WakeLock,
} from "@thomasfosterau/effect-web/browser";
import {
  layer as testLayer,
  TestBroadcast,
  TestClipboard,
  TestGeolocation,
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
]);

describe("browser layer", () => {
  it("builds every live service, degrading where the runtime lacks the API", async () => {
    const [broadcast, locks, , , , wakeLock] = await Effect.runPromise(
      Effect.provide(everyService, browserLayer),
    );
    expect({
      broadcast: broadcast.supported,
      locks: locks.supported,
      wakeLock: wakeLock.supported,
    }).toStrictEqual({
      broadcast: true,
      // Node 24 ships `navigator.locks`; no Node has a wake lock.
      locks: globalThis.navigator?.locks !== undefined,
      wakeLock: false,
    });
  });
});

describe("testing layer", () => {
  it("provides every service and every Control", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const [, locks, , , , wakeLock] = yield* everyService;
          yield* Effect.all([
            TestBroadcast.Control,
            TestClipboard.Control,
            TestGeolocation.Control,
            TestMediaQuery.Control,
            TestNavigator.Control,
            TestPageVisibility.Control,
            TestPermissions.Control,
            TestWakeLock.Control,
          ]);
          return { locks: locks.supported, wakeLock: wakeLock.supported };
        }),
        testLayer,
      ),
    );
    expect(result).toStrictEqual({ locks: true, wakeLock: true });
  });
});
