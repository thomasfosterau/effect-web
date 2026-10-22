/**
 * `@thomasfosterau/effect-web/testing` — in-memory doubles for every
 * `@thomasfosterau/effect-web/browser` service and for the
 * `@effect/platform-browser` `Clipboard`, `Geolocation` and `Permissions`
 * services, runnable under Node with no DOM.
 *
 * Each module has the same shape: `make` builds the double — the real
 * adapter over an in-memory platform object, so a test exercises the code
 * that runs in the browser — together with its `Control` service, which
 * drives the platform (go offline, hide the page, steal a lock) through the
 * events the browser would fire, and reads back what the code under test
 * asked of it (beacons, shares, posted messages). `layer` provides both.
 * The top-level `layer` provides every double at once, and `observe`
 * subscribes to a change stream before a test drives the change.
 *
 * - `TestLocks` — a lock manager following the Web Locks request algorithm;
 *   share one between layers to model several tabs.
 * - `TestNavigator`, `TestPageVisibility`, `TestMediaQuery`, `TestWakeLock`,
 *   `TestBroadcast`, `TestIdleDetection`, `TestBattery`, `TestFullscreen`,
 *   `TestScreenOrientation` — the `./browser` services.
 * - `TestPermissions`, `TestClipboard`, `TestGeolocation` — the
 *   `@effect/platform-browser` services.
 *
 * Requires the optional peer `@effect/platform-browser`.
 *
 * @since 0.2.0
 */
export { layer } from "./layer.ts";
export { observe } from "./stream.ts";
export * as TestBattery from "./battery.ts";
export * as TestBroadcast from "./broadcast.ts";
export * as TestClipboard from "./clipboard.ts";
export * as TestFullscreen from "./fullscreen.ts";
export * as TestGeolocation from "./geolocation.ts";
export * as TestIdleDetection from "./idle-detection.ts";
export * as TestLocks from "./locks.ts";
export * as TestMediaQuery from "./media-query.ts";
export * as TestNavigator from "./navigator.ts";
export * as TestPageVisibility from "./page-visibility.ts";
export * as TestPermissions from "./permissions.ts";
export * as TestScreenOrientation from "./screen-orientation.ts";
export * as TestWakeLock from "./wake-lock.ts";
