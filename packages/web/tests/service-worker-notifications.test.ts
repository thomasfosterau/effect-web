/**
 * Unit tests for `./service-worker`'s registration notifications:
 * `showNotification`, `getNotifications` over a stub `Registration`, and
 * the `notificationclick` / `notificationclose` listeners.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  getNotifications,
  notificationClickListener,
  notificationCloseListener,
  type NotificationEventLike,
  type PersistentNotificationLike,
  Registration,
  type ServiceWorkerRegistrationLike,
  showNotification,
} from "@thomasfosterau/effect-web/service-worker";

/** An in-memory registration that records what it was asked to show. */
const stubRegistration = (
  reject?: unknown,
): ServiceWorkerRegistrationLike & { readonly shown: Array<PersistentNotificationLike> } => {
  const shown: Array<PersistentNotificationLike> = [];
  return {
    shown,
    showNotification: (title, options) => {
      if (reject !== undefined) return Promise.reject(reject);
      shown.push({
        title,
        tag: options?.tag ?? "",
        body: options?.body ?? "",
        data: options?.data ?? null,
        close: () => {
          shown.splice(
            shown.findIndex((entry) => entry.title === title),
            1,
          );
        },
      });
      return Promise.resolve();
    },
    getNotifications: (filter) =>
      Promise.resolve(
        shown.filter((entry) => filter?.tag === undefined || entry.tag === filter.tag),
      ),
  };
};

const notificationEvent = (
  data: unknown,
  pending: Array<Promise<unknown>>,
  action = "",
): NotificationEventLike => ({
  notification: { title: "t", tag: "", body: "", data, close: () => {} },
  action,
  waitUntil: (promise) => {
    pending.push(promise);
  },
});

describe("showNotification / getNotifications", () => {
  it("shows through the registration and lists by tag", async () => {
    const registration = stubRegistration();
    const titles = await Effect.runPromise(
      Effect.gen(function* () {
        yield* showNotification("Chat", { tag: "chat", body: "hi", data: { room: "general" } });
        yield* showNotification("Build", { tag: "ci" });
        const chat = yield* getNotifications({ tag: "chat" });
        const all = yield* getNotifications();
        return { chat: chat.map((entry) => entry.title), all: all.length, data: chat[0]?.data };
      }).pipe(Effect.provideService(Registration, registration)),
    );
    expect(titles).toStrictEqual({ chat: ["Chat"], all: 2, data: { room: "general" } });
  });

  it("fails Unsupported without a registration (outside a worker by default)", async () => {
    const outside = await Effect.runPromise(Effect.flip(showNotification("x")));
    expect(outside).toMatchObject({
      _tag: "ShowNotificationError",
      operation: "show",
      reason: "Unsupported",
      message: "service-worker: show notification: Unsupported",
    });
    const none = await Effect.runPromise(
      Effect.flip(getNotifications().pipe(Effect.provideService(Registration, undefined))),
    );
    expect([none.operation, none.reason]).toStrictEqual(["get", "Unsupported"]);
  });

  it.each([
    [new DOMException("no", "NotAllowedError"), "NotAllowed"],
    [new TypeError("No notification permission has been granted"), "InvalidData"],
    [new DOMException("clone", "DataCloneError"), "InvalidData"],
    [new DOMException("odd", "UnknownError"), "Failed"],
  ] as const)("maps a %s rejection to %s", async (rejection, reason) => {
    const error = await Effect.runPromise(
      Effect.flip(
        showNotification("x").pipe(
          Effect.provideService(Registration, stubRegistration(rejection)),
        ),
      ),
    );
    expect(error.reason).toBe(reason);
    expect(error.cause).toBe(rejection);
  });
});

describe("notification listeners", () => {
  const Chat = Schema.Struct({ room: Schema.String });

  it("runs a click handler on decoded data inside waitUntil, and drops the rest", async () => {
    const seen: Array<readonly [string, string]> = [];
    const onClick = Effect.runSync(
      notificationClickListener(Chat, (data, event) =>
        Effect.sync(() => seen.push([data.room, event.action ?? ""])),
      ),
    );
    const pending: Array<Promise<unknown>> = [];
    onClick(notificationEvent({ room: "general" }, pending, "reply"));
    onClick(notificationEvent({ room: 1 }, pending));
    onClick(notificationEvent(null, pending));
    await Promise.all(pending);
    expect(pending).toHaveLength(3);
    expect(seen).toStrictEqual([["general", "reply"]]);
  });

  it("rejects waitUntil when the handler fails, and runs close handlers too", async () => {
    const onClick = Effect.runSync(
      notificationClickListener(Schema.Unknown, () => Effect.fail("nope")),
    );
    const failing: Array<Promise<unknown>> = [];
    onClick(notificationEvent(1, failing));
    await expect(failing[0]).rejects.toBeDefined();

    const dismissed: Array<unknown> = [];
    const onClose = Effect.runSync(
      notificationCloseListener(Schema.Number, (data) => Effect.sync(() => dismissed.push(data))),
    );
    const pending: Array<Promise<unknown>> = [];
    onClose(notificationEvent(7, pending));
    await Promise.all(pending);
    expect(dismissed).toStrictEqual([7]);
  });

  it("shows a follow-up notification from a click, through the provided registration", async () => {
    const registration = stubRegistration();
    const onClick = Effect.runSync(
      notificationClickListener(Chat, (data) => showNotification(`Opened ${data.room}`)).pipe(
        Effect.provideService(Registration, registration),
      ),
    );
    const pending: Array<Promise<unknown>> = [];
    onClick(notificationEvent({ room: "general" }, pending));
    await Promise.all(pending);
    expect(registration.shown.map((entry) => entry.title)).toStrictEqual(["Opened general"]);
  });
});
