/**
 * The Battery Status API (`navigator.getBattery()`) as an Effect service:
 * the battery's charge and charging state, as a value and as a stream.
 *
 * Firefox and Safari removed the API (it was a fingerprinting vector), so
 * where it is missing is the common case: {@link status} is `None` and
 * {@link changes} is empty there, and code should treat a battery reading
 * as a hint (dim an animation, defer a sync), never a requirement.
 *
 * This is its own service rather than part of `Navigator` because the
 * manager is acquired through a promise, not read off a property like
 * `navigator.connection`: the first reading waits for `getBattery()`, and
 * the manager it resolves to is reused by every later one.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { watch } from "../internal/dom.ts";
import { ambientGetBattery } from "../internal/globals.ts";

/**
 * The structural slice of a `BatteryManager` this module reads.
 *
 * @since 0.2.0
 * @category models
 */
export interface BatteryManagerLike extends Stream.EventListener {
  readonly charging: boolean;
  readonly level: number;
  readonly chargingTime: number;
  readonly dischargingTime: number;
}

/**
 * A battery reading.
 *
 * - `charging` — whether the battery is charging.
 * - `level` — the charge, from `0` (empty) to `1` (full).
 * - `chargingTime` — how long until full; `None` when unknown or while
 *   discharging (`0` once full).
 * - `dischargingTime` — how long until empty; `None` when unknown or while
 *   charging.
 *
 * @since 0.2.0
 * @category models
 */
export interface BatteryState {
  readonly charging: boolean;
  readonly level: number;
  readonly chargingTime: Option.Option<Duration.Duration>;
  readonly dischargingTime: Option.Option<Duration.Duration>;
}

/**
 * The battery service. Provide {@link layer} in a page, or
 * `TestBattery.layer` from `@thomasfosterau/effect-web/testing` in tests.
 *
 * - `supported` — whether the agent has `navigator.getBattery` at all.
 * - `status` — the reading now; `None` where the API is missing or
 *   `getBattery()` rejected (a permissions policy).
 * - `changes` — the reading now, then each change; empty where `status`
 *   is `None`.
 *
 * @since 0.2.0
 * @category services
 */
export class Battery extends Context.Service<
  Battery,
  {
    readonly supported: boolean;
    readonly status: Effect.Effect<Option.Option<BatteryState>>;
    readonly changes: Stream.Stream<BatteryState>;
  }
>()("@thomasfosterau/effect-web/browser/Battery") {}

// The API reports an unknown time as `Infinity`.
const seconds = (value: number): Option.Option<Duration.Duration> =>
  Number.isFinite(value) ? Option.some(Duration.seconds(value)) : Option.none();

const read = (manager: BatteryManagerLike): BatteryState => ({
  charging: manager.charging,
  level: manager.level,
  chargingTime: seconds(manager.chargingTime),
  dischargingTime: seconds(manager.dischargingTime),
});

const sameTime = Option.makeEquivalence(Duration.Equivalence);

const sameState = (self: BatteryState, that: BatteryState): boolean =>
  self.charging === that.charging &&
  self.level === that.level &&
  sameTime(self.chargingTime, that.chargingTime) &&
  sameTime(self.dischargingTime, that.dischargingTime);

const EVENTS = ["chargingchange", "levelchange", "chargingtimechange", "dischargingtimechange"];

/**
 * Builds the {@link Battery} service over a `getBattery` function;
 * `undefined` builds the unsupported service. {@link layer} passes the
 * ambient `navigator.getBattery`, bound to `navigator`. `getBattery` is
 * called once, on the first reading.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Battery } from "@thomasfosterau/effect-web/browser"
 *
 * const battery = Battery.make(undefined)
 * Effect.runPromise(battery.status).then(console.log) // { _id: "Option", _tag: "None" }
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (
  getBattery: (() => Promise<BatteryManagerLike>) | undefined,
): Battery["Service"] => {
  if (getBattery === undefined) {
    return Battery.of({
      supported: false,
      status: Effect.succeed(Option.none()),
      changes: Stream.empty,
    });
  }
  let pending: Promise<BatteryManagerLike> | undefined;
  const manager: Effect.Effect<Option.Option<BatteryManagerLike>> = Effect.tryPromise(() => {
    pending ??= getBattery();
    return pending;
  }).pipe(Effect.option);
  return Battery.of({
    supported: true,
    status: Effect.map(manager, Option.map(read)),
    changes: Stream.unwrap(
      Effect.map(
        manager,
        Option.match({
          onNone: () => Stream.empty,
          onSome: (manager) => watch(manager, EVENTS, () => read(manager), sameState),
        }),
      ),
    ),
  });
};

/**
 * The {@link Battery} service over the ambient `navigator.getBattery`;
 * reports `supported: false` where there is none — Firefox, Safari, Node.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Battery } from "@thomasfosterau/effect-web/browser"
 *
 * Effect.runPromise(Effect.provide(Battery.status, Battery.layer)).then(console.log)
 * // { _id: "Option", _tag: "None" } under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Battery> = Layer.sync(Battery, () => make(ambientGetBattery()));

/**
 * The battery reading now, from the {@link Battery} service; `None` where
 * the API is missing.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Battery } from "@thomasfosterau/effect-web/browser"
 * import { TestBattery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.map(Battery.status, Option.map((state) => state.level))
 * Effect.runPromise(Effect.provide(program, TestBattery.layer({ level: 0.42 }))).then(console.log)
 * // { _id: "Option", _tag: "Some", value: 0.42 }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const status: Effect.Effect<Option.Option<BatteryState>, never, Battery> = Effect.flatMap(
  Battery,
  (battery) => battery.status,
);

/**
 * The battery reading now, then each change (`chargingchange`,
 * `levelchange`, `chargingtimechange`, `dischargingtimechange`); empty
 * where the API is missing.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Battery } from "@thomasfosterau/effect-web/browser"
 * import { TestBattery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(
 *   Stream.map(Stream.take(Battery.changes, 1), (state) => state.charging),
 * )
 * Effect.runPromise(Effect.provide(program, TestBattery.layer())).then(console.log) // [true]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const changes: Stream.Stream<BatteryState, never, Battery> = Stream.unwrap(
  Effect.map(Battery, (battery) => battery.changes),
);
