/**
 * A controllable `matchMedia` for tests of code that uses `./browser`'s
 * `MediaQuery`: {@link layer} provides the real adapter over an in-memory
 * `matchMedia`, plus {@link Control} to make a query start or stop
 * matching. Changes fire `change` on every list for the query, as the
 * browser does.
 *
 * The in-memory `matchMedia` does not evaluate CSS: a query matches exactly
 * when it was set to (or started) matching, compared as the same string.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import { type MatchMediaLike, make as makeMediaQuery, MediaQuery } from "../browser/media-query.ts";

/**
 * Drives the in-memory `matchMedia`: `set` makes `query` match (or not) and
 * fires `change` on its lists when that changes the answer.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  { readonly set: (query: string, matches: boolean) => Effect.Effect<void> }
>()("@thomasfosterau/effect-web/testing/MediaQueryControl") {}

/**
 * What {@link make} builds: the `MediaQuery` service over the in-memory
 * `matchMedia`, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly mediaQuery: MediaQuery["Service"];
  readonly control: Control["Service"];
}

/** A media query list whose `matches` reads the double's live state. */
class TestMediaQueryList extends EventTarget {
  readonly #read: () => boolean;
  constructor(read: () => boolean) {
    super();
    this.#read = read;
  }
  get matches(): boolean {
    return this.#read();
  }
}

/**
 * Builds an in-memory `matchMedia` where the queries `initial` maps to
 * `true` match and every other query does not: the `MediaQuery` service
 * over it, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const { mediaQuery, control } = TestMediaQuery.make()
 * Effect.runPromise(
 *   Effect.andThen(control.set("(orientation: portrait)", true), mediaQuery.matches("(orientation: portrait)")),
 * ).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (initial?: Readonly<Record<string, boolean>>): Fixture => {
  const matching = MutableHashMap.fromIterable(Record.toEntries(initial ?? {}));
  const matchesNow = (query: string) =>
    Option.getOrElse(MutableHashMap.get(matching, query), () => false);
  const lists: Array<{ readonly query: string; readonly list: EventTarget }> = [];
  const matchMedia: MatchMediaLike = (query) => {
    const list = new TestMediaQueryList(() => matchesNow(query));
    lists.push({ query, list });
    return list;
  };
  return {
    mediaQuery: makeMediaQuery(matchMedia),
    control: Control.of({
      set: (query, matches) =>
        Effect.sync(() => {
          if (matchesNow(query) === matches) return;
          MutableHashMap.set(matching, query, matches);
          lists
            .filter((entry) => entry.query === query)
            .forEach((entry) => entry.list.dispatchEvent(new Event("change")));
        }),
    }),
  };
};

/**
 * Provides `MediaQuery` over a fresh in-memory `matchMedia` (see
 * {@link make} for `initial`), and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const dark = MediaQuery.matches("(prefers-color-scheme: dark)")
 * Effect.runPromise(
 *   Effect.provide(dark, TestMediaQuery.layer({ "(prefers-color-scheme: dark)": true })),
 * ).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (
  initial?: Readonly<Record<string, boolean>>,
): Layer.Layer<MediaQuery | Control> =>
  Layer.syncContext(() => {
    const { mediaQuery, control } = make(initial);
    return Context.make(MediaQuery, mediaQuery).pipe(Context.add(Control, control));
  });
