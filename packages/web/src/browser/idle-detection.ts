/**
 * The Idle Detection API (`IdleDetector`) as an Effect service: whether the
 * user is active and whether the screen is locked, as a stream.
 *
 * The API is Chromium-only and behind a permission the user must grant, so
 * treat it as optional: `supported: false` is the common case (Firefox,
 * Safari, a server render), and even where it is supported a page must ask
 * for permission from a user gesture before {@link watch} reports anything.
 * Code that only needs "is this tab in front of the user" wants
 * `PageVisibility` instead.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { reasonOf } from "../internal/dom.ts";
import { ambientIdleDetector } from "../internal/globals.ts";

/**
 * The structural slice of an `IdleDetector` instance this module uses. Both
 * states are `null` until `start` has resolved.
 *
 * @since 0.2.0
 * @category models
 */
export interface IdleDetectorInstanceLike extends Stream.EventListener<unknown> {
  readonly userState: "active" | "idle" | null;
  readonly screenState: "locked" | "unlocked" | null;
  start(options: { readonly threshold: number; readonly signal: AbortSignal }): Promise<void>;
}

/**
 * The structural slice of the `IdleDetector` constructor this module calls:
 * the static `requestPermission`, and `new`.
 *
 * @since 0.2.0
 * @category models
 */
export interface IdleDetectorLike {
  requestPermission(): Promise<"granted" | "denied">;
  new (): IdleDetectorInstanceLike;
}

/**
 * What the detector reports: whether the user has interacted with the
 * device within the threshold, and whether the screen is locked.
 *
 * @since 0.2.0
 * @category models
 */
export interface IdleState {
  readonly user: "active" | "idle";
  readonly screen: "locked" | "unlocked";
}

/**
 * The shortest threshold the API accepts: one minute.
 *
 * @since 0.2.0
 * @category models
 */
export const minimumThreshold: Duration.Duration = Duration.minutes(1);

/**
 * Why idle detection failed.
 *
 * - `Unsupported` — the agent has no `IdleDetector`.
 * - `NotAllowed` — the permission is not granted (`watch`), or the page has
 *   no transient user activation to ask with (`requestPermission`).
 * - `InvalidRequest` — a threshold under {@link minimumThreshold}.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type IdleErrorReason = "Unsupported" | "NotAllowed" | "InvalidRequest" | "Failed";

/**
 * An idle-detection call that failed. `cause` carries the browser's
 * rejection, where there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class IdleError extends Schema.TaggedError<IdleError>()("IdleError", {
  reason: Schema.Literals(["Unsupported", "NotAllowed", "InvalidRequest", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const idleError = (reason: IdleErrorReason, cause: unknown) =>
  new IdleError({ reason, cause, message: `idle detection: ${reason}` });

const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  TypeError: "InvalidRequest",
} satisfies Readonly<Record<string, IdleErrorReason>>;

/**
 * What {@link watch} takes: the `threshold` of inactivity after which the
 * user counts as idle, at least {@link minimumThreshold}.
 *
 * @since 0.2.0
 * @category models
 */
export interface WatchOptions {
  readonly threshold: Duration.Input;
}

/**
 * The idle-detection service. Provide {@link layer} in a page, or
 * `TestIdleDetection.layer` from `@thomasfosterau/effect-web/testing` in
 * tests.
 *
 * - `supported` — whether the agent has `IdleDetector` at all.
 * - `requestPermission` — asks the user (from a user gesture), returning
 *   their answer.
 * - `watch` — the idle state now, then each change, for as long as the
 *   stream runs; the detector stops when the stream ends or is
 *   interrupted.
 *
 * @since 0.2.0
 * @category services
 */
export class IdleDetection extends Context.Service<
  IdleDetection,
  {
    readonly supported: boolean;
    readonly requestPermission: Effect.Effect<"granted" | "denied", IdleError>;
    readonly watch: (options: WatchOptions) => Stream.Stream<IdleState, IdleError>;
  }
>()("@thomasfosterau/effect-web/browser/IdleDetection") {}

const sameState = (self: IdleState, that: IdleState): boolean =>
  self.user === that.user && self.screen === that.screen;

const unsupported = (): IdleDetection["Service"] =>
  IdleDetection.of({
    supported: false,
    requestPermission: Effect.fail(idleError("Unsupported", undefined)),
    watch: () => Stream.fail(idleError("Unsupported", undefined)),
  });

/**
 * Builds the {@link IdleDetection} service over an `IdleDetector`
 * constructor; `undefined` builds the unsupported service. {@link layer}
 * passes the ambient one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { IdleDetection } from "@thomasfosterau/effect-web/browser"
 *
 * const idle = IdleDetection.make(undefined)
 * Effect.runPromise(Effect.flip(Stream.runDrain(idle.watch({ threshold: "1 minute" })))).then(
 *   (error) => console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (IdleDetector: IdleDetectorLike | undefined): IdleDetection["Service"] => {
  if (IdleDetector === undefined) return unsupported();
  const watch = (options: WatchOptions): Stream.Stream<IdleState, IdleError> => {
    const threshold = Duration.fromInput(options.threshold);
    if (Option.isNone(threshold) || Duration.isLessThan(threshold.value, minimumThreshold)) {
      return Stream.fail(idleError("InvalidRequest", options.threshold));
    }
    const thresholdMillis = Duration.toMillis(threshold.value);
    return Stream.callback<IdleState, IdleError>(
      (queue) =>
        Effect.gen(function* () {
          const detector = new IdleDetector();
          const read = (): IdleState => ({
            user: detector.userState ?? "active",
            screen: detector.screenState ?? "unlocked",
          });
          const onChange = (): void => {
            Queue.offerUnsafe(queue, read());
          };
          // The detector runs until its signal aborts: tie it to the stream's scope.
          const controller = yield* Effect.acquireRelease(
            Effect.sync(() => {
              detector.addEventListener("change", onChange);
              return new AbortController();
            }),
            (controller) =>
              Effect.sync(() => {
                controller.abort();
                detector.removeEventListener("change", onChange);
              }),
          );
          yield* Effect.tryPromise({
            try: () => detector.start({ threshold: thresholdMillis, signal: controller.signal }),
            catch: (cause) => idleError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
          });
          onChange();
        }),
      { bufferSize: 16, strategy: "sliding" },
    ).pipe(Stream.changesWith(sameState));
  };
  return IdleDetection.of({
    supported: true,
    requestPermission: Effect.tryPromise({
      try: () => IdleDetector.requestPermission(),
      catch: (cause) => idleError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
    }),
    watch,
  });
};

/**
 * The {@link IdleDetection} service over the ambient `IdleDetector`;
 * reports `supported: false` where there is none — most agents.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { IdleDetection } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.map(IdleDetection.IdleDetection, (idle) => idle.supported)
 * Effect.runPromise(Effect.provide(program, IdleDetection.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<IdleDetection> = Layer.sync(IdleDetection, () =>
  make(ambientIdleDetector()),
);

/**
 * Asks the user for permission to detect idleness, returning their answer.
 * Call it from a user gesture: without one the browser rejects, which
 * fails `NotAllowed`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { IdleDetection } from "@thomasfosterau/effect-web/browser"
 * import { TestIdleDetection } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(IdleDetection.requestPermission, TestIdleDetection.layer({ answer: "granted" })),
 * ).then(console.log) // "granted"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const requestPermission: Effect.Effect<"granted" | "denied", IdleError, IdleDetection> =
  Effect.flatMap(IdleDetection, (idle) => idle.requestPermission);

/**
 * The idle state now, then each change, from the {@link IdleDetection}
 * service. Fails `NotAllowed` until the permission is granted.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { IdleDetection } from "@thomasfosterau/effect-web/browser"
 * import { TestIdleDetection } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runHead(IdleDetection.watch({ threshold: "2 minutes" }))
 * Effect.runPromise(
 *   Effect.provide(program, TestIdleDetection.layer({ permission: "granted" })),
 * ).then(console.log) // { _id: "Option", _tag: "Some", value: { user: "active", screen: "unlocked" } }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const watch = (options: WatchOptions): Stream.Stream<IdleState, IdleError, IdleDetection> =>
  Stream.unwrap(Effect.map(IdleDetection, (idle) => idle.watch(options)));
