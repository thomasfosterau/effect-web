/**
 * Every live `./browser` service in one layer, together with the
 * `@effect/platform-browser` services they sit beside.
 *
 * @since 0.2.0
 */
import * as Clipboard from "@effect/platform-browser/Clipboard";
import * as Geolocation from "@effect/platform-browser/Geolocation";
import * as Permissions from "@effect/platform-browser/Permissions";
import * as Layer from "effect/Layer";
import * as Broadcast from "./broadcast.ts";
import * as Locks from "./locks.ts";
import * as MediaQuery from "./media-query.ts";
import * as Navigator from "./navigator.ts";
import * as PageVisibility from "./page-visibility.ts";
import * as WakeLock from "./wake-lock.ts";

/**
 * Every live service this entry defines (`Broadcast`, `Locks`,
 * `MediaQuery`, `Navigator`, `PageVisibility`, `WakeLock`) and the
 * `@effect/platform-browser` `Clipboard`, `Geolocation` and `Permissions`
 * services, over the ambient globals. Each degrades where its API is
 * missing, so the layer builds in any context — but provide only the
 * services a program uses where bundle size matters: this layer keeps
 * every adapter in the bundle.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks, Navigator, layer } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.gen(function* () {
 *   const locks = yield* Locks.Locks
 *   const online = yield* Navigator.onLine
 *   return { locks: locks.supported, online }
 * })
 * Effect.runPromise(Effect.provide(program, layer)).then(console.log)
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<
  | Broadcast.Broadcast
  | Locks.Locks
  | MediaQuery.MediaQuery
  | Navigator.Navigator
  | PageVisibility.PageVisibility
  | WakeLock.WakeLock
  | Clipboard.Clipboard
  | Geolocation.Geolocation
  | Permissions.Permissions
> = Layer.mergeAll(
  Broadcast.layer,
  Locks.layer,
  MediaQuery.layer,
  Navigator.layer,
  PageVisibility.layer,
  WakeLock.layer,
  Clipboard.layer,
  Geolocation.layer,
  Permissions.layer,
);
