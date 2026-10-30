/**
 * CSS media queries (`matchMedia`) as an Effect service: whether a query
 * matches now, and a stream of its value as it changes — plus the user
 * preference queries a page most often follows (colour scheme, reduced
 * motion, contrast, reduced data).
 *
 * A context with no `matchMedia` (a worker, a server render) matches
 * nothing: every query reads `false` and never changes.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { watch } from "../internal/dom.ts";
import { ambientMatchMedia } from "../internal/globals.ts";

/**
 * The structural slice of a `MediaQueryList` this module reads.
 *
 * @since 0.2.0
 * @category models
 */
export interface MediaQueryListLike extends Stream.EventListener {
  readonly matches: boolean;
}

/**
 * The structural shape of `window.matchMedia`.
 *
 * @since 0.2.0
 * @category models
 */
export type MatchMediaLike = (query: string) => MediaQueryListLike;

/**
 * The media-query service. Provide {@link layer} in a page, or
 * `TestMediaQuery.layer` from `@thomasfosterau/effect-web/testing` in tests.
 *
 * - `matches` — whether `query` matches now.
 * - `changes` — whether `query` matches now, then each change. Each run
 *   evaluates the query afresh and listens for as long as it is consumed.
 *
 * `query` is a media query list as CSS writes it
 * (`"(min-width: 40rem) and (hover: hover)"`); an unparseable one never
 * matches (the browser's `not all`).
 *
 * @since 0.2.0
 * @category services
 */
export class MediaQuery extends Context.Service<
  MediaQuery,
  {
    readonly matches: (query: string) => Effect.Effect<boolean>;
    readonly changes: (query: string) => Stream.Stream<boolean>;
  }
>()("@thomasfosterau/effect-web/browser/MediaQuery") {}

/**
 * Builds the {@link MediaQuery} service over a `matchMedia`; `undefined`
 * builds the service that matches nothing. {@link layer} passes the ambient
 * `matchMedia`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 *
 * const mediaQuery = MediaQuery.make(undefined)
 * Effect.runPromise(mediaQuery.matches("(prefers-color-scheme: dark)")).then(console.log) // false
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (matchMedia: MatchMediaLike | undefined): MediaQuery["Service"] => {
  if (matchMedia === undefined) {
    const never = Effect.succeed(false);
    return MediaQuery.of({ matches: () => never, changes: () => Stream.fromEffect(never) });
  }
  return MediaQuery.of({
    matches: (query) => Effect.sync(() => matchMedia(query).matches),
    changes: (query) =>
      Stream.unwrap(
        Effect.sync(() => {
          const list = matchMedia(query);
          return watch(list, ["change"], () => list.matches);
        }),
      ),
  });
};

/**
 * The {@link MediaQuery} service over the ambient `matchMedia`; matches
 * nothing where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 *
 * Effect.runPromise(Effect.provide(MediaQuery.matches("print"), MediaQuery.layer)).then(console.log) // false
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<MediaQuery> = Layer.sync(MediaQuery, () =>
  make(ambientMatchMedia()),
);

/**
 * Whether `query` matches now, from the {@link MediaQuery} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const wide = MediaQuery.matches("(min-width: 40rem)")
 * Effect.runPromise(
 *   Effect.provide(wide, TestMediaQuery.layer({ "(min-width: 40rem)": true })),
 * ).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const matches = (query: string): Effect.Effect<boolean, never, MediaQuery> =>
  Effect.flatMap(MediaQuery, (mediaQuery) => mediaQuery.matches(query));

/**
 * Whether `query` matches, as it changes, from the {@link MediaQuery}
 * service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(MediaQuery.changes("(hover: hover)"), 1))
 * Effect.runPromise(Effect.provide(program, TestMediaQuery.layer())).then(console.log) // [false]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const changes = (query: string): Stream.Stream<boolean, never, MediaQuery> =>
  Stream.unwrap(Effect.map(MediaQuery, (mediaQuery) => mediaQuery.changes(query)));

/**
 * The user's colour-scheme preference as it changes: `"dark"` while
 * `(prefers-color-scheme: dark)` matches, otherwise `"light"` (the
 * platform's default when no preference is expressed).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(MediaQuery.colorScheme, 1))
 * Effect.runPromise(
 *   Effect.provide(program, TestMediaQuery.layer({ "(prefers-color-scheme: dark)": true })),
 * ).then(console.log) // ["dark"]
 * ```
 *
 * @since 0.2.0
 * @category preferences
 */
export const colorScheme: Stream.Stream<"light" | "dark", never, MediaQuery> = Stream.map(
  changes("(prefers-color-scheme: dark)"),
  (dark) => (dark ? "dark" : "light"),
);

/**
 * Whether the user asked for reduced motion
 * (`(prefers-reduced-motion: reduce)`), as it changes.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(MediaQuery.reducedMotion, 1))
 * Effect.runPromise(Effect.provide(program, TestMediaQuery.layer())).then(console.log) // [false]
 * ```
 *
 * @since 0.2.0
 * @category preferences
 */
export const reducedMotion: Stream.Stream<boolean, never, MediaQuery> = changes(
  "(prefers-reduced-motion: reduce)",
);

/**
 * Whether the user asked for more contrast (`(prefers-contrast: more)`), as
 * it changes.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(MediaQuery.moreContrast, 1))
 * Effect.runPromise(Effect.provide(program, TestMediaQuery.layer())).then(console.log) // [false]
 * ```
 *
 * @since 0.2.0
 * @category preferences
 */
export const moreContrast: Stream.Stream<boolean, never, MediaQuery> = changes(
  "(prefers-contrast: more)",
);

/**
 * Whether the user asked for reduced data use
 * (`(prefers-reduced-data: reduce)`), as it changes. Few engines implement
 * the query yet; where it is unknown it never matches. The Network
 * Information `saveData` flag (`Navigator`'s `connection`) is the other
 * signal for the same preference.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { MediaQuery } from "@thomasfosterau/effect-web/browser"
 * import { TestMediaQuery } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(MediaQuery.reducedData, 1))
 * Effect.runPromise(Effect.provide(program, TestMediaQuery.layer())).then(console.log) // [false]
 * ```
 *
 * @since 0.2.0
 * @category preferences
 */
export const reducedData: Stream.Stream<boolean, never, MediaQuery> = changes(
  "(prefers-reduced-data: reduce)",
);
