/**
 * Unit tests for `./browser`'s `Notifications`, driven through `./testing`'s
 * `TestNotifications` (and `TestPermissions` for the permission stream).
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Notifications } from "@thomasfosterau/effect-web/browser";
import { observe, TestNotifications, TestPermissions } from "@thomasfosterau/effect-web/testing";

const run = <A, E>(
  effect: Effect.Effect<A, E, Notifications.Notifications | TestNotifications.Control>,
  options?: TestNotifications.Options,
) => Effect.runPromise(Effect.provide(effect, TestNotifications.layer(options)));

describe("Notifications.permission", () => {
  it("reads Notification.permission live, and None without the API", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestNotifications.Control;
        const before = yield* Notifications.permission;
        yield* control.setPermission("denied");
        return { before, after: yield* Notifications.permission };
      }),
    );
    expect(result).toStrictEqual({ before: Option.some("default"), after: Option.some("denied") });
    const missing = TestNotifications.make({ supported: false });
    expect(missing.notifications.supported).toBe(false);
    expect(await Effect.runPromise(missing.notifications.permission)).toStrictEqual(Option.none());
  });
});

describe("Notifications.requestPermission", () => {
  it("returns the user's answer, which becomes the permission", async () => {
    const result = await run(
      Effect.gen(function* () {
        const answer = yield* Notifications.requestPermission;
        return { answer, permission: yield* Notifications.permission };
      }),
      { answer: "denied" },
    );
    expect(result).toStrictEqual({ answer: "denied", permission: Option.some("denied") });
  });

  it("fails NotAllowed without transient user activation, without prompting", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestNotifications.Control;
        const refused = yield* Effect.flip(Notifications.requestPermission);
        yield* control.setUserActivation(true);
        const answer = yield* Notifications.requestPermission;
        return { reason: refused.reason, answer, requests: yield* control.requests };
      }),
      { userActivation: false },
    );
    expect(result).toStrictEqual({ reason: "NotAllowed", answer: "granted", requests: 1 });
  });

  it("fails Unsupported without the API, and maps a rejection", async () => {
    const missing = TestNotifications.make({ supported: false });
    const unsupported = await Effect.runPromise(
      Effect.flip(missing.notifications.requestPermission),
    );
    expect(unsupported).toMatchObject({
      _tag: "NotificationError",
      reason: "Unsupported",
      message: "notification: Unsupported",
    });
    const rejecting = Notifications.make({
      Notification: class extends EventTarget {
        static readonly permission = "default";
        static requestPermission = (): Promise<NotificationPermission> =>
          Promise.reject(new DOMException("no", "SecurityError"));
        close(): void {}
      },
    });
    const refused = await Effect.runPromise(Effect.flip(rejecting.requestPermission));
    expect(refused.reason).toBe("NotAllowed");
  });
});

describe("Notifications.show", () => {
  it("shows a notification for the scope, closing it when the scope closes", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestNotifications.Control;
        const closedDuring = yield* Effect.scoped(
          Effect.andThen(
            Notifications.show("Timer done", { body: "The rice is ready", tag: "timer" }),
            Effect.map(control.shown, (shown) => shown.map((entry) => entry.closed)),
          ),
        );
        const after = yield* control.shown;
        return {
          titles: after.map((entry) => entry.title),
          options: after[0]?.options,
          closedDuring,
          closedAfter: after.map((entry) => entry.closed),
        };
      }),
      { permission: "granted" },
    );
    expect(result).toStrictEqual({
      titles: ["Timer done"],
      options: { body: "The rice is ready", tag: "timer" },
      closedDuring: [false],
      closedAfter: [true],
    });
  });

  it("replays clicks to a late subscriber and ends the streams when closed", async () => {
    const result = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* TestNotifications.Control;
          const shown = yield* Notifications.show("New message");
          yield* control.click(0);
          const live = yield* Effect.forkChild(Stream.runCollect(shown.clicks));
          yield* control.click(0);
          yield* control.dismiss(0);
          yield* control.click(0);
          return {
            clicks: (yield* Fiber.join(live)).length,
            late: (yield* Stream.runCollect(shown.clicks)).length,
            closes: (yield* Stream.runCollect(shown.closes)).length,
          };
        }),
      ),
      { permission: "granted" },
    );
    expect(result).toStrictEqual({ clicks: 2, late: 2, closes: 1 });
  });

  it("closes early with close, and ends the streams", async () => {
    const result = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* TestNotifications.Control;
          const shown = yield* Notifications.show("Uploading");
          yield* shown.close;
          yield* shown.close;
          return {
            closes: (yield* Stream.runCollect(shown.closes)).length,
            closed: (yield* control.shown).map((entry) => entry.closed),
          };
        }),
      ),
      { permission: "granted" },
    );
    expect(result).toStrictEqual({ closes: 1, closed: [true] });
  });

  it("fails the streams with Failed when the browser cannot show it", async () => {
    const error = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* TestNotifications.Control;
          const shown = yield* Notifications.show("Reminder");
          yield* control.fail(0);
          return yield* Effect.flip(Stream.runDrain(shown.clicks));
        }),
      ),
      { permission: "granted" },
    );
    expect(error.reason).toBe("Failed");
  });

  it("fails NotAllowed before a grant and Denied after a denial, showing nothing", async () => {
    const result = await run(
      Effect.gen(function* () {
        const control = yield* TestNotifications.Control;
        const pending = yield* Effect.flip(Effect.scoped(Notifications.show("x")));
        yield* control.setPermission("denied");
        const denied = yield* Effect.flip(Effect.scoped(Notifications.show("x")));
        return { pending: pending.reason, denied: denied.reason, shown: yield* control.shown };
      }),
    );
    expect(result).toStrictEqual({ pending: "NotAllowed", denied: "Denied", shown: [] });
  });

  it("maps a constructor TypeError to InvalidData, and Unsupported without the API", async () => {
    const throwing = Notifications.make({
      Notification: class extends EventTarget {
        static readonly permission = "granted";
        static requestPermission = (): Promise<NotificationPermission> =>
          Promise.resolve("granted");
        constructor() {
          super();
          throw new TypeError("Illegal constructor");
        }
        close(): void {}
      },
    });
    const invalid = await Effect.runPromise(Effect.flip(Effect.scoped(throwing.show("x"))));
    expect(invalid.reason).toBe("InvalidData");
    const missing = TestNotifications.make({ supported: false });
    const unsupported = await Effect.runPromise(
      Effect.flip(Effect.scoped(missing.notifications.show("x"))),
    );
    expect(unsupported.reason).toBe("Unsupported");
  });
});

describe("Notifications.permissionChanges", () => {
  it("follows the notifications permission status, reading prompt as default", async () => {
    const seen = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const control = yield* TestPermissions.Control;
          const fiber = yield* observe(Notifications.permissionChanges, 2);
          yield* control.set("notifications", "granted");
          return yield* Fiber.join(fiber);
        }),
        TestPermissions.layer(),
      ),
    );
    expect(seen).toStrictEqual(["default", "granted"]);
  });
});
