/**
 * The Screen Wake Lock API (`navigator.wakeLock`) as an Effect service: keep
 * the screen from dimming or locking for the lifetime of a `Scope`.
 *
 * A wake lock is advisory and short-lived by design. The browser refuses one
 * while the page is hidden, and releases a held one whenever the page is
 * hidden (and may release it on low battery or a power-saving mode). So:
 * {@link keepAwake} holds one lock for one effect and fails if it cannot be
 * had, while {@link keepAwakeWhileVisible} — the shape a recipe, a slide
 * deck or a navigation view wants — re-acquires each time the page becomes
 * visible again and never fails the work it guards over a lock it could not
 * get (a refusal is logged at warning level instead).
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import { reasonOf, settled } from "../internal/dom.ts";
import { ambientNavigator } from "../internal/globals.ts";
import { PageVisibility, whileVisible } from "./page-visibility.ts";

/**
 * The structural slice of a `WakeLockSentinel` this module uses.
 *
 * @since 0.2.0
 * @category models
 */
export interface WakeLockSentinelLike extends Stream.EventListener<unknown> {
  readonly released: boolean;
  release(): Promise<void>;
}

/**
 * The structural slice of `navigator.wakeLock` this module calls.
 *
 * @since 0.2.0
 * @category models
 */
export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/**
 * A screen wake lock held by this page until its scope closes — or until
 * the browser releases it first, which `released` reports.
 *
 * @since 0.2.0
 * @category models
 */
export interface HeldWakeLock {
  /** Completes when the lock is released, by its scope or by the browser. */
  readonly released: Effect.Effect<void>;
  /** Whether the lock has been released. */
  readonly isReleased: Effect.Effect<boolean>;
}

/**
 * Why a wake lock was not granted.
 *
 * - `Unsupported` — the agent has no `navigator.wakeLock`.
 * - `NotAllowed` — refused: the page is hidden, a permissions policy forbids
 *   it, or the agent declined (a power-saving mode).
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type WakeLockErrorReason = "Unsupported" | "NotAllowed" | "Failed";

/**
 * A wake lock that was not granted. `cause` carries the browser's rejection,
 * where there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class WakeLockError extends Schema.TaggedError<WakeLockError>()("WakeLockError", {
  reason: Schema.Literals(["Unsupported", "NotAllowed", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const wakeLockError = (reason: WakeLockErrorReason, cause: unknown) =>
  new WakeLockError({ reason, cause, message: `screen wake lock: ${reason}` });

const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
} satisfies Readonly<Record<string, WakeLockErrorReason>>;

/**
 * The screen-wake-lock service. Provide {@link layer} in a page, or
 * `TestWakeLock.layer` from `@thomasfosterau/effect-web/testing` in tests.
 *
 * - `supported` — whether the agent has the API at all.
 * - `acquire` — requests a screen wake lock, held until the scope closes.
 *
 * @since 0.2.0
 * @category services
 */
export class WakeLock extends Context.Service<
  WakeLock,
  {
    readonly supported: boolean;
    readonly acquire: Effect.Effect<HeldWakeLock, WakeLockError, Scope.Scope>;
  }
>()("@thomasfosterau/effect-web/browser/WakeLock") {}

/**
 * Builds the {@link WakeLock} service over a wake-lock manager; `undefined`
 * builds the unsupported service. {@link layer} passes `navigator.wakeLock`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { WakeLock } from "@thomasfosterau/effect-web/browser"
 *
 * const wakeLock = WakeLock.make(undefined)
 * Effect.runPromise(Effect.flip(Effect.scoped(wakeLock.acquire))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (wakeLock: WakeLockLike | undefined): WakeLock["Service"] => {
  if (wakeLock === undefined) {
    return WakeLock.of({
      supported: false,
      acquire: Effect.fail(wakeLockError("Unsupported", undefined)),
    });
  }
  return WakeLock.of({
    supported: true,
    acquire: Effect.acquireRelease(
      Effect.gen(function* () {
        const sentinel = yield* Effect.tryPromise({
          try: () => wakeLock.request("screen"),
          catch: (cause) => wakeLockError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
        });
        const released = yield* Deferred.make<void>();
        const onRelease = (): void => {
          Deferred.doneUnsafe(released, Effect.void);
          sentinel.removeEventListener("release", onRelease);
        };
        sentinel.addEventListener("release", onRelease);
        if (sentinel.released) onRelease();
        return { sentinel, released };
      }),
      ({ sentinel, released }) =>
        Effect.andThen(
          // Releasing an already-released sentinel is a no-op in the browser.
          settled(() => sentinel.release()),
          Deferred.succeed(released, undefined),
        ),
    ).pipe(
      Effect.map(({ sentinel, released }) => ({
        released: Deferred.await(released),
        isReleased: Effect.sync(() => sentinel.released),
      })),
    ),
  });
};

/**
 * The {@link WakeLock} service over the ambient `navigator.wakeLock`; reports
 * `supported: false` where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { WakeLock } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.map(WakeLock.WakeLock, (wakeLock) => wakeLock.supported)
 * Effect.runPromise(Effect.provide(program, WakeLock.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<WakeLock> = Layer.sync(WakeLock, () =>
  make(ambientNavigator()?.wakeLock),
);

/**
 * Runs `self` with a screen wake lock held, released however `self` ends.
 * Fails with the {@link WakeLockError} when no lock is granted (without
 * running `self`). The browser may still release the lock early (the page
 * is hidden); this does not re-acquire it — {@link keepAwakeWhileVisible}
 * does.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { WakeLock } from "@thomasfosterau/effect-web/browser"
 * import { TestWakeLock } from "@thomasfosterau/effect-web/testing"
 *
 * const presenting = WakeLock.keepAwake(Effect.succeed("presented"))
 * Effect.runPromise(Effect.provide(presenting, TestWakeLock.layer())).then(console.log) // "presented"
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const keepAwake = <A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | WakeLockError, R | WakeLock> =>
  Effect.flatMap(WakeLock, (wakeLock) =>
    Effect.scopedWith((scope) => Effect.andThen(Scope.provide(wakeLock.acquire, scope), self)),
  );

/**
 * Runs `self` keeping the screen awake while the page is visible: a lock is
 * requested whenever the page becomes visible (the browser drops it each
 * time the page is hidden) and released when `self` ends. A lock that
 * cannot be had — unsupported, refused — never fails `self`; the refusal is
 * logged at warning level and retried at the next return to visibility.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Layer from "effect/Layer"
 * import { WakeLock } from "@thomasfosterau/effect-web/browser"
 * import { TestPageVisibility, TestWakeLock } from "@thomasfosterau/effect-web/testing"
 *
 * const cooking = WakeLock.keepAwakeWhileVisible(Effect.sleep("5 millis"))
 * const layer = Layer.merge(TestWakeLock.layer(), TestPageVisibility.layer())
 * Effect.runPromise(Effect.provide(cooking, layer))
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const keepAwakeWhileVisible = <A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | WakeLock | PageVisibility> =>
  Effect.flatMap(WakeLock, (wakeLock) => {
    const hold = Effect.scoped(Effect.flatMap(wakeLock.acquire, (held) => held.released)).pipe(
      Effect.catchTag("WakeLockError", (error) =>
        Effect.logWarning("screen wake lock not held", error.reason),
      ),
    );
    return Effect.raceFirst(self, whileVisible(hold));
  });
