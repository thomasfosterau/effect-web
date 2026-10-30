/**
 * The Screen Orientation API (`screen.orientation`) as an Effect service:
 * read the orientation, follow its changes, and lock it for the lifetime of
 * a `Scope`.
 *
 * Browsers grant a lock only in narrow conditions: while the document is
 * fullscreen, in an installed web app, or on certain (mobile) platforms;
 * desktop browsers and Safari refuse it outright. So a lock is almost
 * always taken inside fullscreen, which composes by piping:
 * `effect.pipe(ScreenOrientation.withLock("landscape"),
 * Fullscreen.withFullscreen(video))` enters fullscreen first, then locks,
 * and releases both in reverse.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { reasonOf, watch } from "../internal/dom.ts";
import { ambientScreenOrientation } from "../internal/globals.ts";

/**
 * The structural slice of `screen.orientation` this module uses. `lock` is
 * optional: Safari ships the readings without it.
 *
 * @since 0.2.0
 * @category models
 */
export interface ScreenOrientationLike extends Stream.EventListener {
  readonly type: OrientationType;
  readonly angle: number;
  lock?(orientation: OrientationLockType): Promise<void>;
  unlock(): void;
}

/**
 * An orientation reading: the `type` (`"portrait-primary"`, …) and the
 * `angle`, in degrees, the screen is rotated from its natural orientation.
 *
 * @since 0.2.0
 * @category models
 */
export interface Orientation {
  readonly type: OrientationType;
  readonly angle: number;
}

/**
 * Why an orientation lock was not taken.
 *
 * - `Unsupported` — the agent has no `screen.orientation` or no `lock`, or
 *   refused with `NotSupportedError`: this context may not lock (not
 *   fullscreen, not an installed app, or a platform that never locks).
 * - `NotAllowed` — refused with `SecurityError`: the document is hidden or
 *   sandboxed.
 * - `Aborted` — a newer lock request superseded this one before it took
 *   effect.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type OrientationErrorReason = "Unsupported" | "NotAllowed" | "Aborted" | "Failed";

/**
 * An orientation lock that was not taken. `cause` carries the browser's
 * rejection, where there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class OrientationError extends Schema.TaggedError<OrientationError>()("OrientationError", {
  reason: Schema.Literals(["Unsupported", "NotAllowed", "Aborted", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const orientationError = (reason: OrientationErrorReason, cause: unknown) =>
  new OrientationError({ reason, cause, message: `screen orientation: ${reason}` });

const REJECTION_REASONS = {
  NotSupportedError: "Unsupported",
  SecurityError: "NotAllowed",
  AbortError: "Aborted",
} satisfies Readonly<Record<string, OrientationErrorReason>>;

/**
 * The screen-orientation service. Provide {@link layer} in a page, or
 * `TestScreenOrientation.layer` from `@thomasfosterau/effect-web/testing`
 * in tests.
 *
 * - `supported` — whether the agent has `screen.orientation` at all (a
 *   lock may still be refused).
 * - `type`, `angle` — the orientation now; `None` where unsupported.
 * - `changes` — the orientation now, then each change; empty where
 *   unsupported.
 * - `lock` — locks the orientation until the scope closes.
 *
 * @since 0.2.0
 * @category services
 */
export class ScreenOrientation extends Context.Service<
  ScreenOrientation,
  {
    readonly supported: boolean;
    readonly type: Effect.Effect<Option.Option<OrientationType>>;
    readonly angle: Effect.Effect<Option.Option<number>>;
    readonly changes: Stream.Stream<Orientation>;
    readonly lock: (
      orientation: OrientationLockType,
    ) => Effect.Effect<void, OrientationError, Scope.Scope>;
  }
>()("@thomasfosterau/effect-web/browser/ScreenOrientation") {}

const sameOrientation = (self: Orientation, that: Orientation): boolean =>
  self.type === that.type && self.angle === that.angle;

/**
 * Builds the {@link ScreenOrientation} service over `screen.orientation`;
 * `undefined` builds the unsupported service. {@link layer} passes the
 * ambient one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { ScreenOrientation } from "@thomasfosterau/effect-web/browser"
 *
 * const orientation = ScreenOrientation.make(undefined)
 * Effect.runPromise(Effect.flip(Effect.scoped(orientation.lock("landscape")))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (
  orientation: ScreenOrientationLike | undefined,
): ScreenOrientation["Service"] => {
  if (orientation === undefined) {
    return ScreenOrientation.of({
      supported: false,
      type: Effect.succeed(Option.none()),
      angle: Effect.succeed(Option.none()),
      changes: Stream.empty,
      lock: () => Effect.fail(orientationError("Unsupported", undefined)),
    });
  }
  const read = (): Orientation => ({ type: orientation.type, angle: orientation.angle });
  return ScreenOrientation.of({
    supported: true,
    type: Effect.sync(() => Option.some(orientation.type)),
    angle: Effect.sync(() => Option.some(orientation.angle)),
    changes: watch(orientation, ["change"], read, sameOrientation),
    lock: (type) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          const lock = orientation.lock?.bind(orientation);
          return lock === undefined
            ? Effect.fail(orientationError("Unsupported", undefined))
            : Effect.tryPromise({
                try: () => lock(type),
                catch: (cause) =>
                  orientationError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
              });
        }),
        // `unlock` is synchronous and reports nothing: the document's lock
        // is gone once it returns.
        () => Effect.sync(() => orientation.unlock()),
      ),
  });
};

/**
 * The {@link ScreenOrientation} service over the ambient
 * `screen.orientation`; reports `supported: false` where there is none
 * (Node, a worker, older Safari).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { ScreenOrientation } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.map(ScreenOrientation.ScreenOrientation, (orientation) => orientation.supported)
 * Effect.runPromise(Effect.provide(program, ScreenOrientation.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<ScreenOrientation> = Layer.sync(ScreenOrientation, () =>
  make(ambientScreenOrientation()),
);

/**
 * The orientation now; `None` where the API is missing.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { ScreenOrientation } from "@thomasfosterau/effect-web/browser"
 * import { TestScreenOrientation } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(ScreenOrientation.current, TestScreenOrientation.layer()),
 * ).then(console.log) // { _id: "Option", _tag: "Some", value: { type: "portrait-primary", angle: 0 } }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const current: Effect.Effect<
  Option.Option<Orientation>,
  never,
  ScreenOrientation
> = Effect.flatMap(ScreenOrientation, (orientation) =>
  Effect.map(
    Effect.all([orientation.type, orientation.angle], { concurrency: 1 }),
    ([type, angle]) => Option.zipWith(type, angle, (type, angle) => ({ type, angle })),
  ),
);

/**
 * The orientation now, then each change (the `change` event); empty where
 * the API is missing.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { ScreenOrientation } from "@thomasfosterau/effect-web/browser"
 * import { TestScreenOrientation } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(ScreenOrientation.changes, 1))
 * Effect.runPromise(Effect.provide(program, TestScreenOrientation.layer())).then(console.log)
 * // [{ type: "portrait-primary", angle: 0 }]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const changes: Stream.Stream<Orientation, never, ScreenOrientation> = Stream.unwrap(
  Effect.map(ScreenOrientation, (orientation) => orientation.changes),
);

/**
 * Runs `self` with the orientation locked to `orientation`, unlocking
 * however `self` ends. Fails with the {@link OrientationError} when the
 * lock is refused, without running `self`. Take it inside
 * `Fullscreen.withFullscreen` where the browser only locks in fullscreen.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { ScreenOrientation } from "@thomasfosterau/effect-web/browser"
 * import { TestScreenOrientation } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestScreenOrientation.Control
 *   return yield* control.locked.pipe(ScreenOrientation.withLock("landscape"))
 * })
 * Effect.runPromise(Effect.provide(program, TestScreenOrientation.layer())).then(console.log)
 * // { _id: "Option", _tag: "Some", value: "landscape" }
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const withLock: {
  (
    orientation: OrientationLockType,
  ): <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | OrientationError, R | ScreenOrientation>;
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    orientation: OrientationLockType,
  ): Effect.Effect<A, E | OrientationError, R | ScreenOrientation>;
} = dual(
  2,
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    orientation: OrientationLockType,
  ): Effect.Effect<A, E | OrientationError, R | ScreenOrientation> =>
    Effect.flatMap(ScreenOrientation, (service) =>
      Effect.scopedWith((scope) =>
        Effect.andThen(Scope.provide(service.lock(orientation), scope), self),
      ),
    ),
);
