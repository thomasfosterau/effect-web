/**
 * A controllable battery for tests of code that uses `./browser`'s
 * `Battery`: {@link layer} provides the real adapter over an in-memory
 * `navigator.getBattery()`, plus {@link Control} to change the charge and
 * charging state, firing the matching events as the browser does.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Battery, make as makeBattery } from "../browser/battery.ts";

/**
 * The raw readings a `BatteryManager` reports: `level` from `0` to `1`,
 * the times in seconds, `Infinity` for unknown.
 *
 * @since 0.2.0
 * @category models
 */
export interface Readings {
  readonly charging: boolean;
  readonly level: number;
  readonly chargingTime: number;
  readonly dischargingTime: number;
}

/**
 * The in-memory battery's starting behaviour: `supported` (default `true`)
 * builds the unsupported service when `false`; `reject` (default `false`)
 * makes `getBattery()` reject (a permissions policy). The readings default
 * to a full battery on charge: `charging: true`, `level: 1`,
 * `chargingTime: 0`, `dischargingTime: Infinity`.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean | undefined;
  readonly reject?: boolean | undefined;
  readonly charging?: boolean | undefined;
  readonly level?: number | undefined;
  readonly chargingTime?: number | undefined;
  readonly dischargingTime?: number | undefined;
}

/**
 * Drives the in-memory battery: `set` changes any of the readings and fires
 * `chargingchange` / `levelchange` / `chargingtimechange` /
 * `dischargingtimechange` for each one that changed; `requests` counts the
 * `getBattery()` calls.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly set: (readings: Omit<Options, "supported" | "reject">) => Effect.Effect<void>;
    readonly requests: Effect.Effect<number>;
  }
>()("@thomasfosterau/effect-web/testing/BatteryControl") {}

/**
 * What {@link make} builds: the `Battery` service over the in-memory
 * battery, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly battery: Battery["Service"];
  readonly control: Control["Service"];
}

/** A battery manager whose readings are the double's live state. */
class TestBatteryManager extends EventTarget {
  readonly #state: { -readonly [K in keyof Readings]: Readings[K] };
  constructor(state: { -readonly [K in keyof Readings]: Readings[K] }) {
    super();
    this.#state = state;
  }
  get charging(): boolean {
    return this.#state.charging;
  }
  get level(): number {
    return this.#state.level;
  }
  get chargingTime(): number {
    return this.#state.chargingTime;
  }
  get dischargingTime(): number {
    return this.#state.dischargingTime;
  }
}

const EVENT_OF = {
  charging: "chargingchange",
  level: "levelchange",
  chargingTime: "chargingtimechange",
  dischargingTime: "dischargingtimechange",
} satisfies Readonly<Record<keyof Readings, string>>;

const FIELDS = ["charging", "level", "chargingTime", "dischargingTime"] as const;

/**
 * Builds an in-memory battery: the `Battery` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestBattery } from "@thomasfosterau/effect-web/testing"
 *
 * const { battery, control } = TestBattery.make()
 * Effect.runPromise(Effect.andThen(control.set({ charging: false }), battery.status)).then(
 *   console.log,
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const state = {
    charging: options?.charging ?? true,
    level: options?.level ?? 1,
    chargingTime: options?.chargingTime ?? 0,
    dischargingTime: options?.dischargingTime ?? Number.POSITIVE_INFINITY,
  };
  const manager = new TestBatteryManager(state);
  const counts = { requests: 0 };
  const getBattery = (): Promise<TestBatteryManager> => {
    counts.requests += 1;
    return options?.reject === true
      ? Promise.reject(new DOMException("getBattery is not allowed", "NotAllowedError"))
      : Promise.resolve(manager);
  };
  return {
    battery: makeBattery(options?.supported === false ? undefined : getBattery),
    control: Control.of({
      set: (readings) =>
        Effect.sync(() => {
          const next: Readings = {
            charging: readings.charging ?? state.charging,
            level: readings.level ?? state.level,
            chargingTime: readings.chargingTime ?? state.chargingTime,
            dischargingTime: readings.dischargingTime ?? state.dischargingTime,
          };
          const changed = FIELDS.filter((field) => !Object.is(next[field], state[field]));
          Object.assign(state, next);
          changed.forEach((field) => manager.dispatchEvent(new Event(EVENT_OF[field])));
        }),
      requests: Effect.sync(() => counts.requests),
    }),
  };
};

/**
 * Provides `Battery` over a fresh in-memory battery, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Battery } from "@thomasfosterau/effect-web/browser"
 * import { TestBattery } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(Effect.provide(Battery.status, TestBattery.layer({ supported: false }))).then(
 *   console.log, // { _id: "Option", _tag: "None" }
 * )
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Battery | Control> =>
  Layer.syncContext(() => {
    const { battery, control } = make(options);
    return Context.make(Battery, battery).pipe(Context.add(Control, control));
  });
