/**
 * Shared plumbing for the `./browser` adapters: reading a `DOMException`'s
 * name off an unknown rejection, turning "a value plus the events that say
 * it changed" into a deduplicated `Stream`, and the promise plumbing the
 * platform's promise-shaped APIs need.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/**
 * Maps a rejection's `DOMException` name onto a reason through `table`;
 * `fallback` for every other name, or a rejection with none. The name is
 * read structurally: a `DOMException` from another realm fails
 * `instanceof`.
 */
export const reasonOf = <Reason extends string>(
  cause: unknown,
  table: Readonly<Partial<Record<string, Reason>>>,
  fallback: Reason,
): Reason =>
  Predicate.hasProperty(cause, "name") && Predicate.isString(cause.name)
    ? (table[cause.name] ?? fallback)
    : fallback;

/**
 * A stream of `read()`: its current value first, then a fresh read each time
 * `target` fires one of `types`, with consecutive equal reads dropped.
 *
 * The listeners are attached before the first read, so a change that lands
 * between subscribing and reading is never lost (the read already sees it).
 * The buffer slides: a slow consumer sees the latest state, never a backlog
 * of stale ones.
 */
export const watch = <A>(
  target: Stream.EventListener,
  types: ReadonlyArray<string>,
  read: () => A,
  isEquivalent: (self: A, that: A) => boolean = Object.is,
): Stream.Stream<A> =>
  Stream.callback<A>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onEvent = (): void => {
            Queue.offerUnsafe(queue, read());
          };
          Arr.forEach(types, (type) => target.addEventListener(type, onEvent));
          Queue.offerUnsafe(queue, read());
          return onEvent;
        }),
        (onEvent) =>
          Effect.sync(() =>
            Arr.forEach(types, (type) => target.removeEventListener(type, onEvent)),
          ),
      ),
    { bufferSize: 16, strategy: "sliding" },
  ).pipe(Stream.changesWith(isEquivalent));

/**
 * Waits for `promise` to settle, either way, never failing: for a promise
 * whose outcome was already reported elsewhere (a lock request whose
 * rejection is a steal), or whose rejection is a documented no-op (releasing
 * a released wake lock).
 */
export const settled = <A>(promise: () => PromiseLike<A>): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    promise().then(
      () => resume(Effect.void),
      () => resume(Effect.void),
    );
  });

/**
 * A pending promise and the function that settles it: what a browser API
 * that holds a resource "for as long as the returned promise is pending"
 * (Web Locks) is handed. `Promise.withResolvers` without its ES2024 floor.
 */
export interface PendingPromise {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

/** Makes a {@link PendingPromise}. */
export const pendingPromise = (): PendingPromise => {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};
