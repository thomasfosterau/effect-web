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
