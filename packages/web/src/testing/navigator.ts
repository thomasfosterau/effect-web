/**
 * A controllable `navigator` for tests of code that uses `./browser`'s
 * `Navigator`: {@link layer} provides the real `Navigator` adapter over an
 * in-memory navigator, plus {@link Control} to drive it (go offline, change
 * languages, change the connection) and to read back what the code under
 * test asked the platform to do (shares, beacons, vibrations).
 *
 * Driving goes through the same events the browser fires (`online`,
 * `offline`, `languagechange`, the connection's `change`), so the adapter's
 * streams are exercised exactly as they run live.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  make as makeNavigator,
  Navigator,
  type NavigatorLike,
  type StorageManagerLike,
  type UserActivationState,
} from "../browser/navigator.ts";

/**
 * How the in-memory platform answers a call: `"succeed"`, refuse it with
 * the `DOMException` a browser would use, or `"unsupported"` (the API is
 * absent).
 *
 * - `share` — `"succeed"`, `"abort"` (the user dismissed the sheet,
 *   `AbortError`), `"deny"` (`NotAllowedError`), `"unsupported"`.
 * - `beacon` — `"queue"`, `"reject"` (`sendBeacon` returns `false`),
 *   `"unsupported"`.
 *
 * @since 0.2.0
 * @category models
 */
export interface Behaviour {
  readonly share?: "succeed" | "abort" | "deny" | "unsupported" | undefined;
  readonly beacon?: "queue" | "reject" | "unsupported" | undefined;
}

/**
 * The network connection the in-memory navigator reports, in the Network
 * Information API's own units (`downlink` in Mbps, `rtt` in ms).
 *
 * @since 0.2.0
 * @category models
 */
export interface ConnectionInit {
  readonly type?: string | undefined;
  readonly effectiveType?: string | undefined;
  readonly downlink?: number | undefined;
  readonly rtt?: number | undefined;
  readonly saveData?: boolean | undefined;
}

/**
 * The in-memory navigator's starting state. Defaults: a `"TestNavigator"`
 * user agent, `["en-US"]`, online, 4 logical processors, cookies enabled,
 * no touch, a 1 GiB quota with nothing used, and every call succeeding.
 * `connection` and `userActivation` are absent (`None`) unless given, as
 * on a browser without the API.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options extends Behaviour {
  readonly userAgent?: string | undefined;
  readonly languages?: ReadonlyArray<string> | undefined;
  readonly onLine?: boolean | undefined;
  readonly hardwareConcurrency?: number | undefined;
  readonly deviceMemory?: number | undefined;
  readonly maxTouchPoints?: number | undefined;
  readonly cookieEnabled?: boolean | undefined;
  readonly webdriver?: boolean | undefined;
  readonly globalPrivacyControl?: boolean | undefined;
  readonly connection?: ConnectionInit | undefined;
  readonly userActivation?: UserActivationState | undefined;
  readonly storage?:
    | {
        readonly usage?: number | undefined;
        readonly quota?: number | undefined;
        readonly persisted?: boolean | undefined;
        /** Whether a `persist()` request is granted (default `true`). */
        readonly grantPersistence?: boolean | undefined;
      }
    | undefined;
}

/**
 * A beacon the code under test queued.
 *
 * @since 0.2.0
 * @category models
 */
export interface Beacon {
  readonly url: string;
  readonly data: Option.Option<BodyInit>;
}

/**
 * Drives the in-memory navigator and records what it was asked to do.
 *
 * - `setOnLine` — flips connectivity and fires `online` / `offline`.
 * - `setLanguages` — replaces the languages and fires `languagechange`.
 * - `setConnection` — replaces the connection and fires its `change`.
 * - `setUserActivation` — replaces the user-activation state.
 * - `shares` / `beacons` / `vibrations` — every successful call so far,
 *   oldest first.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly setOnLine: (onLine: boolean) => Effect.Effect<void>;
    readonly setLanguages: (languages: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly setConnection: (connection: ConnectionInit) => Effect.Effect<void>;
    readonly setUserActivation: (state: UserActivationState) => Effect.Effect<void>;
    readonly shares: Effect.Effect<ReadonlyArray<ShareData>>;
    readonly beacons: Effect.Effect<ReadonlyArray<Beacon>>;
    readonly vibrations: Effect.Effect<ReadonlyArray<VibratePattern>>;
  }
>()("@thomasfosterau/effect-web/testing/NavigatorControl") {}

/** A `navigator.connection` whose fields read the double's live state. */
class TestConnection extends EventTarget {
  readonly #read: () => ConnectionInit | undefined;
  constructor(read: () => ConnectionInit | undefined) {
    super();
    this.#read = read;
  }
  get type(): string | undefined {
    return this.#read()?.type;
  }
  get effectiveType(): string | undefined {
    return this.#read()?.effectiveType;
  }
  get downlink(): number | undefined {
    return this.#read()?.downlink;
  }
  get rtt(): number | undefined {
    return this.#read()?.rtt;
  }
  get saveData(): boolean | undefined {
    return this.#read()?.saveData;
  }
}

interface State {
  onLine: boolean;
  languages: ReadonlyArray<string>;
  connection: ConnectionInit | undefined;
  userActivation: UserActivationState | undefined;
}

const refusal = (name: string, message: string) => new DOMException(message, name);

/**
 * What {@link make} builds: the `Navigator` service over the in-memory
 * navigator, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly navigator: Navigator["Service"];
  readonly control: Control["Service"];
}

const or = <A>(value: A | undefined, fallback: A): A => value ?? fallback;

/** The in-memory `navigator.storage`: a fixed estimate, and a persistence flag. */
const makeStorage = (init: Options["storage"]): StorageManagerLike => {
  const storage = {
    usage: or(init?.usage, 0),
    quota: or(init?.quota, 1024 ** 3),
    persisted: or(init?.persisted, false),
    grant: or(init?.grantPersistence, true),
  };
  return {
    estimate: () => Promise.resolve({ usage: storage.usage, quota: storage.quota }),
    persisted: () => Promise.resolve(storage.persisted),
    persist: () => {
      storage.persisted = storage.persisted || storage.grant;
      return Promise.resolve(storage.persisted);
    },
  };
};

/** Gives `fake` the Web Share API, answering as `mode` says; none when unsupported. */
const installShare = (
  fake: NavigatorLike,
  mode: NonNullable<Behaviour["share"]>,
  shares: Array<ShareData>,
): void => {
  if (mode === "unsupported") return;
  fake.canShare = () => true;
  fake.share = (data) => {
    if (mode === "abort") return Promise.reject(refusal("AbortError", "Share canceled"));
    if (mode === "deny") {
      return Promise.reject(refusal("NotAllowedError", "No transient activation"));
    }
    shares.push(data ?? {});
    return Promise.resolve();
  };
};

/** Gives `fake` `sendBeacon`, answering as `mode` says; none when unsupported. */
const installBeacon = (
  fake: NavigatorLike,
  mode: NonNullable<Behaviour["beacon"]>,
  beacons: Array<Beacon>,
): void => {
  if (mode === "unsupported") return;
  fake.sendBeacon = (url, data) => {
    if (mode === "reject") return false;
    beacons.push({ url: String(url), data: Option.fromNullishOr(data) });
    return true;
  };
};

/**
 * Builds the in-memory navigator: the `Navigator` service over it and its
 * {@link Control}, sharing one state. {@link layer} wraps this.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const { navigator, control } = TestNavigator.make({ onLine: false })
 * Effect.runPromise(
 *   Effect.gen(function* () {
 *     yield* control.setOnLine(true)
 *     return yield* navigator.onLine
 *   }),
 * ).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const init: Options = options ?? {};
  const events = new EventTarget();
  const shares: Array<ShareData> = [];
  const beacons: Array<Beacon> = [];
  const vibrations: Array<VibratePattern> = [];

  const state: State = {
    onLine: or(init.onLine, true),
    languages: or(init.languages, ["en-US"]),
    connection: init.connection,
    userActivation: init.userActivation,
  };

  const connection =
    state.connection === undefined ? undefined : new TestConnection(() => state.connection);

  const fake: NavigatorLike = {
    userAgent: or(init.userAgent, "TestNavigator"),
    get language() {
      return state.languages[0];
    },
    get languages() {
      return state.languages;
    },
    get onLine() {
      return state.onLine;
    },
    get userActivation() {
      return state.userActivation;
    },
    cookieEnabled: or(init.cookieEnabled, true),
    hardwareConcurrency: or(init.hardwareConcurrency, 4),
    deviceMemory: init.deviceMemory,
    maxTouchPoints: or(init.maxTouchPoints, 0),
    webdriver: or(init.webdriver, false),
    globalPrivacyControl: init.globalPrivacyControl,
    connection,
    storage: makeStorage(init.storage),
    vibrate: (pattern) => {
      vibrations.push(pattern);
      return true;
    },
  };
  installShare(fake, or(init.share, "succeed"), shares);
  installBeacon(fake, or(init.beacon, "queue"), beacons);

  return {
    navigator: makeNavigator({ navigator: fake, events }),
    control: Control.of({
      setOnLine: (onLine) =>
        Effect.sync(() => {
          state.onLine = onLine;
          events.dispatchEvent(new Event(onLine ? "online" : "offline"));
        }),
      setLanguages: (languages) =>
        Effect.sync(() => {
          state.languages = [...languages];
          events.dispatchEvent(new Event("languagechange"));
        }),
      setConnection: (next) =>
        Effect.sync(() => {
          state.connection = next;
          connection?.dispatchEvent(new Event("change"));
        }),
      setUserActivation: (next) =>
        Effect.sync(() => {
          state.userActivation = next;
        }),
      shares: Effect.sync(() => [...shares]),
      beacons: Effect.sync(() => [...beacons]),
      vibrations: Effect.sync(() => [...vibrations]),
    }),
  };
};

/**
 * Provides `Navigator` over a fresh in-memory navigator, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   yield* Navigator.sendBeacon("https://example.com/collect", "bye")
 *   const control = yield* TestNavigator.Control
 *   return (yield* control.beacons).map((beacon) => beacon.url)
 * })
 * Effect.runPromise(Effect.provide(program, TestNavigator.layer())).then(console.log)
 * // ["https://example.com/collect"]
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Navigator | Control> =>
  Layer.syncContext(() => {
    const { navigator, control } = make(options);
    return Context.make(Navigator, navigator).pipe(Context.add(Control, control));
  });
