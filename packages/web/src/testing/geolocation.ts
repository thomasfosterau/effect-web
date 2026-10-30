/**
 * A controllable position source for tests of code that uses
 * `@effect/platform-browser`'s `Geolocation`: {@link layer} provides
 * `Geolocation` over an in-memory source, plus {@link Control} to move the
 * device or make the source fail (permission denied, no fix, timeout).
 *
 * `getCurrentPosition` answers with the latest position, or waits for the
 * next one when there is none yet; `watchPosition` emits the latest
 * position (if any) and then every later one, and fails on a failure, as
 * the browser's watch does.
 *
 * @since 0.2.0
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as Geolocation from "@effect/platform-browser/Geolocation";

/**
 * A position fix: degrees for `latitude` / `longitude`, metres for
 * `accuracy` (default `10`) and `altitude`. `timestamp` defaults to the
 * moment the fix is set.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy?: number | undefined;
  readonly altitude?: number | undefined;
  readonly timestamp?: number | undefined;
}

/**
 * The failures a position source reports, by `@effect/platform-browser`'s
 * reason tags.
 *
 * @since 0.2.0
 * @category models
 */
export type Failure = "PermissionDenied" | "PositionUnavailable" | "Timeout";

/**
 * Drives the in-memory source: `setPosition` publishes a fix to every
 * watcher (and answers a waiting `getCurrentPosition`); `fail` fails them
 * with the given reason.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly setPosition: (fix: Fix) => Effect.Effect<void>;
    readonly fail: (failure: Failure) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/GeolocationControl") {}

const GEOLOCATION_TYPE_ID = "~@effect/platform-browser/Geolocation";

const toPosition = (fix: Fix, now: number): GeolocationPosition => {
  const coords = {
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy: fix.accuracy ?? 10,
    altitude: fix.altitude ?? null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  };
  const timestamp = fix.timestamp ?? now;
  return {
    coords: { ...coords, toJSON: () => coords },
    timestamp,
    toJSON: () => ({ coords, timestamp }),
  };
};

/** The `GeolocationPositionError` code a browser reports for each failure. */
const FAILURE_CODES = {
  PermissionDenied: 1,
  PositionUnavailable: 2,
  Timeout: 3,
} satisfies Record<Failure, number>;

const toError = (failure: Failure): Geolocation.GeolocationError => {
  const cause = { code: FAILURE_CODES[failure], message: failure };
  return new Geolocation.GeolocationError({
    reason:
      failure === "PermissionDenied"
        ? new Geolocation.PermissionDenied({ cause })
        : failure === "Timeout"
          ? new Geolocation.Timeout({ cause })
          : new Geolocation.PositionUnavailable({ cause }),
  });
};

type Update = Result.Result<GeolocationPosition, Geolocation.GeolocationError>;

interface State {
  latest: Option.Option<Update>;
}

/**
 * What {@link make} builds: the `Geolocation` service over the in-memory
 * position source, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly geolocation: Geolocation.Geolocation;
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory position source, starting at `initial` (or with no
 * fix): the `Geolocation` service over it, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestGeolocation } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const { geolocation } = yield* TestGeolocation.make({ latitude: -33.87, longitude: 151.21 })
 *   const position = yield* geolocation.getCurrentPosition()
 *   return position.coords.latitude
 * })
 * Effect.runPromise(program).then(console.log) // -33.87
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (initial?: Fix): Effect.Effect<Fixture> =>
  Effect.gen(function* () {
    const updates = yield* PubSub.unbounded<Update>();
    const now = yield* Clock.currentTimeMillis;
    const state: State = {
      latest: Option.map(Option.fromUndefinedOr(initial), (fix) =>
        Result.succeed(toPosition(fix, now)),
      ),
    };
    const publish = (update: Update) =>
      Effect.suspend(() => {
        state.latest = Option.some(update);
        return PubSub.publish(updates, update);
      });
    // Subscribe before reading `latest`, so a fix set in between is seen.
    const watch = Stream.unwrap(
      Effect.map(PubSub.subscribe(updates), (subscription) =>
        Stream.concat(
          Stream.fromIterable(Option.toArray(state.latest)),
          Stream.fromSubscription(subscription),
        ),
      ),
    ).pipe(
      Stream.mapEffect((update) =>
        Result.match(update, { onSuccess: Effect.succeed, onFailure: Effect.fail }),
      ),
    );
    const geolocation: Geolocation.Geolocation = Geolocation.Geolocation.of({
      [GEOLOCATION_TYPE_ID]: GEOLOCATION_TYPE_ID,
      getCurrentPosition: () =>
        Stream.runHead(watch).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die("the test position source ended"),
              onSome: Effect.succeed,
            }),
          ),
        ),
      watchPosition: () => watch,
    });
    return {
      geolocation,
      control: Control.of({
        setPosition: (fix) =>
          Effect.flatMap(
            Effect.clockWith((clock) => clock.currentTimeMillis),
            (now) => publish(Result.succeed(toPosition(fix, now))),
          ).pipe(Effect.asVoid),
        fail: (failure) => publish(Result.fail(toError(failure))).pipe(Effect.asVoid),
      }),
    };
  });

/**
 * Provides `Geolocation` over a fresh in-memory position source starting at
 * `initial`, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Geolocation from "@effect/platform-browser/Geolocation"
 * import { TestGeolocation } from "@thomasfosterau/effect-web/testing"
 *
 * const here = Effect.flatMap(Geolocation.Geolocation, (geo) => geo.getCurrentPosition())
 * Effect.runPromise(
 *   Effect.provide(here, TestGeolocation.layer({ latitude: 51.5, longitude: -0.12 })),
 * ).then((position) => console.log(position.coords.longitude)) // -0.12
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (initial?: Fix): Layer.Layer<Geolocation.Geolocation | Control> =>
  Layer.effectContext(
    Effect.map(make(initial), ({ geolocation, control }) =>
      Context.make(Geolocation.Geolocation, geolocation).pipe(Context.add(Control, control)),
    ),
  );
