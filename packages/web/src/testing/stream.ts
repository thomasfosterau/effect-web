/**
 * Stream helpers for driving a platform double from a test: start
 * consuming a change stream, then change the platform, then read what the
 * stream saw — without racing the subscription.
 *
 * @since 0.2.0
 */
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

/**
 * Starts collecting the first `count` elements of `stream` in a child
 * fiber, and returns once the stream has emitted its first element (or
 * ended, or failed).
 *
 * Every change stream in `@thomasfosterau/effect-web/browser` emits the
 * current value first, after its listeners are attached, so once this
 * returns, a change driven through a double's `Control` is guaranteed to be
 * observed. Forking and then sleeping guarantees nothing: the child fiber
 * may not have subscribed yet, and the change is lost. Join the returned
 * fiber for the elements.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Fiber from "effect/Fiber"
 * import { Navigator } from "@thomasfosterau/effect-web/browser"
 * import { TestNavigator, observe } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.gen(function* () {
 *   const control = yield* TestNavigator.Control
 *   const seen = yield* observe(Navigator.onLineChanges, 2)
 *   yield* control.setOnLine(false)
 *   return yield* Fiber.join(seen)
 * })
 * Effect.runPromise(Effect.provide(program, TestNavigator.layer())).then(console.log) // [true, false]
 * ```
 *
 * @since 0.2.0
 * @category streams
 */
export const observe = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  count: number,
): Effect.Effect<Fiber.Fiber<ReadonlyArray<A>, E>, never, R> =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkChild(
      Stream.runCollect(
        Stream.take(
          Stream.tap(stream, () => Deferred.succeed(started, undefined)),
          count,
        ),
      ),
    );
    yield* Effect.raceFirst(Deferred.await(started), Effect.asVoid(Fiber.await(fiber)));
    return fiber;
  });
