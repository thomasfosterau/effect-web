/**
 * `@thomasfosterau/effect-web/browser` — browser platform APIs as Effect
 * services, alongside the ones `@effect/platform-browser` already provides
 * (`Clipboard`, `Geolocation`, `Permissions`, `IndexedDb`, the
 * `localStorage`-backed `KeyValueStore`, workers and sockets).
 *
 * Each module is one service with the same shape: a `Context.Service` tag, a
 * `make` over a structural `*Like` slice of the platform object (so a test
 * hands in a double and a worker hands in its own global), a live `layer`
 * that reads the ambient global when it is built — never at import — and
 * degrades where the API is missing, a tagged error whose `reason` maps the
 * platform's `DOMException` names, and accessors. `layer` provides every
 * live service at once.
 *
 * - `Locks` — Web Locks: a named, origin-wide lock held for a `Scope`.
 * - `Navigator` — connectivity, languages, network information, user
 *   activation, Web Share, `sendBeacon`, vibration, storage persistence.
 * - `PageVisibility` — `visibilitychange`, and running work only while
 *   visible.
 * - `MediaQuery` — `matchMedia` as values and streams; user preferences.
 * - `WakeLock` — the Screen Wake Lock, held for a `Scope`.
 * - `Broadcast` — `BroadcastChannel`, schema-typed.
 * - `IdleDetection` — user idleness and screen lock, as a stream
 *   (Chromium-only, behind a permission).
 * - `Battery` — the battery's charge and charging state (Chromium-only).
 * - `Fullscreen` — an element shown fullscreen for a `Scope`.
 * - `ScreenOrientation` — the orientation as values and a stream, and a
 *   lock held for a `Scope`.
 * - `Notifications` — a page's own notifications, shown for a `Scope`.
 * - `PermissionStatus` — permission state as a stream, over
 *   `@effect/platform-browser`'s `Permissions`.
 *
 * Test doubles for every service live in `@thomasfosterau/effect-web/testing`.
 *
 * Requires the optional peer `@effect/platform-browser`.
 *
 * @since 0.2.0
 */
export * as Battery from "./battery.ts";
export * as Broadcast from "./broadcast.ts";
export * as Fullscreen from "./fullscreen.ts";
export * as IdleDetection from "./idle-detection.ts";
export { layer } from "./layer.ts";
export * as Locks from "./locks.ts";
export * as MediaQuery from "./media-query.ts";
export * as Navigator from "./navigator.ts";
export * as Notifications from "./notifications.ts";
export * as PageVisibility from "./page-visibility.ts";
export * as PermissionStatus from "./permission-status.ts";
export * as ScreenOrientation from "./screen-orientation.ts";
export * as WakeLock from "./wake-lock.ts";
