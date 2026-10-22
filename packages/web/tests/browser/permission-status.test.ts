/**
 * Unit tests for `./browser`'s `PermissionStatus` (over
 * `@effect/platform-browser`'s `Permissions`), driven through `./testing`'s
 * `TestPermissions`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { PermissionStatus } from "@thomasfosterau/effect-web/browser";
import { TestPermissions, observe } from "@thomasfosterau/effect-web/testing";

describe("PermissionStatus", () => {
  it("reads and follows a permission's state", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestPermissions.Control;
          const seen = yield* observe(PermissionStatus.changes("notifications"), 3);
          yield* control.set("notifications", "prompt");
          yield* control.set("notifications", "granted");
          yield* control.set("camera", "denied");
          yield* control.set("notifications", "denied");
          return {
            seen: yield* Fiber.join(seen),
            camera: yield* PermissionStatus.state("camera"),
            geolocation: yield* PermissionStatus.state("geolocation"),
          };
        }),
        TestPermissions.layer({ geolocation: "granted" }),
      ),
    );
    expect(result).toStrictEqual({
      seen: ["prompt", "granted", "denied"],
      camera: "denied",
      geolocation: "granted",
    });
  });

  it("waits for a grant, through a denial", async () => {
    const log = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestPermissions.Control;
          const entries: Array<string> = [];
          const fiber = yield* Effect.forkChild(
            Effect.andThen(
              PermissionStatus.awaitGranted("microphone"),
              Effect.sync(() => entries.push("granted")),
            ),
          );
          yield* control.set("microphone", "denied");
          entries.push("denied");
          yield* control.set("microphone", "granted");
          yield* Fiber.join(fiber);
          return entries;
        }),
        TestPermissions.layer(),
      ),
    );
    expect(log).toStrictEqual(["denied", "granted"]);
  });

  it("fails with the query's PermissionsError for an unknown permission", async () => {
    const error = await Effect.runPromise(
      Effect.provide(
        Effect.flip(PermissionStatus.state("midi")),
        TestPermissions.layer({}, ["midi"]),
      ),
    );
    expect(error._tag).toBe("PermissionsError");
    expect(error.reason._tag).toBe("TypeError");
  });
});
