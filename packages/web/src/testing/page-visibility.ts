/**
 * A controllable document visibility for tests of code that uses
 * `./browser`'s `PageVisibility`: {@link layer} provides the real adapter
 * over an in-memory document, plus {@link Control} to hide and show it.
 * Changes fire `visibilitychange`, as the browser does.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  make as makePageVisibility,
  PageVisibility,
  type VisibilityState,
} from "../browser/page-visibility.ts";

/**
 * Drives the in-memory document: `set` changes its visibility and fires
 * `visibilitychange` (a no-op when the state is unchanged, as in a browser).
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  { readonly set: (state: VisibilityState) => Effect.Effect<void> }
>()("@thomasfosterau/effect-web/testing/PageVisibilityControl") {}

/**
 * What {@link make} builds: the `PageVisibility` service over the in-memory
 * document, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly visibility: PageVisibility["Service"];
  readonly control: Control["Service"];
}

/** A document whose `visibilityState` reads the double's live state. */
class TestDocument extends EventTarget {
  readonly #read: () => DocumentVisibilityState;
  constructor(read: () => DocumentVisibilityState) {
    super();
    this.#read = read;
  }
  get visibilityState(): DocumentVisibilityState {
    return this.#read();
  }
}

/**
 * Builds an in-memory document in the `initial` state (default
 * `"visible"`): the `PageVisibility` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestPageVisibility } from "@thomasfosterau/effect-web/testing"
 *
 * const { visibility, control } = TestPageVisibility.make()
 * Effect.runPromise(Effect.andThen(control.set("hidden"), visibility.state)).then(console.log) // "hidden"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (initial: VisibilityState = "visible"): Fixture => {
  const state = { current: initial };
  const document = new TestDocument(() => state.current);
  return {
    visibility: makePageVisibility(document),
    control: Control.of({
      set: (next) =>
        Effect.sync(() => {
          if (state.current === next) return;
          state.current = next;
          document.dispatchEvent(new Event("visibilitychange"));
        }),
    }),
  };
};

/**
 * Provides `PageVisibility` over a fresh in-memory document in the
 * `initial` state (default `"visible"`), and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { PageVisibility } from "@thomasfosterau/effect-web/browser"
 * import { TestPageVisibility } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestPageVisibility.Control
 *   yield* control.set("hidden")
 *   return yield* PageVisibility.state
 * })
 * Effect.runPromise(Effect.provide(program, TestPageVisibility.layer())).then(console.log) // "hidden"
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (initial?: VisibilityState): Layer.Layer<PageVisibility | Control> =>
  Layer.syncContext(() => {
    const { visibility, control } = make(initial);
    return Context.make(PageVisibility, visibility).pipe(Context.add(Control, control));
  });
