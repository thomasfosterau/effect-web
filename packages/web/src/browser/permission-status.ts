/**
 * Permission state as a stream, over `@effect/platform-browser`'s
 * `Permissions` service. Its `query` returns the browser's live
 * `PermissionStatus`; this module follows that status's `change` event, so
 * a page can react when the user grants or revokes a permission from the
 * browser's own UI — and wait for a grant without polling.
 *
 * Provide `Permissions.layer` from `@effect/platform-browser/Permissions` in
 * a browser, or `TestPermissions.layer` from
 * `@thomasfosterau/effect-web/testing` in tests.
 *
 * @since 0.2.0
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Permissions from "@effect/platform-browser/Permissions";
import { watch } from "../internal/dom.ts";

/**
 * The state of the permission `name` now: `"granted"`, `"denied"`, or
 * `"prompt"` (asking would show a prompt).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PermissionStatus } from "@thomasfosterau/effect-web/browser"
 * import { TestPermissions } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(PermissionStatus.state("geolocation"), TestPermissions.layer({ geolocation: "granted" })),
 * ).then(console.log) // "granted"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const state = (
  name: PermissionName,
): Effect.Effect<PermissionState, Permissions.PermissionsError, Permissions.Permissions> =>
  Effect.flatMap(Permissions.Permissions, (permissions) => permissions.query(name)).pipe(
    Effect.map((status) => status.state),
  );

/**
 * The state of the permission `name` as it changes: the state now, then
 * each change the browser reports. The query runs once per run of the
 * stream; its failure fails the stream.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { PermissionStatus } from "@thomasfosterau/effect-web/browser"
 * import { TestPermissions } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(PermissionStatus.changes("notifications"), 1))
 * Effect.runPromise(Effect.provide(program, TestPermissions.layer())).then(console.log) // ["prompt"]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const changes = (
  name: PermissionName,
): Stream.Stream<PermissionState, Permissions.PermissionsError, Permissions.Permissions> =>
  Stream.unwrap(
    Effect.flatMap(Permissions.Permissions, (permissions) => permissions.query(name)).pipe(
      Effect.map((status) => watch(status, ["change"], () => status.state)),
    ),
  );

/**
 * Completes once the permission `name` is granted: at once if it already
 * is, otherwise when the user grants it. A `"denied"` state does not end
 * the wait (the user can still re-grant from the browser's settings); bound
 * it with `Effect.timeout` where that matters.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PermissionStatus } from "@thomasfosterau/effect-web/browser"
 * import { TestPermissions } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.andThen(PermissionStatus.awaitGranted("camera"), Effect.succeed("ready"))
 * Effect.runPromise(
 *   Effect.provide(program, TestPermissions.layer({ camera: "granted" })),
 * ).then(console.log) // "ready"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const awaitGranted = (
  name: PermissionName,
): Effect.Effect<void, Permissions.PermissionsError, Permissions.Permissions> =>
  Stream.runHead(Stream.filter(changes(name), (now) => now === "granted")).pipe(Effect.asVoid);
