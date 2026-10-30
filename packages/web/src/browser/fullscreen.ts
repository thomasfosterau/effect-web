/**
 * The Fullscreen API (`element.requestFullscreen`, `document.fullscreenElement`
 * and `fullscreenchange`) as an Effect service: show an element fullscreen
 * for the lifetime of a `Scope`, and follow which element is fullscreen.
 *
 * The user can leave fullscreen at any time (Esc, a system gesture); that
 * ends fullscreen without closing the scope, and {@link changes} reports
 * it. Closing the scope leaves fullscreen only if the element it entered is
 * still the fullscreen one, so it never undoes a later request.
 *
 * Only the unprefixed API is read. Every current engine ships it (Safari
 * since 16.4); Safari on iPhone has no element fullscreen at all and reads
 * as unsupported. A page that needs WebKit's prefixed API can pass its own
 * {@link DocumentFullscreenLike} to {@link make}.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { reasonOf, settled, watch } from "../internal/dom.ts";
import { ambientDocument } from "../internal/globals.ts";

/**
 * The structural slice of an `Element` this module calls. Every DOM
 * `Element` satisfies it.
 *
 * @since 0.2.0
 * @category models
 */
export interface FullscreenElementLike {
  requestFullscreen(options?: FullscreenOptions): Promise<void>;
}

/**
 * The structural slice of `document` this module uses. `fullscreenElement`
 * is `null` (the platform's own type) when nothing is fullscreen; the
 * service reads it as an `Option`.
 *
 * @since 0.2.0
 * @category models
 */
export interface DocumentFullscreenLike extends Stream.EventListener {
  readonly fullscreenElement: FullscreenElementLike | null;
  readonly fullscreenEnabled?: boolean | undefined;
  exitFullscreen?(): Promise<void>;
}

/**
 * Why fullscreen was not entered.
 *
 * - `Unsupported` — the agent has no Fullscreen API, or the document may
 *   not go fullscreen (`fullscreenEnabled` is `false`: an iframe without
 *   `allowfullscreen`).
 * - `NotAllowed` — refused: no transient user activation (call it from a
 *   click handler), or a permissions policy forbids it. Browsers reject
 *   with a `TypeError` here, which this reads as `NotAllowed`.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type FullscreenErrorReason = "Unsupported" | "NotAllowed" | "Failed";

/**
 * A fullscreen request that was not granted. `cause` carries the browser's
 * rejection, where there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class FullscreenError extends Schema.TaggedError<FullscreenError>()("FullscreenError", {
  reason: Schema.Literals(["Unsupported", "NotAllowed", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const fullscreenError = (reason: FullscreenErrorReason, cause: unknown) =>
  new FullscreenError({ reason, cause, message: `fullscreen: ${reason}` });

const REJECTION_REASONS = {
  TypeError: "NotAllowed",
  NotAllowedError: "NotAllowed",
  SecurityError: "NotAllowed",
  NotSupportedError: "Unsupported",
} satisfies Readonly<Record<string, FullscreenErrorReason>>;

/**
 * The fullscreen service. Provide {@link layer} in a page, or
 * `TestFullscreen.layer` from `@thomasfosterau/effect-web/testing` in
 * tests.
 *
 * - `supported` — whether the document may go fullscreen at all.
 * - `element` — the fullscreen element now; `None` when there is none.
 * - `changes` — the fullscreen element now, then each change.
 * - `enter` — shows `element` fullscreen until the scope closes.
 *
 * @since 0.2.0
 * @category services
 */
export class Fullscreen extends Context.Service<
  Fullscreen,
  {
    readonly supported: boolean;
    readonly element: Effect.Effect<Option.Option<FullscreenElementLike>>;
    readonly changes: Stream.Stream<Option.Option<FullscreenElementLike>>;
    readonly enter: (
      element: FullscreenElementLike,
      options?: FullscreenOptions,
    ) => Effect.Effect<void, FullscreenError, Scope.Scope>;
  }
>()("@thomasfosterau/effect-web/browser/Fullscreen") {}

const unsupported = (): Fullscreen["Service"] =>
  Fullscreen.of({
    supported: false,
    element: Effect.succeed(Option.none()),
    changes: Stream.make(Option.none()),
    enter: () => Effect.fail(fullscreenError("Unsupported", undefined)),
  });

/**
 * Builds the {@link Fullscreen} service over a document; `undefined` (or a
 * document that may not go fullscreen) builds the unsupported service.
 * {@link layer} passes the ambient `document`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Fullscreen } from "@thomasfosterau/effect-web/browser"
 *
 * const fullscreen = Fullscreen.make(undefined)
 * console.log(fullscreen.supported) // false
 * Effect.runPromise(fullscreen.element).then(console.log) // { _id: "Option", _tag: "None" }
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (document: DocumentFullscreenLike | undefined): Fullscreen["Service"] => {
  const exitFullscreen = document?.exitFullscreen?.bind(document);
  if (
    document === undefined ||
    document.fullscreenEnabled !== true ||
    exitFullscreen === undefined
  ) {
    return unsupported();
  }
  const read = () => Option.fromNullishOr(document.fullscreenElement);
  return Fullscreen.of({
    supported: true,
    element: Effect.sync(read),
    changes: watch(document, ["fullscreenchange"], read, Option.makeEquivalence(Object.is)),
    enter: (element, options) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => element.requestFullscreen(options),
          catch: (cause) => fullscreenError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
        }),
        // Only leave fullscreen this request entered: the user may have left
        // already, or a later request may have put another element up.
        () =>
          document.fullscreenElement === element ? settled(() => exitFullscreen()) : Effect.void,
      ),
  });
};

/**
 * The {@link Fullscreen} service over the ambient `document`; reports
 * `supported: false` where there is none, or where it may not go
 * fullscreen.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Fullscreen } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.map(Fullscreen.Fullscreen, (fullscreen) => fullscreen.supported)
 * Effect.runPromise(Effect.provide(program, Fullscreen.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Fullscreen> = Layer.sync(Fullscreen, () => make(ambientDocument()));

/**
 * The fullscreen element now, from the {@link Fullscreen} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Fullscreen } from "@thomasfosterau/effect-web/browser"
 * import { TestFullscreen } from "@thomasfosterau/effect-web/testing"
 *
 * Effect.runPromise(Effect.provide(Fullscreen.element, TestFullscreen.layer())).then(console.log)
 * // { _id: "Option", _tag: "None" }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const element: Effect.Effect<
  Option.Option<FullscreenElementLike>,
  never,
  Fullscreen
> = Effect.flatMap(Fullscreen, (fullscreen) => fullscreen.element);

/**
 * The fullscreen element now, then each change (`fullscreenchange`),
 * including the user leaving fullscreen.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { Fullscreen } from "@thomasfosterau/effect-web/browser"
 * import { TestFullscreen } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Stream.runCollect(Stream.take(Fullscreen.changes, 1))
 * Effect.runPromise(Effect.provide(program, TestFullscreen.layer())).then(console.log)
 * // [{ _id: "Option", _tag: "None" }]
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const changes: Stream.Stream<
  Option.Option<FullscreenElementLike>,
  never,
  Fullscreen
> = Stream.unwrap(Effect.map(Fullscreen, (fullscreen) => fullscreen.changes));

/**
 * Runs `self` with `element` fullscreen, leaving fullscreen however `self`
 * ends (if `element` is still the fullscreen element). Fails with the
 * {@link FullscreenError} when the request is refused, without running
 * `self`. The user leaving fullscreen early does not interrupt `self`;
 * follow {@link changes} where that matters.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Fullscreen } from "@thomasfosterau/effect-web/browser"
 * import { TestFullscreen } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestFullscreen.Control
 *   const video = yield* control.element("video")
 *   return yield* Fullscreen.element.pipe(Fullscreen.withFullscreen(video))
 * })
 * Effect.runPromise(Effect.provide(program, TestFullscreen.layer())).then((now) =>
 *   console.log(now._tag), // "Some"
 * )
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const withFullscreen: {
  (
    element: FullscreenElementLike,
    options?: FullscreenOptions,
  ): <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | FullscreenError, R | Fullscreen>;
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    element: FullscreenElementLike,
    options?: FullscreenOptions,
  ): Effect.Effect<A, E | FullscreenError, R | Fullscreen>;
} = dual(
  (args) => Effect.isEffect(args[0]),
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    element: FullscreenElementLike,
    options?: FullscreenOptions,
  ): Effect.Effect<A, E | FullscreenError, R | Fullscreen> =>
    Effect.flatMap(Fullscreen, (fullscreen) =>
      Effect.scopedWith((scope) =>
        Effect.andThen(Scope.provide(fullscreen.enter(element, options), scope), self),
      ),
    ),
);
