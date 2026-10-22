/**
 * A controllable Fullscreen API for tests of code that uses `./browser`'s
 * `Fullscreen`: {@link layer} provides the real adapter over an in-memory
 * document, plus {@link Control} to make elements, grant or refuse
 * requests, and leave fullscreen as the user pressing Esc would. Every
 * change fires `fullscreenchange`, and a refusal `fullscreenerror`, as the
 * browser does.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import {
  Fullscreen,
  type FullscreenElementLike,
  make as makeFullscreen,
} from "../browser/fullscreen.ts";

/**
 * The in-memory document's starting behaviour: `supported` (default
 * `true`) sets `fullscreenEnabled`; `allow` (default `true`) grants
 * requests, and refuses each with a `TypeError` (no user activation) when
 * `false`.
 *
 * @since 0.2.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean | undefined;
  readonly allow?: boolean | undefined;
}

/**
 * An element of the in-memory document, named by `id`.
 *
 * @since 0.2.0
 * @category models
 */
export interface TestElement extends FullscreenElementLike {
  readonly id: string;
}

/**
 * Drives the in-memory document.
 *
 * - `element` — the element named `id` (the same one on every call).
 * - `requests` — how many fullscreen requests were made, refused included.
 * - `setAllowed` — grant (or refuse) later requests.
 * - `exit` — leave fullscreen as the user would (Esc); a no-op when
 *   nothing is fullscreen.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly element: (id: string) => Effect.Effect<TestElement>;
    readonly requests: Effect.Effect<number>;
    readonly setAllowed: (allowed: boolean) => Effect.Effect<void>;
    readonly exit: Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/FullscreenControl") {}

/**
 * What {@link make} builds: the `Fullscreen` service over the in-memory
 * document, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly fullscreen: Fullscreen["Service"];
  readonly control: Control["Service"];
}

interface State {
  allowed: boolean;
  requests: number;
  element: TestElement | null;
}

/** A document whose `fullscreenElement` reads the double's live state. */
class TestDocument extends EventTarget {
  readonly fullscreenEnabled: boolean;
  readonly #state: State;
  constructor(state: State, enabled: boolean) {
    super();
    this.#state = state;
    this.fullscreenEnabled = enabled;
  }
  get fullscreenElement(): TestElement | null {
    return this.#state.element;
  }
  /** Sets the fullscreen element and fires `fullscreenchange` when it changed. */
  show(element: TestElement | null): void {
    if (this.#state.element === element) return;
    this.#state.element = element;
    this.dispatchEvent(new Event("fullscreenchange"));
  }
  exitFullscreen(): Promise<void> {
    if (this.#state.element === null) {
      return Promise.reject(new TypeError("Not in fullscreen"));
    }
    this.show(null);
    return Promise.resolve();
  }
}

/**
 * Builds an in-memory document: the `Fullscreen` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestFullscreen } from "@thomasfosterau/effect-web/testing"
 *
 * const { fullscreen, control } = TestFullscreen.make()
 * const program = Effect.gen(function* () {
 *   const video = yield* control.element("video")
 *   return yield* Effect.scoped(Effect.andThen(fullscreen.enter(video), fullscreen.element))
 * })
 * Effect.runPromise(program).then((now) => console.log(now._tag)) // "Some"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (options?: Options | undefined): Fixture => {
  const state: State = { allowed: options?.allow ?? true, requests: 0, element: null };
  const document = new TestDocument(state, options?.supported ?? true);
  const elements = MutableHashMap.empty<string, TestElement>();
  const element = (id: string): TestElement => {
    const made: TestElement = {
      id,
      requestFullscreen: () => {
        state.requests += 1;
        if (!state.allowed) {
          document.dispatchEvent(new Event("fullscreenerror"));
          return Promise.reject(new TypeError("Permissions check failed"));
        }
        document.show(made);
        return Promise.resolve();
      },
    };
    return made;
  };
  return {
    fullscreen: makeFullscreen(document),
    control: Control.of({
      element: (id) =>
        Effect.sync(() =>
          Option.getOrElse(MutableHashMap.get(elements, id), () => {
            const made = element(id);
            MutableHashMap.set(elements, id, made);
            return made;
          }),
        ),
      requests: Effect.sync(() => state.requests),
      setAllowed: (allowed) =>
        Effect.sync(() => {
          state.allowed = allowed;
        }),
      exit: Effect.sync(() => document.show(null)),
    }),
  };
};

/**
 * Provides `Fullscreen` over a fresh in-memory document, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Fullscreen } from "@thomasfosterau/effect-web/browser"
 * import { TestFullscreen } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFullscreen.Control
 *   const slides = yield* control.element("slides")
 *   return yield* Effect.flip(Effect.scoped(Fullscreen.Fullscreen.use((f) => f.enter(slides))))
 * })
 * Effect.runPromise(Effect.provide(program, TestFullscreen.layer({ allow: false }))).then((error) =>
 *   console.log(error.reason), // "NotAllowed"
 * )
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (options?: Options | undefined): Layer.Layer<Fullscreen | Control> =>
  Layer.syncContext(() => {
    const { fullscreen, control } = make(options);
    return Context.make(Fullscreen, fullscreen).pipe(Context.add(Control, control));
  });
