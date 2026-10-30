/**
 * A controllable screen wake lock for tests of code that uses `./browser`'s
 * `WakeLock`: {@link layer} provides the real adapter over an in-memory
 * `navigator.wakeLock`, plus {@link Control} to see how many locks are held,
 * to release them as the browser does when a page is hidden, and to refuse
 * new ones.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { make as makeWakeLock, WakeLock, type WakeLockLike } from "../browser/wake-lock.ts";

/**
 * The in-memory wake lock's starting behaviour: `supported` (default
 * `true`) builds the unsupported service when `false`; `deny` (default
 * `false`) refuses every request with `NotAllowedError`.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean | undefined;
  readonly deny?: boolean | undefined;
}

/**
 * Drives the in-memory wake lock.
 *
 * - `held` — how many sentinels are currently unreleased.
 * - `requests` — how many requests were granted so far.
 * - `releaseAll` — releases every sentinel and fires its `release` event:
 *   what the browser does when the page is hidden.
 * - `setDenied` — refuse (or stop refusing) new requests.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly held: Effect.Effect<number>;
    readonly requests: Effect.Effect<number>;
    readonly releaseAll: Effect.Effect<void>;
    readonly setDenied: (denied: boolean) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/WakeLockControl") {}

/**
 * What {@link make} builds: the `WakeLock` service over the in-memory
 * `navigator.wakeLock`, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly wakeLock: WakeLock["Service"];
  readonly control: Control["Service"];
}

/** An in-memory sentinel: `released` is flipped by `release`, never reset. */
interface Sentinel extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

interface State {
  denied: boolean;
  requests: number;
}

/**
 * Builds an in-memory `navigator.wakeLock`: the `WakeLock` service over it,
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestWakeLock } from "@thomasfosterau/effect-web/testing"
 *
 * const { wakeLock, control } = TestWakeLock.make()
 * const program = Effect.scoped(Effect.andThen(wakeLock.acquire, control.held))
 * Effect.runPromise(program).then(console.log) // 1
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const sentinels: Array<Sentinel> = [];
  const state: State = { denied: options?.deny ?? false, requests: 0 };
  const release = (sentinel: Sentinel): void => {
    if (sentinel.released) return;
    sentinel.released = true;
    sentinels.splice(sentinels.indexOf(sentinel), 1);
    sentinel.dispatchEvent(new Event("release"));
  };
  const manager: WakeLockLike = {
    request: () => {
      if (state.denied) {
        return Promise.reject(new DOMException("Wake lock refused", "NotAllowedError"));
      }
      state.requests += 1;
      const sentinel: Sentinel = Object.assign(new EventTarget(), {
        released: false,
        release: () => {
          release(sentinel);
          return Promise.resolve();
        },
      });
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    },
  };
  return {
    wakeLock: makeWakeLock(options?.supported === false ? undefined : manager),
    control: Control.of({
      held: Effect.sync(() => sentinels.length),
      requests: Effect.sync(() => state.requests),
      releaseAll: Effect.sync(() => [...sentinels].forEach(release)),
      setDenied: (denied) =>
        Effect.sync(() => {
          state.denied = denied;
        }),
    }),
  };
};

/**
 * Provides `WakeLock` over a fresh in-memory `navigator.wakeLock`, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { WakeLock } from "@thomasfosterau/effect-web/browser"
 * import { TestWakeLock } from "@thomasfosterau/effect-web/testing"
 *
 * const program = WakeLock.keepAwake(
 *   Effect.flatMap(TestWakeLock.Control, (control) => control.held),
 * )
 * Effect.runPromise(Effect.provide(program, TestWakeLock.layer())).then(console.log) // 1
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<WakeLock | Control> =>
  Layer.syncContext(() => {
    const { wakeLock, control } = make(options);
    return Context.make(WakeLock, wakeLock).pipe(Context.add(Control, control));
  });
