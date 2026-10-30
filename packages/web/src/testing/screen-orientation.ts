/**
 * A controllable `screen.orientation` for tests of code that uses
 * `./browser`'s `ScreenOrientation`: {@link layer} provides the real
 * adapter over an in-memory orientation, plus {@link Control} to rotate the
 * screen (firing `change`, as the browser does), see the current lock, and
 * refuse lock requests the way a browser does.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { make as makeScreenOrientation, ScreenOrientation } from "../browser/screen-orientation.ts";

/**
 * The name of the `DOMException` a refused lock rejects with:
 * `NotSupportedError` (not fullscreen, or a platform that never locks),
 * `SecurityError` (a hidden or sandboxed document), or `AbortError` (a
 * newer lock superseded it).
 *
 * @since 0.2.0
 * @category models
 */
export type Refusal = "NotSupportedError" | "SecurityError" | "AbortError";

/**
 * The in-memory orientation's starting behaviour.
 *
 * - `supported` (default `true`) — builds the unsupported service when `false`.
 * - `type` (default `"portrait-primary"`) and `angle` (default: the
 *   type's natural angle — 0, 90, 180 or 270).
 * - `lockable` (default `true`) — whether the orientation has `lock` at
 *   all (Safari's has not).
 * - `refuse` — refuse every lock with this rejection.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean | undefined;
  readonly type?: OrientationType | undefined;
  readonly angle?: number | undefined;
  readonly lockable?: boolean | undefined;
  readonly refuse?: Refusal | undefined;
}

/**
 * Drives the in-memory orientation.
 *
 * - `rotate` — sets the orientation (the angle defaults to the type's
 *   natural one) and fires `change` (a no-op when unchanged).
 * - `locked` — the orientation the document is locked to; `None` when
 *   unlocked.
 * - `setRefusal` — refuse later locks with this rejection, or grant them
 *   again with `undefined`.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly rotate: (type: OrientationType, angle?: number) => Effect.Effect<void>;
    readonly locked: Effect.Effect<Option.Option<OrientationLockType>>;
    readonly setRefusal: (refusal: Refusal | undefined) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/ScreenOrientationControl") {}

/**
 * What {@link make} builds: the `ScreenOrientation` service over the
 * in-memory orientation, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly orientation: ScreenOrientation["Service"];
  readonly control: Control["Service"];
}

const NATURAL_ANGLE = {
  "portrait-primary": 0,
  "landscape-primary": 90,
  "portrait-secondary": 180,
  "landscape-secondary": 270,
} satisfies Readonly<Record<OrientationType, number>>;

interface State {
  type: OrientationType;
  angle: number;
  locked: OrientationLockType | undefined;
  refusal: Refusal | undefined;
}

/** An orientation whose readings are the double's live state. */
class TestOrientation extends EventTarget {
  readonly #state: State;
  constructor(state: State) {
    super();
    this.#state = state;
  }
  get type(): OrientationType {
    return this.#state.type;
  }
  get angle(): number {
    return this.#state.angle;
  }
  unlock(): void {
    this.#state.locked = undefined;
  }
}

/** A {@link TestOrientation} with `lock`. */
class LockableTestOrientation extends TestOrientation {
  readonly #state: State;
  constructor(state: State) {
    super(state);
    this.#state = state;
  }
  lock(orientation: OrientationLockType): Promise<void> {
    const refusal = this.#state.refusal;
    if (refusal !== undefined) return Promise.reject(new DOMException("Lock refused", refusal));
    this.#state.locked = orientation;
    return Promise.resolve();
  }
}

/**
 * Builds an in-memory `screen.orientation`: the `ScreenOrientation`
 * service over it, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestScreenOrientation } from "@thomasfosterau/effect-web/testing"
 *
 * const { orientation, control } = TestScreenOrientation.make()
 * Effect.runPromise(Effect.andThen(control.rotate("landscape-primary"), orientation.angle)).then(
 *   console.log, // { _id: "Option", _tag: "Some", value: 90 }
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const type = options?.type ?? "portrait-primary";
  const state: State = {
    type,
    angle: options?.angle ?? NATURAL_ANGLE[type],
    locked: undefined,
    refusal: options?.refuse,
  };
  const orientation =
    options?.lockable === false ? new TestOrientation(state) : new LockableTestOrientation(state);
  return {
    orientation: makeScreenOrientation(options?.supported === false ? undefined : orientation),
    control: Control.of({
      rotate: (next, angle) =>
        Effect.sync(() => {
          const nextAngle = angle ?? NATURAL_ANGLE[next];
          if (state.type === next && state.angle === nextAngle) return;
          state.type = next;
          state.angle = nextAngle;
          orientation.dispatchEvent(new Event("change"));
        }),
      locked: Effect.sync(() => Option.fromUndefinedOr(state.locked)),
      setRefusal: (refusal) =>
        Effect.sync(() => {
          state.refusal = refusal;
        }),
    }),
  };
};

/**
 * Provides `ScreenOrientation` over a fresh in-memory orientation, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { ScreenOrientation } from "@thomasfosterau/effect-web/browser"
 * import { TestScreenOrientation } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.flip(ScreenOrientation.withLock(Effect.void, "landscape"))
 * Effect.runPromise(
 *   Effect.provide(program, TestScreenOrientation.layer({ refuse: "NotSupportedError" })),
 * ).then((error) => console.log(error.reason)) // "Unsupported"
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<ScreenOrientation | Control> =>
  Layer.syncContext(() => {
    const { orientation, control } = make(options);
    return Context.make(ScreenOrientation, orientation).pipe(Context.add(Control, control));
  });
