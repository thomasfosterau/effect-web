/**
 * Test doubles for `./browser`'s `Locks`: an in-memory lock manager that
 * follows the Web Locks request algorithm (FIFO per name, shared/exclusive
 * compatibility, `ifAvailable`, `steal`, `signal`, `query`), and the layer
 * over it.
 *
 * One manager is one origin. Building several `Locks` services over the same
 * manager (`Locks.make(manager)`, or {@link layer} with a shared
 * `manager`) models several tabs contending for the same locks; each
 * {@link TestLockManager}'s `forClient` view tags its requests with its own
 * `clientId`, as each tab's are in a browser.
 *
 * Rejections are `DOMException`s with the names a browser uses
 * (`NotSupportedError`, `AbortError`), so the adapter under test sees what
 * it would see live.
 *
 * @since 0.2.0
 */
import * as Arr from "effect/Array";
import * as Layer from "effect/Layer";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import {
  type LockInfoLike,
  type LockManagerLike,
  type LockManagerRequestOptions,
  type LockMode,
  Locks,
  make,
} from "../browser/locks.ts";

interface Request {
  readonly name: string;
  readonly mode: LockMode;
  readonly clientId: string;
  readonly callback: (
    lock: { readonly name: string; readonly mode: LockMode } | null,
  ) => Promise<void> | undefined;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
  /** Rejected by a steal: the held callback runs on, its outcome unreported. */
  stolen: boolean;
}

/**
 * An in-memory, origin-wide lock manager: a `LockManagerLike` (what
 * `Locks.make` takes) plus a view per client.
 *
 * @since 0.2.0
 * @category models
 */
export interface TestLockManager extends LockManagerLike {
  /** The `clientId` this view's requests carry. */
  readonly clientId: string;
  /** Another view over the same locks — another tab of the same origin. */
  readonly forClient: (clientId: string) => TestLockManager;
}

const notSupported = (message: string) => new DOMException(message, "NotSupportedError");

const info = ({ name, mode, clientId }: Request): LockInfoLike => ({ name, mode, clientId });

/** The request options the platform refuses outright, as `NotSupportedError`. */
const refusal = (
  name: string,
  mode: LockMode,
  options: LockManagerRequestOptions,
): Option.Option<DOMException> => {
  const steal = options.steal ?? false;
  const ifAvailable = options.ifAvailable ?? false;
  if (name.startsWith("-")) {
    return Option.some(notSupported(`lock names starting with '-' are reserved: '${name}'`));
  }
  if (steal && ifAvailable) {
    return Option.some(notSupported("'steal' and 'ifAvailable' cannot be used together"));
  }
  if (steal && mode !== "exclusive") {
    return Option.some(notSupported("'steal' is only supported for exclusive requests"));
  }
  if (options.signal !== undefined && (steal || ifAvailable)) {
    return Option.some(notSupported("'signal' cannot be used with 'steal' or 'ifAvailable'"));
  }
  return Option.none();
};

/**
 * Builds an empty in-memory lock manager. `clientId` (default `"client-1"`)
 * tags this view's requests in `query` snapshots.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 * import { TestLocks } from "@thomasfosterau/effect-web/testing"
 *
 * const origin = TestLocks.makeLockManager()
 * const tabA = Locks.make(origin)
 * const tabB = Locks.make(origin.forClient("tab-b"))
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     yield* tabA.acquire("leader")
 *     // tab B cannot take the lock while tab A holds it.
 *     return Option.isNone(yield* tabB.tryAcquire("leader"))
 *   }),
 * )
 * Effect.runPromise(program).then(console.log) // true
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const makeLockManager = (
  options?: { readonly clientId?: string | undefined } | undefined,
): TestLockManager => {
  const held: Array<Request> = [];
  const queues = MutableHashMap.empty<string, Array<Request>>();

  const queueOf = (name: string): Array<Request> =>
    Option.getOrElse(MutableHashMap.get(queues, name), () => {
      const created: Array<Request> = [];
      MutableHashMap.set(queues, name, created);
      return created;
    });

  const heldFor = (name: string) => held.filter((request) => request.name === name);

  const compatible = (request: Request): boolean => {
    const current = heldFor(request.name);
    return request.mode === "exclusive"
      ? Arr.isReadonlyArrayEmpty(current)
      : current.every((other) => other.mode === "shared");
  };

  const release = (request: Request): void => {
    const index = held.indexOf(request);
    if (index !== -1) held.splice(index, 1);
    processQueue(request.name);
  };

  const grant = (request: Request): void => {
    held.push(request);
    // A browser runs the callback in a later task, never inside `request`;
    // running it inside `then` also turns a throwing callback into a
    // rejection, as the platform does.
    Promise.resolve()
      .then(() => request.callback({ name: request.name, mode: request.mode }))
      .then(
        () => {
          release(request);
          if (!request.stolen) request.resolve();
        },
        (cause: unknown) => {
          release(request);
          if (!request.stolen) request.reject(cause);
        },
      );
  };

  function processQueue(name: string): void {
    const queue = queueOf(name);
    // FIFO: grant from the front until the first request that must wait, so
    // a queued exclusive request is never starved by later shared ones.
    const next = Arr.head(queue);
    if (Option.isSome(next) && compatible(next.value)) {
      queue.shift();
      grant(next.value);
      processQueue(name);
      return;
    }
    if (Arr.isReadonlyArrayEmpty(queue)) MutableHashMap.remove(queues, name);
  }

  const view = (clientId: string): TestLockManager => ({
    clientId,
    forClient: view,
    request: (name, requestOptions, callback) =>
      new Promise<void>((resolve, reject) => {
        const mode = requestOptions.mode ?? "exclusive";
        const signal = requestOptions.signal;
        const refused = refusal(name, mode, requestOptions);
        if (Option.isSome(refused)) {
          reject(refused.value);
          return;
        }
        if (signal?.aborted === true) {
          reject(signal.reason);
          return;
        }

        const request: Request = {
          name,
          mode,
          clientId,
          callback,
          resolve,
          reject,
          stolen: false,
        };

        if (requestOptions.steal === true) {
          heldFor(name).forEach((victim) => {
            victim.stolen = true;
            held.splice(held.indexOf(victim), 1);
            victim.reject(new DOMException(`lock '${name}' was stolen`, "AbortError"));
          });
          queueOf(name).unshift(request);
          processQueue(name);
          return;
        }

        if (
          requestOptions.ifAvailable === true &&
          !(Arr.isReadonlyArrayEmpty(queueOf(name)) && compatible(request))
        ) {
          Promise.resolve()
            .then(() => callback(null))
            .then(() => resolve(), reject);
          return;
        }

        queueOf(name).push(request);
        signal?.addEventListener(
          "abort",
          () => {
            const queue = queueOf(name);
            const index = queue.indexOf(request);
            if (index === -1) return;
            queue.splice(index, 1);
            reject(signal.reason);
            processQueue(name);
          },
          { once: true },
        );
        processQueue(name);
      }),
    query: () =>
      Promise.resolve({
        held: held.map(info),
        pending: Arr.flatten(Arr.fromIterable(MutableHashMap.values(queues))).map(info),
      }),
  });

  return view(options?.clientId ?? "client-1");
};

/**
 * `Locks` over an in-memory lock manager: a fresh one per build by default,
 * or `manager` to share one origin between several layers (several tabs).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 * import { TestLocks } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Effect.succeed(42).pipe(Locks.withLock("job"))
 * Effect.runPromise(Effect.provide(program, TestLocks.layer())).then(console.log) // 42
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer = (manager?: LockManagerLike | undefined): Layer.Layer<Locks> =>
  Layer.sync(Locks, () => make(manager ?? makeLockManager()));
