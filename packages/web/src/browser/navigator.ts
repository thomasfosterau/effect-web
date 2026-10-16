/**
 * The `navigator` object as an Effect service: what the user agent says
 * about itself (languages, hardware, privacy signals), what changes under a
 * running page (connectivity, preferred languages, the network connection,
 * user activation), and the fire-and-forget platform calls a page makes
 * through it (Web Share, `sendBeacon`, vibration, storage persistence).
 *
 * Every value that can change while the page runs is an `Effect` (read
 * afresh each time it runs) and, where the platform fires an event for it,
 * a `Stream` that emits the current value first and then each change.
 * Every capability the platform may lack degrades instead of throwing: an
 * absent reading is `Option.none()`, an absent call fails
 * {@link NavigatorError} `Unsupported` (or, for the purely advisory
 * `canShare` / `vibrate`, returns `false`).
 *
 * The Permissions, Clipboard and Geolocation members of `navigator` are
 * `@effect/platform-browser`'s services; `./browser`'s `PermissionStatus`
 * module builds on its `Permissions`.
 *
 * @since 0.2.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { reasonOf, watch } from "../internal/dom.ts";
import { ambientEventTarget, ambientNavigator } from "../internal/globals.ts";

/**
 * The structural slice of `navigator.connection` (the Network Information
 * API, Chromium-only) this module reads.
 *
 * @since 0.2.0
 * @category models
 */
export interface NetworkInformationLike extends Stream.EventListener<unknown> {
  readonly type?: string | undefined;
  readonly effectiveType?: string | undefined;
  readonly downlink?: number | undefined;
  readonly rtt?: number | undefined;
  readonly saveData?: boolean | undefined;
}

/**
 * The structural slice of `navigator.storage` this module calls.
 *
 * @since 0.2.0
 * @category models
 */
export interface StorageManagerLike {
  estimate(): Promise<{ readonly usage?: number | undefined; readonly quota?: number | undefined }>;
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

/**
 * The structural slice of `navigator` this module reads. Every member is
 * optional: the browser's `navigator` satisfies it, a worker's
 * `WorkerNavigator` satisfies it, and a test builds only what it needs
 * (`TestNavigator` in `@thomasfosterau/effect-web/testing` builds all of it).
 *
 * @since 0.2.0
 * @category models
 */
export interface NavigatorLike {
  readonly userAgent?: string | undefined;
  readonly language?: string | undefined;
  readonly languages?: ReadonlyArray<string> | undefined;
  readonly onLine?: boolean | undefined;
  readonly cookieEnabled?: boolean | undefined;
  readonly hardwareConcurrency?: number | undefined;
  readonly maxTouchPoints?: number | undefined;
  readonly pdfViewerEnabled?: boolean | undefined;
  readonly webdriver?: boolean | undefined;
  readonly deviceMemory?: number | undefined;
  readonly globalPrivacyControl?: boolean | undefined;
  readonly connection?: NetworkInformationLike | undefined;
  readonly userActivation?:
    | { readonly isActive: boolean; readonly hasBeenActive: boolean }
    | undefined;
  readonly storage?: StorageManagerLike | undefined;
  share?(data?: ShareData): Promise<void>;
  canShare?(data?: ShareData): boolean;
  vibrate?(pattern: VibratePattern): boolean;
  sendBeacon?(url: string | URL, data?: BodyInit | null): boolean;
}

/**
 * What {@link make} reads: the navigator, and the event target its
 * `online` / `offline` / `languagechange` events fire on (the window, or a
 * worker's global scope). Without `events` the change streams emit the
 * current value and then nothing.
 *
 * @since 0.2.0
 * @category models
 */
export interface NavigatorEnvironment {
  readonly navigator: NavigatorLike | undefined;
  readonly events: Stream.EventListener<unknown> | undefined;
}

/**
 * The user agent's description of itself, read once per run of
 * {@link Navigator}'s `info`.
 *
 * - `languages` — preferred languages, most preferred first; empty when the
 *   agent reports none.
 * - `hardwareConcurrency` — logical processors available to the page.
 * - `deviceMemoryGiB` — approximate device RAM in GiB, rounded and capped by
 *   the browser (Chromium only).
 * - `maxTouchPoints` — simultaneous touch contacts supported (`0`: none).
 * - `globalPrivacyControl` — the user's Global Privacy Control signal, where
 *   the browser exposes one.
 * - `webdriver` — whether the agent reports being automation-controlled.
 *
 * @since 0.2.0
 * @category models
 */
export interface NavigatorInfo {
  readonly userAgent: string;
  readonly languages: ReadonlyArray<string>;
  readonly hardwareConcurrency: Option.Option<number>;
  readonly deviceMemoryGiB: Option.Option<number>;
  readonly maxTouchPoints: number;
  readonly cookieEnabled: boolean;
  readonly pdfViewerEnabled: Option.Option<boolean>;
  readonly webdriver: boolean;
  readonly globalPrivacyControl: Option.Option<boolean>;
}

/**
 * The network connection as the Network Information API estimates it.
 * `downlinkMbps` is effective bandwidth in megabits per second and `rttMs`
 * the round-trip estimate in milliseconds, both rounded by the browser;
 * `saveData` is the user's reduced-data preference.
 *
 * @since 0.2.0
 * @category models
 */
export interface ConnectionInfo {
  readonly type: Option.Option<string>;
  readonly effectiveType: Option.Option<string>;
  readonly downlinkMbps: Option.Option<number>;
  readonly rttMs: Option.Option<number>;
  readonly saveData: boolean;
}

/**
 * The page's user-activation state: `isActive` while a recent gesture's
 * transient activation lasts (what `share`, fullscreen and popups require),
 * `hasBeenActive` once the user has interacted with the page at all (what
 * autoplay keys on).
 *
 * @since 0.2.0
 * @category models
 */
export interface UserActivationState {
  readonly isActive: boolean;
  readonly hasBeenActive: boolean;
}

/**
 * The origin's storage usage and quota, in bytes, from
 * `navigator.storage.estimate()`. Both are estimates, deliberately
 * imprecise (padded against cross-origin size probing).
 *
 * @since 0.2.0
 * @category models
 */
export interface StorageEstimate {
  readonly usageBytes: Option.Option<number>;
  readonly quotaBytes: Option.Option<number>;
}

/**
 * The navigator call that failed.
 *
 * @since 0.2.0
 * @category errors
 */
export type NavigatorOperation =
  | "share"
  | "sendBeacon"
  | "storage.estimate"
  | "storage.persisted"
  | "storage.persist";

/**
 * Why a navigator call failed.
 *
 * - `Unsupported` — the agent lacks the API.
 * - `NotAllowed` — refused by policy: no transient user activation, a
 *   permissions policy, an insecure context.
 * - `Aborted` — the user dismissed the share sheet. Usually not an error
 *   worth reporting; `Effect.catchTag` it.
 * - `InvalidData` — the browser refused the data (an unshareable payload, an
 *   unparseable beacon URL).
 * - `InvalidState` — a share is already in progress, or the document is not
 *   fully active.
 * - `Rejected` — `sendBeacon` declined to queue the beacon (the payload is
 *   over the agent's beacon quota).
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type NavigatorErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "Aborted"
  | "InvalidData"
  | "InvalidState"
  | "Rejected"
  | "Failed";

/**
 * A failed navigator call. `cause` carries the browser's rejection, where
 * there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class NavigatorError extends Schema.TaggedError<NavigatorError>()("NavigatorError", {
  operation: Schema.Literals([
    "share",
    "sendBeacon",
    "storage.estimate",
    "storage.persisted",
    "storage.persist",
  ]),
  reason: Schema.Literals([
    "Unsupported",
    "NotAllowed",
    "Aborted",
    "InvalidData",
    "InvalidState",
    "Rejected",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const navigatorError = (
  operation: NavigatorOperation,
  reason: NavigatorErrorReason,
  cause: unknown,
) => new NavigatorError({ operation, reason, cause, message: `navigator ${operation}: ${reason}` });

const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  AbortError: "Aborted",
  DataError: "InvalidData",
  TypeError: "InvalidData",
  InvalidStateError: "InvalidState",
} satisfies Readonly<Record<string, NavigatorErrorReason>>;

/**
 * The navigator service. Provide {@link layer} in a browser or a worker, or
 * `TestNavigator.layer` from `@thomasfosterau/effect-web/testing` in tests.
 *
 * - `info` — the agent's self-description ({@link NavigatorInfo}).
 * - `languages` / `languageChanges` — preferred languages, now and as they
 *   change (`languagechange`).
 * - `onLine` / `onLineChanges` — whether the agent believes it has a network
 *   (`online` / `offline`). `false` is reliable; `true` only means "not
 *   known to be offline". An agent that does not say reads as online.
 * - `connection` / `connectionChanges` — the {@link ConnectionInfo}
 *   estimate; `None` / an empty stream where the API is missing.
 * - `userActivation` — {@link UserActivationState}; `None` where missing.
 * - `canShare` / `share` — the Web Share API. `canShare` is `false` where
 *   sharing is missing.
 * - `sendBeacon` — queues a POST that survives the page unloading; fails
 *   `Rejected` when the agent declines it.
 * - `vibrate` — `true` when a vibration was scheduled; `false` where the
 *   API is missing or the agent declined.
 * - `storage` — the origin's {@link StorageEstimate}, and whether its
 *   storage is (or may be made) persistent: exempt from eviction under
 *   storage pressure.
 *
 * @since 0.2.0
 * @category services
 */
export class Navigator extends Context.Service<
  Navigator,
  {
    readonly info: Effect.Effect<NavigatorInfo>;
    readonly languages: Effect.Effect<ReadonlyArray<string>>;
    readonly languageChanges: Stream.Stream<ReadonlyArray<string>>;
    readonly onLine: Effect.Effect<boolean>;
    readonly onLineChanges: Stream.Stream<boolean>;
    readonly connection: Effect.Effect<Option.Option<ConnectionInfo>>;
    readonly connectionChanges: Stream.Stream<ConnectionInfo>;
    readonly userActivation: Effect.Effect<Option.Option<UserActivationState>>;
    readonly canShare: (data: ShareData) => Effect.Effect<boolean>;
    readonly share: (data: ShareData) => Effect.Effect<void, NavigatorError>;
    readonly sendBeacon: (
      url: string | URL,
      data?: BodyInit | undefined,
    ) => Effect.Effect<void, NavigatorError>;
    readonly vibrate: (pattern: VibratePattern) => Effect.Effect<boolean>;
    readonly storage: {
      readonly estimate: Effect.Effect<StorageEstimate, NavigatorError>;
      readonly persisted: Effect.Effect<boolean, NavigatorError>;
      readonly persist: Effect.Effect<boolean, NavigatorError>;
    };
  }
>()("@thomasfosterau/effect-web/browser/Navigator") {}

const readLanguages = (navigator: NavigatorLike | undefined): ReadonlyArray<string> =>
  Arr.match(navigator?.languages ?? [], {
    onNonEmpty: (languages) => [...languages],
    onEmpty: () => {
      const language = navigator?.language;
      return language === undefined || language === "" ? [] : [language];
    },
  });

const sameLanguages = (self: ReadonlyArray<string>, that: ReadonlyArray<string>): boolean =>
  self.length === that.length && self.every((language, index) => language === that[index]);

const readConnection = (connection: NetworkInformationLike): ConnectionInfo => ({
  type: Option.fromUndefinedOr(connection.type),
  effectiveType: Option.fromUndefinedOr(connection.effectiveType),
  downlinkMbps: Option.fromUndefinedOr(connection.downlink),
  rttMs: Option.fromUndefinedOr(connection.rtt),
  saveData: connection.saveData ?? false,
});

const sameConnection = (self: ConnectionInfo, that: ConnectionInfo): boolean =>
  Option.getOrUndefined(self.type) === Option.getOrUndefined(that.type) &&
  Option.getOrUndefined(self.effectiveType) === Option.getOrUndefined(that.effectiveType) &&
  Option.getOrUndefined(self.downlinkMbps) === Option.getOrUndefined(that.downlinkMbps) &&
  Option.getOrUndefined(self.rttMs) === Option.getOrUndefined(that.rttMs) &&
  self.saveData === that.saveData;

/** A stream of `read()` that never changes: the value, then nothing. */
const constant = <A>(read: () => A): Stream.Stream<A> => Stream.fromEffect(Effect.sync(read));

const tryCall = <A>(
  operation: NavigatorOperation,
  call: (() => Promise<A>) | undefined,
): Effect.Effect<A, NavigatorError> =>
  call === undefined
    ? Effect.fail(navigatorError(operation, "Unsupported", undefined))
    : Effect.tryPromise({
        try: call,
        catch: (cause) =>
          navigatorError(operation, reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
      });

/**
 * Builds the {@link Navigator} service over a navigator and the event target
 * its connectivity and language events fire on. {@link layer} passes the
 * ambient `navigator` and `globalThis`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 *
 * const navigator = Navigator.make({
 *   navigator: { userAgent: "Example/1.0", languages: ["en-AU", "en"], onLine: true },
 *   events: undefined,
 * })
 * Effect.runPromise(navigator.info).then((info) => console.log(info.languages)) // ["en-AU", "en"]
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (environment: NavigatorEnvironment): Navigator["Service"] => {
  const { navigator, events } = environment;
  const languagesNow = () => readLanguages(navigator);
  const onLineNow = () => navigator?.onLine ?? true;
  const connection = navigator?.connection;
  const storage = navigator?.storage;
  // Bound once: the platform's methods throw `Illegal invocation` off
  // `navigator`, and a bound reference keeps its narrowing inside closures.
  const shareNow = navigator?.share?.bind(navigator);
  const canShareNow = navigator?.canShare?.bind(navigator);
  const vibrateNow = navigator?.vibrate?.bind(navigator);
  const sendBeaconNow = navigator?.sendBeacon?.bind(navigator);

  return Navigator.of({
    info: Effect.sync(() => ({
      userAgent: navigator?.userAgent ?? "",
      languages: languagesNow(),
      hardwareConcurrency: Option.fromUndefinedOr(navigator?.hardwareConcurrency),
      deviceMemoryGiB: Option.fromUndefinedOr(navigator?.deviceMemory),
      maxTouchPoints: navigator?.maxTouchPoints ?? 0,
      cookieEnabled: navigator?.cookieEnabled ?? false,
      pdfViewerEnabled: Option.fromUndefinedOr(navigator?.pdfViewerEnabled),
      webdriver: navigator?.webdriver ?? false,
      globalPrivacyControl: Option.fromUndefinedOr(navigator?.globalPrivacyControl),
    })),
    languages: Effect.sync(languagesNow),
    languageChanges:
      events === undefined
        ? constant(languagesNow)
        : watch(events, ["languagechange"], languagesNow, sameLanguages),
    onLine: Effect.sync(onLineNow),
    onLineChanges:
      events === undefined ? constant(onLineNow) : watch(events, ["online", "offline"], onLineNow),
    connection: Effect.sync(() => Option.map(Option.fromUndefinedOr(connection), readConnection)),
    connectionChanges:
      connection === undefined
        ? Stream.empty
        : watch(connection, ["change"], () => readConnection(connection), sameConnection),
    userActivation: Effect.sync(() =>
      Option.map(Option.fromUndefinedOr(navigator?.userActivation), (activation) => ({
        isActive: activation.isActive,
        hasBeenActive: activation.hasBeenActive,
      })),
    ),
    canShare: (data) =>
      Effect.sync(() => (canShareNow === undefined ? shareNow !== undefined : canShareNow(data))),
    share: (data) => tryCall("share", shareNow === undefined ? undefined : () => shareNow(data)),
    sendBeacon: (url, data) =>
      sendBeaconNow === undefined
        ? Effect.fail(navigatorError("sendBeacon", "Unsupported", undefined))
        : Effect.try({
            try: () => sendBeaconNow(url, data),
            catch: (cause) =>
              navigatorError("sendBeacon", reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
          }).pipe(
            Effect.flatMap((queued) =>
              queued
                ? Effect.void
                : Effect.fail(navigatorError("sendBeacon", "Rejected", undefined)),
            ),
          ),
    vibrate: (pattern) => Effect.sync(() => vibrateNow !== undefined && vibrateNow(pattern)),
    storage: {
      estimate: tryCall(
        "storage.estimate",
        storage === undefined ? undefined : () => storage.estimate(),
      ).pipe(
        Effect.map((estimate) => ({
          usageBytes: Option.fromUndefinedOr(estimate.usage),
          quotaBytes: Option.fromUndefinedOr(estimate.quota),
        })),
      ),
      persisted: tryCall(
        "storage.persisted",
        storage === undefined ? undefined : () => storage.persisted(),
      ),
      persist: tryCall(
        "storage.persist",
        storage === undefined ? undefined : () => storage.persist(),
      ),
    },
  });
};

/**
 * The {@link Navigator} service over the ambient `navigator`, with
 * connectivity and language events read off `globalThis` (the window, or a
 * worker's global scope). Builds anywhere: where there is no `navigator`
 * every reading takes its documented default.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 *
 * Effect.runPromise(Effect.provide(Navigator.onLine, Navigator.layer)).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Navigator> = Layer.sync(Navigator, () =>
  make({
    navigator: ambientNavigator(),
    events: ambientEventTarget(),
  }),
);

/**
 * The agent's {@link NavigatorInfo}, from the {@link Navigator} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.map(Navigator.info, (info) => info.hardwareConcurrency)
 * Effect.runPromise(
 *   Effect.provide(program, TestNavigator.layer({ hardwareConcurrency: 8 })),
 * ).then(console.log) // Some(8)
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const info: Effect.Effect<NavigatorInfo, never, Navigator> = Effect.flatMap(
  Navigator,
  (navigator) => navigator.info,
);

/**
 * Whether the agent believes it is online, from the {@link Navigator}
 * service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(Navigator.onLine, TestNavigator.layer({ onLine: false })),
 * ).then(console.log) // false
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const onLine: Effect.Effect<boolean, never, Navigator> = Effect.flatMap(
  Navigator,
  (navigator) => navigator.onLine,
);

/**
 * Connectivity as it changes, from the {@link Navigator} service: the
 * current value, then each flip.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(Navigator.onLineChanges, 1))
 * Effect.runPromise(Effect.provide(program, TestNavigator.layer())).then(console.log) // [true]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const onLineChanges: Stream.Stream<boolean, never, Navigator> = Stream.unwrap(
  Effect.map(Navigator, (navigator) => navigator.onLineChanges),
);

/**
 * Completes once the agent is online: at once if it already is, otherwise
 * at the next `online` event. The gate for work queued while offline.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const flush = Effect.andThen(Navigator.awaitOnLine, Effect.succeed("flushed"))
 * Effect.runPromise(Effect.provide(flush, TestNavigator.layer())).then(console.log) // "flushed"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const awaitOnLine: Effect.Effect<void, never, Navigator> = Effect.flatMap(
  Navigator,
  (navigator) =>
    Stream.runHead(Stream.filter(navigator.onLineChanges, (online) => online)).pipe(Effect.asVoid),
);

/**
 * Preferred languages as they change, from the {@link Navigator} service:
 * the current list, then each new one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(Navigator.languageChanges, 1))
 * Effect.runPromise(
 *   Effect.provide(program, TestNavigator.layer({ languages: ["fr-CA", "fr"] })),
 * ).then(console.log) // [["fr-CA", "fr"]]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const languageChanges: Stream.Stream<
  ReadonlyArray<string>,
  never,
  Navigator
> = Stream.unwrap(Effect.map(Navigator, (navigator) => navigator.languageChanges));

/**
 * Opens the platform share sheet, through the {@link Navigator} service.
 * Requires transient user activation: call it from a click handler's
 * effect, or it fails `NotAllowed`. A dismissed sheet fails `Aborted`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Navigator.share({ title: "Effect", url: "https://effect.website" }).pipe(
 *   Effect.catchTag("NavigatorError", (error) =>
 *     error.reason === "Aborted" ? Effect.void : Effect.fail(error),
 *   ),
 * )
 * Effect.runPromise(Effect.provide(program, TestNavigator.layer()))
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const share = (data: ShareData): Effect.Effect<void, NavigatorError, Navigator> =>
  Effect.flatMap(Navigator, (navigator) => navigator.share(data));

/**
 * Queues a beacon (a small POST that outlives the page), through the
 * {@link Navigator} service. The fit for analytics and session-end reports
 * sent from `pagehide` / `visibilitychange`; fails `Rejected` when the agent
 * declines to queue it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Navigator.sendBeacon("https://example.com/collect", "event=exit")
 * Effect.runPromise(Effect.provide(program, TestNavigator.layer()))
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const sendBeacon = (
  url: string | URL,
  data?: BodyInit | undefined,
): Effect.Effect<void, NavigatorError, Navigator> =>
  Effect.flatMap(Navigator, (navigator) => navigator.sendBeacon(url, data));
