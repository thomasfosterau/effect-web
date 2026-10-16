/**
 * An in-memory `BroadcastChannel` hub for tests of code that uses
 * `./browser`'s `Broadcast`: every channel opened through one hub with the
 * same name reaches every other (never itself), with the platform's
 * structured-clone semantics and asynchronous delivery. {@link Control}
 * records what was posted and injects a message from "another context" —
 * an old deploy's shape, a malformed payload.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  Broadcast,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  make as makeBroadcast,
} from "../browser/broadcast.ts";

/**
 * One message posted on a channel.
 *
 * @since 0.2.0
 * @category models
 */
export interface Posted {
  readonly channel: string;
  readonly message: unknown;
}

/**
 * Drives the in-memory hub.
 *
 * - `posted` — every message posted through the hub, oldest first, as
 *   cloned.
 * - `deliver` — delivers `message` on channel `name` to every open channel
 *   of that name, as if another context had posted it.
 *
 * @since 0.2.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly posted: Effect.Effect<ReadonlyArray<Posted>>;
    readonly deliver: (name: string, message: unknown) => Effect.Effect<void>;
  }
>()("@thomasfosterau/effect-web/testing/BroadcastControl") {}

/**
 * What {@link make} builds: the `Broadcast` service over the in-memory hub,
 * and the {@link Control} that drives it.
 *
 * @since 0.2.0
 * @category models
 */
export interface Fixture {
  readonly broadcast: Broadcast["Service"];
  readonly control: Control["Service"];
}

/**
 * Builds an in-memory hub: the `Broadcast` service over it, and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestBroadcast } from "@thomasfosterau/effect-web/testing"
 *
 * const { broadcast, control } = TestBroadcast.make()
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const channel = yield* broadcast.open("cart")
 *     yield* channel.post({ items: 2 })
 *     return yield* control.posted
 *   }),
 * )
 * Effect.runPromise(program).then(console.log) // [{ channel: "cart", message: { items: 2 } }]
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (): Fixture => {
  const open: Array<{ readonly name: string; readonly channel: EventTarget }> = [];
  const posted: Array<Posted> = [];
  const deliver = (name: string, message: unknown, except: EventTarget | undefined) => {
    queueMicrotask(() => {
      open
        .filter((entry) => entry.name === name && entry.channel !== except)
        .forEach((entry) =>
          entry.channel.dispatchEvent(new MessageEvent("message", { data: message })),
        );
    });
  };
  const factory: BroadcastChannelFactory = (name) => {
    const state = { closed: false };
    const channel: BroadcastChannelLike & EventTarget = Object.assign(new EventTarget(), {
      postMessage: (message: unknown) => {
        if (state.closed) {
          throw new DOMException(`channel '${name}' is closed`, "InvalidStateError");
        }
        // Throws `DataCloneError` for an uncloneable value, as `postMessage` does.
        const clone: unknown = structuredClone(message);
        posted.push({ channel: name, message: clone });
        deliver(name, clone, channel);
      },
      close: () => {
        state.closed = true;
        const index = open.findIndex((entry) => entry.channel === channel);
        if (index !== -1) open.splice(index, 1);
      },
    });
    open.push({ name, channel });
    return channel;
  };
  return {
    broadcast: makeBroadcast(factory),
    control: Control.of({
      posted: Effect.sync(() => [...posted]),
      deliver: (name, message) => Effect.sync(() => deliver(name, message, undefined)),
    }),
  };
};

/**
 * Provides `Broadcast` over a fresh in-memory hub (one per build), and its
 * {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Broadcast } from "@thomasfosterau/effect-web/browser"
 * import { TestBroadcast } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.map(Broadcast.Broadcast, (broadcast) => broadcast.supported)
 * Effect.runPromise(Effect.provide(program, TestBroadcast.layer)).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Broadcast | Control> = Layer.syncContext(() => {
  const { broadcast, control } = make();
  return Context.make(Broadcast, broadcast).pipe(Context.add(Control, control));
});
