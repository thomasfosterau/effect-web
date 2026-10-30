/**
 * The Page Visibility API (`document.visibilityState` and its
 * `visibilitychange` event) as an Effect service, with the two combinators
 * a page actually wants from it: wait until the page is visible, and run
 * work only while it is.
 *
 * `hidden` is the last state a page is reliably told about before it is
 * frozen, discarded or closed, so it is the moment to flush state; nothing
 * is guaranteed to run after it. A context with no `document` (a worker, a
 * server render) reads as permanently `visible`.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { watch } from "../internal/dom.ts";
import { ambientDocument } from "../internal/globals.ts";

/**
 * A document's visibility: `"visible"` while any part of it is on screen,
 * `"hidden"` when it is in a background tab, minimised, behind a lock
 * screen, or being unloaded.
 *
 * @since 0.2.0
 * @category models
 */
export type VisibilityState = "visible" | "hidden";

/**
 * The structural slice of `document` this module reads.
 *
 * @since 0.2.0
 * @category models
 */
export interface DocumentLike extends Stream.EventListener {
  readonly visibilityState: DocumentVisibilityState;
}

/**
 * The page-visibility service. Provide {@link layer} in a page, or
 * `TestPageVisibility.layer` from `@thomasfosterau/effect-web/testing` in
 * tests.
 *
 * - `state` — the visibility now.
 * - `changes` — the visibility now, then each change.
 *
 * @since 0.2.0
 * @category services
 */
export class PageVisibility extends Context.Service<
  PageVisibility,
  {
    readonly state: Effect.Effect<VisibilityState>;
    readonly changes: Stream.Stream<VisibilityState>;
  }
>()("@thomasfosterau/effect-web/browser/PageVisibility") {}

// Takes any string, not just `DocumentVisibilityState`: `prerender` (a
// pre-2021 value) and any future value read as hidden, the safe side for
// "may I do visible-only work".
const normalise = (state: string): VisibilityState => (state === "visible" ? "visible" : "hidden");

/**
 * Builds the {@link PageVisibility} service over a document; `undefined`
 * builds the always-visible service. {@link layer} passes the ambient
 * `document`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 *
 * const visibility = PageVisibility.make(undefined)
 * Effect.runPromise(visibility.state).then(console.log) // "visible"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (document: DocumentLike | undefined): PageVisibility["Service"] => {
  if (document === undefined) {
    const visible = Effect.succeed<VisibilityState>("visible");
    return PageVisibility.of({ state: visible, changes: Stream.fromEffect(visible) });
  }
  const read = () => normalise(document.visibilityState);
  return PageVisibility.of({
    state: Effect.sync(read),
    changes: watch(document, ["visibilitychange"], read),
  });
};

/**
 * The {@link PageVisibility} service over the ambient `document`; always
 * `visible` where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 *
 * Effect.runPromise(Effect.provide(PageVisibility.state, PageVisibility.layer)).then(console.log) // "visible"
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<PageVisibility> = Layer.sync(PageVisibility, () =>
  make(ambientDocument()),
);

/**
 * The page's visibility now, from the {@link PageVisibility} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 * import { TestPageVisibility } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(
 *   Effect.provide(PageVisibility.state, TestPageVisibility.layer("hidden")),
 * ).then(console.log) // "hidden"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const state: Effect.Effect<VisibilityState, never, PageVisibility> = Effect.flatMap(
  PageVisibility,
  (visibility) => visibility.state,
);

/**
 * The page's visibility as it changes, from the {@link PageVisibility}
 * service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 * import { TestPageVisibility } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(PageVisibility.changes, 1))
 * Effect.runPromise(Effect.provide(program, TestPageVisibility.layer())).then(console.log) // ["visible"]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const changes: Stream.Stream<VisibilityState, never, PageVisibility> = Stream.unwrap(
  Effect.map(PageVisibility, (visibility) => visibility.changes),
);

/**
 * Completes once the page is visible: at once if it already is, otherwise
 * at the next `visibilitychange` to `visible`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 * import { TestPageVisibility } from "@thomasfosterau/effect-web/testing"
 *
 * const resume = Effect.andThen(PageVisibility.awaitVisible, Effect.succeed("resumed"))
 * Effect.runPromise(Effect.provide(resume, TestPageVisibility.layer())).then(console.log) // "resumed"
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const awaitVisible: Effect.Effect<void, never, PageVisibility> = Effect.flatMap(
  PageVisibility,
  (visibility) =>
    Stream.runHead(Stream.filter(visibility.changes, (now) => now === "visible")).pipe(
      Effect.asVoid,
    ),
);

/**
 * Runs `self` only while the page is visible: started each time the page
 * becomes visible (and at once if it is), interrupted each time it is
 * hidden. The fit for polling, animation and live subscriptions that are
 * wasted on a background tab. Never completes on its own; a failure of
 * `self` fails it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 * import { TestPageVisibility } from "@thomasfosterau/effect-web/testing"
 *
 * const poll = Effect.log("poll").pipe(Effect.repeat({ times: 2 }), Effect.andThen(Effect.never))
 * const program = PageVisibility.whileVisible(poll).pipe(Effect.timeoutOption("10 millis"))
 * Effect.runPromise(Effect.provide(program, TestPageVisibility.layer()))
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const whileVisible = <A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<never, E, R | PageVisibility> =>
  Effect.flatMap(PageVisibility, (visibility) =>
    visibility.changes.pipe(
      Stream.switchMap((now) =>
        now === "visible" ? Stream.drain(Stream.fromEffect(self)) : Stream.empty,
      ),
      Stream.runDrain,
      Effect.andThen(Effect.never),
    ),
  );
