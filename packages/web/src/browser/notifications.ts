/**
 * The Notifications API (`Notification`) as an Effect service: ask for
 * permission, and show a notification for the lifetime of a `Scope`.
 *
 * These are a page's own notifications: shown with the `Notification`
 * constructor, closed when their scope closes, and reporting their clicks
 * to the page that showed them. Notifications shown through a service-worker
 * registration (`registration.showNotification`) are a different contract —
 * they outlive the page, and their `notificationclick` /
 * `notificationclose` events are dispatched in the worker, not on a handle —
 * so they belong with `./service-worker`, not here.
 *
 * Permission state as it changes is {@link permissionChanges}, which follows
 * the browser's `PermissionStatus` for `"notifications"` (over
 * `@effect/platform-browser`'s `Permissions`) rather than polling
 * `Notification.permission`.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Take from "effect/Take";
import type * as Permissions from "@effect/platform-browser/Permissions";
import { reasonOf } from "../internal/dom.ts";
import { ambientNavigator, ambientNotification } from "../internal/globals.ts";
import * as PermissionStatus from "./permission-status.ts";

/**
 * The structural slice of a `Notification` instance this module uses: its
 * `click` / `close` / `error` events, and `close()`.
 *
 * @since 0.2.0
 * @category models
 */
export interface NotificationLike extends Stream.EventListener<unknown> {
  close(): void;
}

/**
 * The structural slice of the `Notification` constructor this module calls:
 * the static `permission` and `requestPermission`, and `new`.
 *
 * @since 0.2.0
 * @category models
 */
export interface NotificationConstructorLike {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): NotificationLike;
}

/**
 * Whether the page has transient user activation now (`navigator.userActivation`).
 *
 * @since 0.2.0
 * @category models
 */
export interface UserActivationLike {
  readonly isActive: boolean;
}

/**
 * What {@link make} reads: the `Notification` constructor (`undefined`
 * builds the unsupported service) and, where the agent has it,
 * `navigator.userActivation` (without it, `requestPermission` is not gated
 * on activation and the browser decides).
 *
 * @since 0.2.0
 * @category models
 */
export interface NotificationsEnvironment {
  readonly Notification: NotificationConstructorLike | undefined;
  readonly userActivation?: UserActivationLike | undefined;
}

/**
 * Why a notification call failed.
 *
 * - `Unsupported` — the agent has no `Notification` (a service worker, a
 *   server render, an old agent).
 * - `NotAllowed` — permission has not been granted yet (`show`), or the
 *   page has no transient user activation to ask with (`requestPermission`).
 * - `Denied` — the user denied permission; asking again shows no prompt.
 * - `InvalidData` — the options were refused: a `TypeError` (`renotify`
 *   without a `tag`, `silent` with `vibrate`, `actions` on a non-persistent
 *   notification) or a `data` that cannot be structured-cloned. Chrome on
 *   Android refuses the constructor itself with a `TypeError`, which reads
 *   as this too: there only a service-worker registration can show one.
 * - `Failed` — any other failure, including the browser reporting it could
 *   not show the notification (its `error` event); `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type NotificationErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "Denied"
  | "InvalidData"
  | "Failed";

/**
 * A notification call that failed. `cause` carries the browser's exception
 * or event, where there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class NotificationError extends Schema.TaggedError<NotificationError>()(
  "NotificationError",
  {
    reason: Schema.Literals(["Unsupported", "NotAllowed", "Denied", "InvalidData", "Failed"]),
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

const notificationError = (reason: NotificationErrorReason, cause: unknown) =>
  new NotificationError({ reason, cause, message: `notification: ${reason}` });

const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  TypeError: "InvalidData",
  DataCloneError: "InvalidData",
} satisfies Readonly<Record<string, NotificationErrorReason>>;

/**
 * A notification this page is showing until its scope closes — or until
 * the user or the platform closes it first.
 *
 * Every stream replays from the moment the notification was shown, so a
 * click that lands before a consumer subscribes is not lost, and each ends
 * once the notification is closed (by its scope, the user or the
 * platform). Each fails with a `Failed` {@link NotificationError} if the
 * browser reports it could not show the notification.
 *
 * @since 0.2.0
 * @category models
 */
export interface ShownNotification {
  /** Each click on the notification. */
  readonly clicks: Stream.Stream<void, NotificationError>;
  /** The close, once, then the end of the stream. */
  readonly closes: Stream.Stream<void, NotificationError>;
  /** Closes the notification now, before its scope does. */
  readonly close: Effect.Effect<void>;
}

/**
 * The notifications service. Provide {@link layer} in a page, or
 * `TestNotifications.layer` from `@thomasfosterau/effect-web/testing` in
 * tests.
 *
 * - `supported` — whether the agent has the API at all.
 * - `permission` — `Notification.permission` now; `None` where unsupported.
 * - `requestPermission` — asks the user, returning the resulting
 *   permission (`"denied"` and `"default"` are answers, not failures).
 * - `show` — shows a notification, closed when the scope closes.
 *
 * @since 0.2.0
 * @category services
 */
export class Notifications extends Context.Service<
  Notifications,
  {
    readonly supported: boolean;
    readonly permission: Effect.Effect<Option.Option<NotificationPermission>>;
    readonly requestPermission: Effect.Effect<NotificationPermission, NotificationError>;
    readonly show: (
      title: string,
      options?: NotificationOptions | undefined,
    ) => Effect.Effect<ShownNotification, NotificationError, Scope.Scope>;
  }
>()("@thomasfosterau/effect-web/browser/Notifications") {}

type Signal = Take.Take<"click" | "close", NotificationError>;

/**
 * How many events a late subscriber is replayed: clicks beyond this, before
 * anyone subscribes, are dropped oldest first. The close is always kept.
 */
const REPLAY = 64;

const unsupported: Notifications["Service"] = Notifications.of({
  supported: false,
  permission: Effect.succeed(Option.none()),
  requestPermission: Effect.fail(notificationError("Unsupported", undefined)),
  show: () => Effect.fail(notificationError("Unsupported", undefined)),
});

/**
 * Builds the {@link Notifications} service over a `Notification`
 * constructor (see {@link NotificationsEnvironment}). {@link layer} passes
 * the ambient `Notification` and `navigator.userActivation`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 *
 * const notifications = Notifications.make({ Notification: undefined })
 * Effect.runPromise(Effect.flip(notifications.requestPermission)).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (environment: NotificationsEnvironment): Notifications["Service"] => {
  const { Notification, userActivation } = environment;
  if (Notification === undefined) return unsupported;
  const show = (title: string, options?: NotificationOptions | undefined) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const permission = Notification.permission;
        if (permission !== "granted") {
          return yield* notificationError(
            permission === "denied" ? "Denied" : "NotAllowed",
            undefined,
          );
        }
        const notification = yield* Effect.try({
          try: () => new Notification(title, options),
          catch: (cause) => notificationError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
        });
        const events = yield* PubSub.unbounded<Signal>({ replay: REPLAY });
        let ended = false;
        const end = (last: Signal): void => {
          if (ended) return;
          ended = true;
          PubSub.publishUnsafe(events, last);
          notification.removeEventListener("click", onClick);
          notification.removeEventListener("close", onClose);
          notification.removeEventListener("error", onError);
        };
        const onClick = (): void => {
          if (!ended) PubSub.publishUnsafe(events, ["click"]);
        };
        const onClose = (): void => {
          if (ended) return;
          PubSub.publishUnsafe(events, ["close"]);
          end(Exit.void);
        };
        const onError = (cause: unknown): void =>
          end(Exit.fail(notificationError("Failed", cause)));
        notification.addEventListener("click", onClick);
        notification.addEventListener("close", onClose);
        notification.addEventListener("error", onError);
        const close = Effect.sync(() => {
          if (ended) return;
          notification.close();
          // The browser fires `close` only for a notification it showed; one
          // still pending is dropped silently. Either way, it is closed now.
          onClose();
        });
        return { events, close };
      }),
      ({ close }) => close,
    ).pipe(
      Effect.map(({ events, close }): ShownNotification => {
        const of = (type: "click" | "close") =>
          Stream.filter(Stream.fromPubSubTake(events), (event) => event === type).pipe(
            Stream.as(undefined),
          );
        return { clicks: of("click"), closes: of("close"), close };
      }),
    );
  return Notifications.of({
    supported: true,
    permission: Effect.sync(() => Option.some(Notification.permission)),
    requestPermission: Effect.suspend(() =>
      userActivation !== undefined && !userActivation.isActive
        ? Effect.fail(notificationError("NotAllowed", undefined))
        : Effect.tryPromise({
            try: () => Notification.requestPermission(),
            catch: (cause) =>
              notificationError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
          }),
    ),
    show,
  });
};

/**
 * The {@link Notifications} service over the ambient `Notification` and
 * `navigator.userActivation`; reports `supported: false` where there is no
 * `Notification`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.map(Notifications.Notifications, (notifications) => notifications.supported)
 * Effect.runPromise(Effect.provide(program, Notifications.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Notifications> = Layer.sync(Notifications, () =>
  make({
    Notification: ambientNotification(),
    userActivation: ambientNavigator()?.userActivation,
  }),
);

/**
 * `Notification.permission` now; `None` where the API is missing.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 * import { TestNotifications } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(Notifications.permission, TestNotifications.layer({ permission: "granted" })),
 * ).then(console.log) // { _id: "Option", _tag: "Some", value: "granted" }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const permission: Effect.Effect<
  Option.Option<NotificationPermission>,
  never,
  Notifications
> = Effect.flatMap(Notifications, (notifications) => notifications.permission);

/**
 * Asks the user for permission to show notifications, returning their
 * answer. Call it from a user gesture (a click handler): without transient
 * user activation it fails `NotAllowed` rather than letting the browser
 * ignore or penalise the request.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 * import { TestNotifications } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(Notifications.requestPermission, TestNotifications.layer({ answer: "granted" })),
 * ).then(console.log) // "granted"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const requestPermission: Effect.Effect<
  NotificationPermission,
  NotificationError,
  Notifications
> = Effect.flatMap(Notifications, (notifications) => notifications.requestPermission);

/**
 * Shows a notification, closed when the scope closes. Fails `NotAllowed`
 * before permission is granted and `Denied` once it is denied, without
 * showing anything.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 * import { TestNotifications } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const control = yield* TestNotifications.Control
 *     const shown = yield* Notifications.show("Timer done", { body: "The rice is ready" })
 *     yield* control.click(0)
 *     return yield* Stream.runHead(shown.clicks)
 *   }),
 * )
 * Effect.runPromise(
 *   Effect.provide(program, TestNotifications.layer({ permission: "granted" })),
 * ).then(console.log) // { _id: "Option", _tag: "Some" }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const show = (
  title: string,
  options?: NotificationOptions | undefined,
): Effect.Effect<ShownNotification, NotificationError, Notifications | Scope.Scope> =>
  Effect.flatMap(Notifications, (notifications) => notifications.show(title, options));

const fromPermissionState = (state: PermissionState): NotificationPermission =>
  state === "prompt" ? "default" : state;

/**
 * The notification permission as it changes: the permission now, then each
 * change the user makes (in a prompt or in the browser's settings). Follows
 * `PermissionStatus.changes("notifications")`, with the Permissions API's
 * `"prompt"` read as `Notification.permission`'s `"default"`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 * import { TestPermissions } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(Notifications.permissionChanges, 1))
 * Effect.runPromise(Effect.provide(program, TestPermissions.layer())).then(console.log) // ["default"]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const permissionChanges: Stream.Stream<
  NotificationPermission,
  Permissions.PermissionsError,
  Permissions.Permissions
> = Stream.map(PermissionStatus.changes("notifications"), fromPermissionState);
