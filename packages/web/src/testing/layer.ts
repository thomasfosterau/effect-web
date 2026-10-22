/**
 * Every `./testing` double in one layer.
 *
 * @since 0.2.0
 */
import * as Layer from "effect/Layer";
import * as TestBattery from "./battery.ts";
import * as TestBroadcast from "./broadcast.ts";
import * as TestClipboard from "./clipboard.ts";
import * as TestFullscreen from "./fullscreen.ts";
import * as TestGeolocation from "./geolocation.ts";
import * as TestIdleDetection from "./idle-detection.ts";
import * as TestLocks from "./locks.ts";
import * as TestMediaQuery from "./media-query.ts";
import * as TestNavigator from "./navigator.ts";
import * as TestPageVisibility from "./page-visibility.ts";
import * as TestPermissions from "./permissions.ts";
import * as TestScreenOrientation from "./screen-orientation.ts";
import * as TestWakeLock from "./wake-lock.ts";

/**
 * Every service `layer` from `@thomasfosterau/effect-web/browser` provides,
 * each over a fresh in-memory double in its default state, together with
 * every double's `Control`. The test counterpart of that layer: provide it
 * once, then reach for a `Control` (`TestNavigator.Control`, …) to drive
 * the platform.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator, layer } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestNavigator.Control
 *   yield* control.setOnLine(false)
 *   return yield* Navigator.onLine
 * })
 * Effect.runPromise(Effect.provide(program, layer)).then(console.log) // false
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = Layer.mergeAll(
  TestBattery.layer(),
  TestBroadcast.layer,
  TestClipboard.layer(),
  TestFullscreen.layer(),
  TestGeolocation.layer(),
  TestIdleDetection.layer(),
  TestLocks.layer(),
  TestMediaQuery.layer(),
  TestNavigator.layer(),
  TestPageVisibility.layer(),
  TestPermissions.layer(),
  TestScreenOrientation.layer(),
  TestWakeLock.layer(),
);
