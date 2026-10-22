/**
 * The only place the `./browser` entry reads ambient globals. Every live
 * `layer` reads through here, inside its build (never at import), so the
 * modules stay importable — and their layers buildable — in a server render,
 * a worker or a test runner, where a global may be missing.
 *
 * The DOM lib types these globals as always present; at runtime they are
 * not (reading a missing one off `globalThis` is `undefined`, never a
 * throw), so each read is typed `| undefined` for the caller to narrow.
 */
import * as Predicate from "effect/Predicate";
import type { BatteryManagerLike } from "../browser/battery.ts";
import type { IdleDetectorLike } from "../browser/idle-detection.ts";

/** `globalThis.navigator`, where the context has one. */
export const ambientNavigator = (): Navigator | undefined => globalThis.navigator;

/** `globalThis.document`, where the context has one (a window, not a worker). */
export const ambientDocument = (): Document | undefined => globalThis.document;

/** `globalThis.matchMedia`, bound to `globalThis`, where the context has one. */
export const ambientMatchMedia = (): ((query: string) => MediaQueryList) | undefined => {
  const matchMedia: typeof globalThis.matchMedia | undefined = globalThis.matchMedia;
  return matchMedia === undefined ? undefined : (query) => matchMedia.call(globalThis, query);
};

/** `globalThis.BroadcastChannel`, where the context has one. */
export const ambientBroadcastChannel = (): typeof globalThis.BroadcastChannel | undefined =>
  globalThis.BroadcastChannel;

/**
 * `globalThis` as the event target `online` / `offline` / `languagechange`
 * fire on (the window, or a worker's global scope); `undefined` where it is
 * not one.
 */
export const ambientEventTarget = (): EventTarget | undefined =>
  Predicate.isFunction(globalThis.addEventListener) ? globalThis : undefined;

/** `globalThis.IdleDetector`, where the agent has one (Chromium, in a window or a dedicated worker). */
export const ambientIdleDetector = (): IdleDetectorLike | undefined => {
  // The DOM lib has no `IdleDetector`; the `navigator` member only stops the
  // annotation reading as a weak type (one with no member in common).
  const scope: { readonly IdleDetector?: IdleDetectorLike | undefined } & Pick<
    typeof globalThis,
    "navigator"
  > = globalThis;
  return scope.IdleDetector;
};

/** `navigator.getBattery`, bound to `navigator`, where the agent has it (Chromium). */
export const ambientGetBattery = (): (() => Promise<BatteryManagerLike>) | undefined => {
  // The DOM lib has no `getBattery`; `userAgent` as for `ambientIdleDetector`.
  const navigator:
    | ({ getBattery?: (() => Promise<BatteryManagerLike>) | undefined } & Pick<
        Navigator,
        "userAgent"
      >)
    | undefined = ambientNavigator();
  const getBattery = navigator?.getBattery;
  return getBattery === undefined ? undefined : () => getBattery.call(navigator);
};

/** `globalThis.screen.orientation`, where the context has one (a window, in an agent that ships it). */
export const ambientScreenOrientation = (): ScreenOrientation | undefined => {
  const screen: Screen | undefined = globalThis.screen;
  const orientation: ScreenOrientation | undefined = screen?.orientation;
  return orientation;
};

/** `globalThis.Notification`, where the context has one (a window, or a dedicated worker). */
export const ambientNotification = (): typeof globalThis.Notification | undefined =>
  globalThis.Notification;
