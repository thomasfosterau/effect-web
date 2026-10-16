/**
 * An in-memory clipboard for tests of code that uses
 * `@effect/platform-browser`'s `Clipboard`: {@link layer} provides
 * `Clipboard` (built with its own `make`) over in-memory contents, plus
 * {@link Control} to read and seed them, or to make every operation fail as
 * a browser does without focus or permission.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clipboard from "@effect/platform-browser/Clipboard";

/**
 * Drives the in-memory clipboard.
 *
 * - `text` — the text contents (`""` after a `write` of items).
 * - `items` — the items last written with `write` (empty after a text
 *   write).
 * - `setText` — seeds the text contents, as the user copying would.
 * - `setDenied` — makes every operation fail (or succeed again).
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly text: Effect.Effect<string>;
    readonly items: Effect.Effect<ClipboardItems>;
    readonly setText: (text: string) => Effect.Effect<void>;
    readonly setDenied: (denied: boolean) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/ClipboardControl") {}

/**
 * What {@link make} builds: the `Clipboard` service over the in-memory
 * contents, and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly clipboard: Clipboard.Clipboard;
  readonly control: Control["Service"];
}

interface State {
  text: string;
  items: ClipboardItems;
  denied: boolean;
}

/**
 * Builds an in-memory clipboard holding `text` (default `""`): the
 * `Clipboard` service over it, and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestClipboard } from "@thomasfosterau/effect-web/testing"
 *
 * const { clipboard, control } = TestClipboard.make()
 * Effect.runPromise(Effect.andThen(clipboard.writeString("copied"), control.text)).then(console.log) // "copied"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (text?: string | undefined): Fixture => {
  const state: State = {
    text: text ?? "",
    items: [],
    denied: false,
  };
  const guarded = <A>(
    operation: string,
    run: () => A,
  ): Effect.Effect<A, Clipboard.ClipboardError> =>
    Effect.suspend(() =>
      state.denied
        ? Effect.fail(
            new Clipboard.ClipboardError({
              message: `Unable to ${operation}`,
              cause: new DOMException("Document is not focused", "NotAllowedError"),
            }),
          )
        : Effect.sync(run),
    );
  return {
    clipboard: Clipboard.make({
      read: guarded("read from clipboard", () => state.items),
      readString: guarded("read a string from clipboard", () => state.text),
      write: (items) =>
        guarded("write to clipboard", () => {
          state.items = items;
          state.text = "";
        }),
      writeString: (next) =>
        guarded("write a string to clipboard", () => {
          state.text = next;
          state.items = [];
        }),
    }),
    control: Control.of({
      text: Effect.sync(() => state.text),
      items: Effect.sync(() => state.items),
      setText: (next) =>
        Effect.sync(() => {
          state.text = next;
          state.items = [];
        }),
      setDenied: (denied) =>
        Effect.sync(() => {
          state.denied = denied;
        }),
    }),
  };
};

/**
 * Provides `Clipboard` over a fresh in-memory clipboard holding `text`, and
 * its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Clipboard from "@effect/platform-browser/Clipboard"
 * import { TestClipboard } from "@thomasfosterau/effect-web/testing"
 *
 * const paste = Effect.flatMap(Clipboard.Clipboard, (clipboard) => clipboard.readString)
 * Effect.runPromise(Effect.provide(paste, TestClipboard.layer("hello"))).then(console.log) // "hello"
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (text?: string | undefined): Layer.Layer<Clipboard.Clipboard | Control> =>
  Layer.syncContext(() => {
    const { clipboard, control } = make(text);
    return Context.make(Clipboard.Clipboard, clipboard).pipe(Context.add(Control, control));
  });
