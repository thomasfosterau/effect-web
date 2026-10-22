/**
 * Type-level tests for the `./browser` and `./testing` entries: the
 * expect-error directives are the assertions, checked by tsconfig.test.json
 * (which resolves the package names to `src/`). Every binding is exported so
 * an unused-local error can never stand in for the assertion a directive
 * expects.
 */
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import {
  Battery,
  Broadcast,
  Fullscreen,
  IdleDetection,
  Locks,
  Navigator,
  Notifications,
  PageVisibility,
  ScreenOrientation,
  WakeLock,
} from "@thomasfosterau/effect-web/browser";
import { observe } from "@thomasfosterau/effect-web/testing";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

declare const work: Effect.Effect<number, "WorkFailed", "WorkService">;

// `withLock` adds the lock's failure and the service, and nothing else.
export const locked = Locks.withLock(work, "job");
// `withLockIfAvailable` reports whether the effect ran.
export const maybe = Locks.withLockIfAvailable(work, "job");
// Acquisition is scoped: the lock lives exactly as long as its scope.
export type AcquireServices = Effect.Services<ReturnType<Locks.Locks["Service"]["acquire"]>>;

// A lock error's reason is the closed union.
export const lockError = new Locks.LockError({
  lock: Option.none(),
  // @ts-expect-error -- not a lock error reason
  reason: "Timeout",
  message: "",
  cause: undefined,
});

// The re-acquiring wake lock never fails the work over a lock it could not get.
export const awake = WakeLock.keepAwakeWhileVisible(work);
// The strict one does.
export const strict = WakeLock.keepAwake(work);
// Work gated on visibility never completes on its own.
export const gated = PageVisibility.whileVisible(work);

// A typed channel publishes and receives the schema's type only.
const Ping = Schema.Struct({ at: Schema.Number });
export const channel = Broadcast.channel("sync", Ping);
export type ChannelValue =
  Effect.Success<typeof channel> extends Broadcast.Channel<infer A> ? A : never;
export declare const open: Broadcast.Channel<{ readonly at: number }>;
// @ts-expect-error -- not the schema's type
export const wrong = open.publish({ at: "now" });

// The idle stream carries its error and nothing else.
export const idle = IdleDetection.watch({ threshold: "1 minute" });
// @ts-expect-error -- a threshold is a Duration input, not any string
export const unparsed = IdleDetection.watch({ threshold: "soon" });
// Battery times are optional durations.
export type DischargingTime = Option.Option.Value<
  Effect.Success<Battery.Battery["Service"]["status"]>
>["dischargingTime"];
// Fullscreen adds its failure and the service, in either argument order.
export declare const video: Fullscreen.FullscreenElementLike;
export const fullscreened = work.pipe(Fullscreen.withFullscreen(video));
export const fullscreenedDirect = Fullscreen.withFullscreen(work, video);
// An orientation lock adds its failure and the service, and composes inside fullscreen.
export const landscape = work.pipe(
  ScreenOrientation.withLock("landscape"),
  Fullscreen.withFullscreen(video),
);
// @ts-expect-error -- not an orientation lock type
export const sideways = ScreenOrientation.withLock(work, "sideways");
export type OrientationLockServices = Effect.Services<
  ReturnType<ScreenOrientation.ScreenOrientation["Service"]["lock"]>
>;

// A notification is shown for a scope.
export const shown = Notifications.show("Saved");
// A notification error's reason is the closed union.
export const notificationError = new Notifications.NotificationError({
  // @ts-expect-error -- not a notification error reason
  reason: "Blocked",
  message: "",
  cause: undefined,
});

// Navigator readings that may be absent are Options, never `undefined`.
export type Connection = Effect.Success<Navigator.Navigator["Service"]["connection"]>;

// `observe` hands back the collecting fiber, with the stream's error.
export const observed = observe(Navigator.onLineChanges, 2);

export type BrowserChecks = [
  /** _withLockAddsLockErrorAndService */ Assert<
    Equals<
      typeof locked,
      Effect.Effect<number, "WorkFailed" | Locks.LockError, "WorkService" | Locks.Locks>
    >
  >,
  /** _withLockIfAvailableIsOptional */ Assert<
    Equals<Effect.Success<typeof maybe>, Option.Option<number>>
  >,
  /** _acquireIsScoped */ Assert<Equals<AcquireServices, Scope.Scope>>,
  /** _keepAwakeWhileVisibleKeepsTheWorksError */ Assert<
    Equals<Effect.Error<typeof awake>, "WorkFailed">
  >,
  /** _keepAwakeAddsWakeLockError */ Assert<
    Equals<Effect.Error<typeof strict>, "WorkFailed" | WakeLock.WakeLockError>
  >,
  /** _whileVisibleNeverSucceeds */ Assert<Equals<Effect.Success<typeof gated>, never>>,
  /** _channelCarriesTheSchemaType */ Assert<Equals<ChannelValue, { readonly at: number }>>,
  /** _connectionIsOption */ Assert<Equals<Connection, Option.Option<Navigator.ConnectionInfo>>>,
  /** _observeReturnsTheFiber */ Assert<
    Equals<Effect.Success<typeof observed>, Fiber.Fiber<ReadonlyArray<boolean>, never>>
  >,
  /** _idleStreamCarriesIdleError */ Assert<
    Equals<
      typeof idle,
      Stream.Stream<IdleDetection.IdleState, IdleDetection.IdleError, IdleDetection.IdleDetection>
    >
  >,
  /** _batteryTimesAreOptionalDurations */ Assert<
    Equals<DischargingTime, Option.Option<Duration.Duration>>
  >,
  /** _withFullscreenAddsFullscreenErrorAndService */ Assert<
    Equals<
      typeof fullscreened,
      Effect.Effect<
        number,
        "WorkFailed" | Fullscreen.FullscreenError,
        "WorkService" | Fullscreen.Fullscreen
      >
    >
  >,
  /** _withFullscreenIsDual */ Assert<Equals<typeof fullscreenedDirect, typeof fullscreened>>,
  /** _lockInsideFullscreen */ Assert<
    Equals<
      Effect.Error<typeof landscape>,
      "WorkFailed" | ScreenOrientation.OrientationError | Fullscreen.FullscreenError
    >
  >,
  /** _orientationLockIsScoped */ Assert<Equals<OrientationLockServices, Scope.Scope>>,
  /** _showIsScoped */ Assert<
    Equals<Effect.Services<typeof shown>, Notifications.Notifications | Scope.Scope>
  >,
  /** _notificationStreamsCarryTheError */ Assert<
    Equals<Stream.Error<Effect.Success<typeof shown>["clicks"]>, Notifications.NotificationError>
  >,
  /** _streamsAreServiceFree */ Assert<
    Equals<Stream.Services<Navigator.Navigator["Service"]["onLineChanges"]>, never>
  >,
];
