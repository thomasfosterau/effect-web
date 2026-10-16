/**
 * `BroadcastChannel` as an Effect service: a named channel between every
 * same-origin tab, worker and frame, open for the lifetime of a `Scope`,
 * whose messages are decoded and encoded through a `Schema`.
 *
 * A message from another context is untrusted input — another tab may run
 * an older deploy, and a page is not the only thing that can post to the
 * channel — so {@link channel} decodes every one against its schema and
 * drops (logging at warning level) any that do not decode, rather than
 * failing a long-lived stream over one bad message. {@link Broadcast}'s raw
 * `open` hands back undecoded values for a caller that validates itself.
 *
 * A channel never delivers a context's own messages back to it (the
 * platform's rule), and posting structured-clones the encoded value, so it
 * must be cloneable (`DataClone` otherwise).
 *
 * @since 0.2.0
 */
import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { reasonOf } from "../internal/dom.ts";
import { ambientBroadcastChannel } from "../internal/globals.ts";

/**
 * The structural slice of a `BroadcastChannel` this module uses.
 *
 * @since 0.2.0
 * @category models
 */
export interface BroadcastChannelLike extends Stream.EventListener<unknown> {
  postMessage(message: unknown): void;
  close(): void;
}

/**
 * Opens a channel by name: `(name) => new BroadcastChannel(name)` live.
 *
 * @since 0.2.0
 * @category models
 */
export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

/**
 * Why a channel operation failed.
 *
 * - `Unsupported` — the context has no `BroadcastChannel`.
 * - `DataClone` — the (encoded) message cannot be structured-cloned: a
 *   function, a DOM node, a class instance the platform cannot serialise.
 * - `Closed` — the channel's scope has closed.
 * - `Failed` — any other failure; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type BroadcastErrorReason = "Unsupported" | "DataClone" | "Closed" | "Failed";

/**
 * A failed channel operation on the channel `channel`.
 *
 * @since 0.2.0
 * @category errors
 */
export class BroadcastError extends Schema.TaggedError<BroadcastError>()("BroadcastError", {
  channel: Schema.String,
  reason: Schema.Literals(["Unsupported", "DataClone", "Closed", "Failed"]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const broadcastError = (channel: string, reason: BroadcastErrorReason, cause: unknown) =>
  new BroadcastError({ channel, reason, cause, message: `channel '${channel}': ${reason}` });

const REJECTION_REASONS = {
  DataCloneError: "DataClone",
  InvalidStateError: "Closed",
} satisfies Readonly<Record<string, BroadcastErrorReason>>;

/**
 * An open channel carrying undecoded values.
 *
 * - `post` — sends a value to every other context listening on the channel.
 * - `subscribe` — starts listening now, and returns the stream of every
 *   value other contexts post from then on (buffered until consumed), for as
 *   long as the scope is open. The race-free form: a value posted between
 *   subscribing and consuming is kept.
 * - `messages` — the same stream, listening from the moment it is run. Each
 *   run listens independently.
 *
 * A message that fails to deserialise (`messageerror`) is never delivered.
 *
 * @since 0.2.0
 * @category models
 */
export interface RawChannel {
  readonly name: string;
  readonly post: (message: unknown) => Effect.Effect<void, BroadcastError>;
  readonly subscribe: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
  readonly messages: Stream.Stream<unknown>;
}

/**
 * An open channel carrying `A`s, encoded and decoded through a schema.
 *
 * - `publish` — encodes an `A` and posts it.
 * - `subscribe` / `messages` — the `A`s other contexts publish, as on
 *   {@link RawChannel}; a message that does not decode is dropped with a
 *   warning log.
 *
 * @since 0.2.0
 * @category models
 */
export interface Channel<A> {
  readonly name: string;
  readonly publish: (message: A) => Effect.Effect<void, BroadcastError | Schema.SchemaError>;
  readonly subscribe: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>;
  readonly messages: Stream.Stream<A>;
}

/**
 * The broadcast-channel service. Provide {@link layer} in a browser, or
 * `TestBroadcast.layer` from `@thomasfosterau/effect-web/testing` in tests.
 *
 * - `supported` — whether the context has `BroadcastChannel`.
 * - `open` — opens a {@link RawChannel}, closed with its scope.
 *
 * @since 0.2.0
 * @category services
 */
export class Broadcast extends Context.Service<
  Broadcast,
  {
    readonly supported: boolean;
    readonly open: (name: string) => Effect.Effect<RawChannel, BroadcastError, Scope.Scope>;
  }
>()("@thomasfosterau/effect-web/browser/Broadcast") {}

/**
 * Builds the {@link Broadcast} service over a channel factory; `undefined`
 * builds the unsupported service. {@link layer} passes the ambient
 * `BroadcastChannel` constructor.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Broadcast } from "@thomasfosterau/effect-web/browser"
 *
 * const broadcast = Broadcast.make(undefined)
 * Effect.runPromise(Effect.flip(Effect.scoped(broadcast.open("sync")))).then((error) =>
 *   console.log(error.reason), // "Unsupported"
 * )
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (factory: BroadcastChannelFactory | undefined): Broadcast["Service"] => {
  if (factory === undefined) {
    return Broadcast.of({
      supported: false,
      open: (name) => Effect.fail(broadcastError(name, "Unsupported", undefined)),
    });
  }
  return Broadcast.of({
    supported: true,
    open: (name) =>
      Effect.acquireRelease(
        Effect.try({
          try: () => factory(name),
          catch: (cause) =>
            broadcastError(name, reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
        }),
        (channel) => Effect.sync(() => channel.close()),
      ).pipe(
        Effect.map((channel): RawChannel => {
          const subscribe = Effect.fn("Broadcast.subscribe")(function* () {
            const queue = yield* Queue.unbounded<unknown, Cause.Done>();
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                const onMessage = (event: unknown): void => {
                  Queue.offerUnsafe(
                    queue,
                    Predicate.hasProperty(event, "data") ? event.data : undefined,
                  );
                };
                channel.addEventListener("message", onMessage);
                return onMessage;
              }),
              // Ending the queue ends the stream: a consumer outliving the
              // channel's scope completes instead of waiting forever.
              (onMessage) =>
                Effect.sync(() => {
                  channel.removeEventListener("message", onMessage);
                  Queue.endUnsafe(queue);
                }),
            );
            return Stream.fromQueue(queue);
          });
          return {
            name,
            post: (message) =>
              Effect.try({
                try: () => channel.postMessage(message),
                catch: (cause) =>
                  broadcastError(name, reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
              }),
            subscribe: subscribe(),
            messages: Stream.unwrap(subscribe()),
          };
        }),
      ),
  });
};

/**
 * The {@link Broadcast} service over the ambient `BroadcastChannel`; reports
 * `supported: false` where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Broadcast } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.map(Broadcast.Broadcast, (broadcast) => broadcast.supported)
 * Effect.runPromise(Effect.provide(program, Broadcast.layer)).then(console.log) // true under Node 18+
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Broadcast> = Layer.sync(Broadcast, () => {
  const Constructor = ambientBroadcastChannel();
  return make(Constructor === undefined ? undefined : (name) => new Constructor(name));
});

/**
 * Opens the channel `name` carrying `schema`'s values, through the
 * {@link Broadcast} service; closed when the scope closes. The schema's
 * encoded form is what crosses the channel, so it must be
 * structured-cloneable (a `Schema.DateFromMillis` crosses as its epoch
 * milliseconds, a `Schema.Class` as its plain fields), and the schema is the
 * cross-deploy contract: another tab may run an older build.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import * as Stream from "effect/Stream"
 * import { Broadcast } from "@thomasfosterau/effect-web/browser"
 * import { TestBroadcast } from "@thomasfosterau/effect-web/testing"
 *
 * const SignedOut = Schema.Struct({ type: Schema.Literal("signed-out"), at: Schema.Number })
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const tabA = yield* Broadcast.channel("auth", SignedOut)
 *     const tabB = yield* Broadcast.channel("auth", SignedOut)
 *     // Listening from here on: nothing tab A publishes next is missed.
 *     const inbox = yield* tabB.subscribe
 *     yield* tabA.publish({ type: "signed-out", at: 1 })
 *     return yield* Stream.runHead(inbox)
 *   }),
 * )
 * Effect.runPromise(Effect.provide(program, TestBroadcast.layer)).then(console.log)
 * // Some({ type: "signed-out", at: 1 })
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const channel = <A, I>(
  name: string,
  schema: Schema.Codec<A, I>,
): Effect.Effect<Channel<A>, BroadcastError, Broadcast | Scope.Scope> =>
  Effect.flatMap(Broadcast, (broadcast) => broadcast.open(name)).pipe(
    Effect.map((raw): Channel<A> => {
      const encode = Schema.encodeEffect(schema);
      const decode = Schema.decodeUnknownEffect(schema);
      const decoded = (messages: Stream.Stream<unknown>): Stream.Stream<A> =>
        messages.pipe(
          Stream.mapEffect((message) => Effect.result(decode(message))),
          Stream.tap((result) =>
            Result.isFailure(result)
              ? Effect.logWarning(`channel '${name}': dropped a message`, result.failure.message)
              : Effect.void,
          ),
          Stream.filterMap(identity),
        );
      return {
        name,
        publish: (message) => Effect.flatMap(encode(message), raw.post),
        subscribe: Effect.map(raw.subscribe, decoded),
        messages: decoded(raw.messages),
      };
    }),
  );
