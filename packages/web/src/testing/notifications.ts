/**
 * A controllable Notifications API for tests of code that uses
 * `./browser`'s `Notifications`: {@link layer} provides the real adapter
 * over an in-memory `Notification` constructor, plus {@link Control} to
 * grant or deny permission, answer a permission prompt, read back the
 * notifications shown, and click, dismiss or fail one as the browser would.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  make as makeNotifications,
  Notifications,
  type NotificationConstructorLike,
  type NotificationLike,
} from "../browser/notifications.ts";

/**
 * The in-memory API's starting behaviour.
 *
 * - `supported` (default `true`) — builds the unsupported service when `false`.
 * - `permission` (default `"default"`) — `Notification.permission`.
 * - `answer` (default `"granted"`) — what a permission prompt resolves to;
 *   the answer becomes the permission, as it does in the browser.
 * - `userActivation` — whether the page has transient user activation;
 *   omitted, the adapter is given no `navigator.userActivation` and never
 *   gates a request on it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean | undefined;
  readonly permission?: NotificationPermission | undefined;
  readonly answer?: NotificationPermission | undefined;
  readonly userActivation?: boolean | undefined;
}

/**
 * One notification the code under test constructed, in order; `closed`
 * reads live.
 *
 * @since 0.2.0
 * @category models
 */
export interface Shown {
  readonly title: string;
  readonly options: NotificationOptions | undefined;
  readonly closed: boolean;
}

/**
 * Drives the in-memory API.
 *
 * - `shown` — every notification constructed so far, closed ones included.
 * - `requests` — how many permission prompts were shown.
 * - `setPermission` — grant, deny or reset permission from outside a
 *   prompt (the browser's settings).
 * - `setAnswer` — what the next prompts resolve to.
 * - `setUserActivation` — whether the page has transient user activation.
 * - `click`, `dismiss`, `fail` — fire `click`, `close` (the user dismissed
 *   it) or `error` (the platform could not show it) on the `index`th
 *   notification shown; a no-op once it is closed.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly shown: Effect.Effect<ReadonlyArray<Shown>>;
    readonly requests: Effect.Effect<number>;
    readonly setPermission: (permission: NotificationPermission) => Effect.Effect<void>;
    readonly setAnswer: (answer: NotificationPermission) => Effect.Effect<void>;
    readonly setUserActivation: (active: boolean) => Effect.Effect<void>;
    readonly click: (index: number) => Effect.Effect<void>;
    readonly dismiss: (index: number) => Effect.Effect<void>;
    readonly fail: (index: number) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/NotificationsControl") {}

/**
 * What {@link make} builds: the `Notifications` service over the in-memory
 * `Notification`, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly notifications: Notifications["Service"];
  readonly control: Control["Service"];
}

interface State {
  permission: NotificationPermission;
  answer: NotificationPermission;
  active: boolean;
  requests: number;
}

/** An in-memory notification: `closed` is set by `close` (or a dismissal), never reset. */
class TestNotification extends EventTarget implements NotificationLike, Shown {
  readonly title: string;
  readonly options: NotificationOptions | undefined;
  closed = false;
  constructor(title: string, options: NotificationOptions | undefined) {
    super();
    this.title = title;
    this.options = options;
  }
  close(): void {
    this.fire("close");
  }
  /** Dispatches `type`; a `close` closes it, and nothing fires once closed. */
  fire(type: "click" | "close" | "error"): void {
    if (this.closed) return;
    if (type === "close") this.closed = true;
    this.dispatchEvent(new Event(type));
  }
}

/** The user-activation reading, live. */
class UserActivation {
  readonly #state: State;
  constructor(state: State) {
    this.#state = state;
  }
  get isActive(): boolean {
    return this.#state.active;
  }
}

/**
 * Builds an in-memory `Notification`: the `Notifications` service over it,
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestNotifications } from "@thomasfosterau/effect-web/testing"
 *
 * const { notifications, control } = TestNotifications.make({ permission: "granted" })
 * const program = Effect.scoped(Effect.andThen(notifications.show("Saved"), control.shown))
 * Effect.runPromise(program).then((shown) => console.log(shown.map((entry) => entry.title))) // ["Saved"]
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options | undefined): Fixture => {
  const state: State = {
    permission: options?.permission ?? "default",
    answer: options?.answer ?? "granted",
    active: options?.userActivation ?? true,
    requests: 0,
  };
  const shown: Array<TestNotification> = [];
  const Notification: NotificationConstructorLike = class extends TestNotification {
    static get permission(): NotificationPermission {
      return state.permission;
    }
    static requestPermission(): Promise<NotificationPermission> {
      state.requests += 1;
      // An answer other than "default" is remembered; dismissing the prompt is not.
      if (state.permission === "default") state.permission = state.answer;
      return Promise.resolve(state.permission);
    }
    constructor(title: string, init?: NotificationOptions) {
      super(title, init);
      shown.push(this);
    }
  };
  const fire = (index: number, type: "click" | "close" | "error") =>
    Effect.sync(() => shown[index]?.fire(type));
  return {
    notifications: makeNotifications({
      Notification: options?.supported === false ? undefined : Notification,
      userActivation: options?.userActivation === undefined ? undefined : new UserActivation(state),
    }),
    control: Control.of({
      shown: Effect.sync(() => [...shown]),
      requests: Effect.sync(() => state.requests),
      setPermission: (permission) =>
        Effect.sync(() => {
          state.permission = permission;
        }),
      setAnswer: (answer) =>
        Effect.sync(() => {
          state.answer = answer;
        }),
      setUserActivation: (active) =>
        Effect.sync(() => {
          state.active = active;
        }),
      click: (index) => fire(index, "click"),
      dismiss: (index) => fire(index, "close"),
      fail: (index) => fire(index, "error"),
    }),
  };
};

/**
 * Provides `Notifications` over a fresh in-memory `Notification`, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Notifications } from "@thomasfosterau/effect-web/browser"
 * import { TestNotifications } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.andThen(
 *   Notifications.requestPermission,
 *   Notifications.permission,
 * )
 * Effect.runPromise(Effect.provide(program, TestNotifications.layer())).then(console.log)
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options | undefined): Layer.Layer<Notifications | Control> =>
  Layer.syncContext(() => {
    const { notifications, control } = make(options);
    return Context.make(Notifications, notifications).pipe(Context.add(Control, control));
  });
