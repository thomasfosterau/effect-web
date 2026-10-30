/**
 * A controllable `IdleDetector` for tests of code that uses `./browser`'s
 * `IdleDetection`: {@link layer} provides the real adapter over an
 * in-memory detector constructor, plus {@link Control} to grant or deny the
 * permission, answer a permission prompt, and change the user and screen
 * state (firing `change` on every running detector, as the browser does).
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  IdleDetection,
  type IdleDetectorLike,
  type IdleState,
  make as makeIdleDetection,
} from "../browser/idle-detection.ts";

/**
 * The idle-detection permission: `"prompt"` until the user answers.
 *
 * @since 0.2.0
 * @category models
 */
export type Permission = "granted" | "denied" | "prompt";

/**
 * The in-memory detector's starting behaviour.
 *
 * - `supported` (default `true`) — builds the unsupported service when `false`.
 * - `permission` (default `"prompt"`) — the permission now; a detector
 *   starts only once it is `"granted"`.
 * - `answer` (default `"granted"`) — what a permission prompt resolves to;
 *   the answer becomes the permission.
 * - `user` (default `"active"`), `screen` (default `"unlocked"`) — the state.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean | undefined;
  readonly permission?: Permission | undefined;
  readonly answer?: "granted" | "denied" | undefined;
  readonly user?: IdleState["user"] | undefined;
  readonly screen?: IdleState["screen"] | undefined;
}

/**
 * Drives the in-memory detector.
 *
 * - `setUser`, `setScreen` — change the state, firing `change` on every
 *   running detector (a no-op when unchanged).
 * - `setPermission`, `setAnswer` — the permission now, and what later
 *   prompts resolve to.
 * - `running` — how many detectors are started and not yet aborted.
 * - `thresholds` — the threshold, in milliseconds, each started detector
 *   was given.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly setUser: (user: IdleState["user"]) => Effect.Effect<void>;
    readonly setScreen: (screen: IdleState["screen"]) => Effect.Effect<void>;
    readonly setPermission: (permission: Permission) => Effect.Effect<void>;
    readonly setAnswer: (answer: "granted" | "denied") => Effect.Effect<void>;
    readonly running: Effect.Effect<number>;
    readonly thresholds: Effect.Effect<ReadonlyArray<number>>;
  }
>()("@thomasfosterau/effect-web/testing/IdleDetectionControl") {}

/**
 * What {@link make} builds: the `IdleDetection` service over the in-memory
 * detector, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly idleDetection: IdleDetection["Service"];
  readonly control: Control["Service"];
}

interface State {
  permission: Permission;
  answer: "granted" | "denied";
  user: IdleState["user"];
  screen: IdleState["screen"];
}

/**
 * Builds an in-memory `IdleDetector`: the `IdleDetection` service over it,
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestIdleDetection } from "@thomasfosterau/effect-web/testing"
 *
 * const { idleDetection, control } = TestIdleDetection.make()
 * Effect.runPromise(Effect.andThen(idleDetection.requestPermission, control.running)).then(
 *   console.log, // 0
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const state: State = {
    permission: options?.permission ?? "prompt",
    answer: options?.answer ?? "granted",
    user: options?.user ?? "active",
    screen: options?.screen ?? "unlocked",
  };
  const running: Array<EventTarget> = [];
  const thresholds: Array<number> = [];
  const IdleDetector: IdleDetectorLike = class extends EventTarget {
    #started = false;
    static requestPermission(): Promise<"granted" | "denied"> {
      if (state.permission === "prompt") state.permission = state.answer;
      return Promise.resolve(state.permission === "granted" ? "granted" : "denied");
    }
    get userState(): IdleState["user"] | null {
      return this.#started ? state.user : null;
    }
    get screenState(): IdleState["screen"] | null {
      return this.#started ? state.screen : null;
    }
    start(init: { readonly threshold: number; readonly signal: AbortSignal }): Promise<void> {
      if (state.permission !== "granted") {
        return Promise.reject(
          new DOMException("Idle detection permission denied", "NotAllowedError"),
        );
      }
      if (init.threshold < 60_000) {
        return Promise.reject(new TypeError("Minimum threshold is 1 minute"));
      }
      this.#started = true;
      thresholds.push(init.threshold);
      running.push(this);
      init.signal.addEventListener("abort", () => running.splice(running.indexOf(this), 1), {
        once: true,
      });
      return Promise.resolve();
    }
  };
  const fireIfChanged = (changed: boolean): void => {
    if (changed) running.forEach((detector) => detector.dispatchEvent(new Event("change")));
  };
  return {
    idleDetection: makeIdleDetection(options?.supported === false ? undefined : IdleDetector),
    control: Control.of({
      setUser: (user) =>
        Effect.sync(() => {
          const changed = state.user !== user;
          state.user = user;
          fireIfChanged(changed);
        }),
      setScreen: (screen) =>
        Effect.sync(() => {
          const changed = state.screen !== screen;
          state.screen = screen;
          fireIfChanged(changed);
        }),
      setPermission: (permission) =>
        Effect.sync(() => {
          state.permission = permission;
        }),
      setAnswer: (answer) =>
        Effect.sync(() => {
          state.answer = answer;
        }),
      running: Effect.sync(() => running.length),
      thresholds: Effect.sync(() => [...thresholds]),
    }),
  };
};

/**
 * Provides `IdleDetection` over a fresh in-memory detector, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { IdleDetection } from "@thomasfosterau/effect-web/browser"
 * import { TestIdleDetection } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.flip(Stream.runDrain(IdleDetection.watch({ threshold: "1 minute" })))
 * Effect.runPromise(Effect.provide(program, TestIdleDetection.layer())).then((error) =>
 *   console.log(error.reason), // "NotAllowed": the permission is still "prompt"
 * )
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<IdleDetection | Control> =>
  Layer.syncContext(() => {
    const { idleDetection, control } = make(options);
    return Context.make(IdleDetection, idleDetection).pipe(Context.add(Control, control));
  });
