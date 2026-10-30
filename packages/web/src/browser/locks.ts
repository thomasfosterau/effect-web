/**
 * The Web Locks API (`navigator.locks`) as an Effect service: a named lock,
 * shared across every tab, worker and frame of one origin, held for exactly
 * the lifetime of a `Scope`.
 *
 * The browser API holds a lock for as long as the promise its callback
 * returns stays pending; here that promise is the `Scope`. {@link Locks}'
 * `acquire` grants a {@link HeldLock} that is released when its scope closes
 * (normally, on failure or on interruption), and {@link withLock} runs an
 * effect under a lock. Waiting is interruptible: interrupting a fiber queued
 * for a lock withdraws its request (the request's `AbortSignal`), and a lock
 * granted to a fiber that was interrupted in the same instant is released at
 * once rather than leaked.
 *
 * Every failure is a {@link LockError}; a lock stolen by another context's
 * `steal` request surfaces through {@link HeldLock}'s `stolen`, and
 * {@link withLock} interrupts the guarded effect with a `Stolen` failure.
 *
 * @since 0.2.0
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { pendingPromise, reasonOf, settled } from "../internal/dom.ts";
import { ambientNavigator } from "../internal/globals.ts";

/**
 * A lock's mode. Any number of `"shared"` holders may hold a lock together;
 * an `"exclusive"` holder holds it alone. The browser's default is
 * `"exclusive"`, and so is this module's.
 *
 * @since 0.2.0
 * @category models
 */
export type LockMode = "exclusive" | "shared";

/**
 * Options for {@link Locks}' `acquire` and {@link withLock}.
 *
 * `steal` takes the lock at once, releasing it from every current holder
 * (their {@link HeldLock}'s `stolen` completes) — a recovery tool for a
 * holder that is known to be wedged, never a way to skip the queue. A steal
 * is exclusive only; with `mode: "shared"` it fails `InvalidRequest`.
 *
 * @since 0.2.0
 * @category models
 */
export interface LockOptions {
  readonly mode?: LockMode | undefined;
  readonly steal?: boolean | undefined;
}

/**
 * A lock granted to this context, held until the `Scope` it was acquired in
 * closes.
 *
 * @since 0.2.0
 * @category models
 */
export interface HeldLock {
  /** The lock's name. */
  readonly name: string;
  /** The mode it was granted in. */
  readonly mode: LockMode;
  /**
   * Completes if another context steals the lock. From then on the lock is
   * no longer held, though the scope that acquired it is still open.
   */
  readonly stolen: Effect.Effect<void>;
}

/**
 * One entry of a {@link LockSnapshot}: a held or a pending request.
 *
 * @since 0.2.0
 * @category models
 */
export interface LockInfo {
  readonly name: string;
  readonly mode: LockMode;
  /** The requesting context's id, where the browser reports one. */
  readonly clientId: Option.Option<string>;
}

/**
 * The origin's lock state at one instant, from {@link Locks}' `query`: the
 * locks currently held and the requests queued for one. For diagnostics —
 * it is stale as soon as it is read, so never decide whether to acquire
 * from it (`tryAcquire` is the atomic form).
 *
 * @since 0.2.0
 * @category models
 */
export interface LockSnapshot {
  readonly held: ReadonlyArray<LockInfo>;
  readonly pending: ReadonlyArray<LockInfo>;
}

/**
 * Why a lock operation failed.
 *
 * - `Unsupported` — the context has no `navigator.locks` (an insecure
 *   context, an old browser, a server).
 * - `Stolen` — another context stole the lock while {@link withLock} held it.
 * - `InvalidRequest` — the browser refused the request's shape: a name
 *   starting with `-` (reserved), or `steal` with `mode: "shared"`.
 * - `NotAllowed` — the origin may not use locks (`SecurityError`: an opaque
 *   origin, storage access denied).
 * - `InvalidState` — the document is not fully active.
 * - `Failed` — any other rejection; `cause` carries it.
 *
 * @since 0.2.0
 * @category errors
 */
export type LockErrorReason =
  | "Unsupported"
  | "Stolen"
  | "InvalidRequest"
  | "NotAllowed"
  | "InvalidState"
  | "Failed";

/**
 * A failed lock operation. `lock` names the lock (`None` for `query`);
 * `cause` carries the browser's rejection, where there was one.
 *
 * @since 0.2.0
 * @category errors
 */
export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  lock: Schema.Option(Schema.String),
  reason: Schema.Literals([
    "Unsupported",
    "Stolen",
    "InvalidRequest",
    "NotAllowed",
    "InvalidState",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const lockError = (lock: Option.Option<string>, reason: LockErrorReason, cause: unknown) =>
  new LockError({
    lock,
    reason,
    cause,
    message: Option.match(lock, {
      onNone: () => `lock query failed: ${reason}`,
      onSome: (name) => `lock '${name}': ${reason}`,
    }),
  });

const REJECTION_REASONS = {
  NotSupportedError: "InvalidRequest",
  SecurityError: "NotAllowed",
  InvalidStateError: "InvalidState",
} satisfies Readonly<Record<string, LockErrorReason>>;

/**
 * The options object `navigator.locks.request` takes, as this module passes
 * it.
 *
 * @since 0.2.0
 * @category models
 */
export interface LockManagerRequestOptions {
  readonly mode?: LockMode | undefined;
  readonly ifAvailable?: boolean | undefined;
  readonly steal?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The structural slice of the browser's `LockManager` this module calls. The
 * live `navigator.locks` satisfies it; so does the in-memory manager in
 * `@thomasfosterau/effect-web/testing` (`TestLocks.makeLockManager`).
 *
 * @since 0.2.0
 * @category models
 */
export interface LockManagerLike {
  request(
    name: string,
    options: LockManagerRequestOptions,
    callback: (
      lock: { readonly name: string; readonly mode: LockMode } | null,
    ) => Promise<void> | undefined,
  ): Promise<void>;
  query(): Promise<{
    readonly held?: ReadonlyArray<LockInfoLike> | undefined;
    readonly pending?: ReadonlyArray<LockInfoLike> | undefined;
  }>;
}

/**
 * One entry of the browser's `LockManagerSnapshot`, every field optional as
 * the WebIDL declares it.
 *
 * @since 0.2.0
 * @category models
 */
export interface LockInfoLike {
  readonly name?: string | undefined;
  readonly mode?: LockMode | undefined;
  readonly clientId?: string | undefined;
}

/**
 * The Web Locks service. Provide {@link layer} in a browser, or
 * `TestLocks.layer` from `@thomasfosterau/effect-web/testing` in tests.
 *
 * - `supported` — whether the context has a lock manager at all; when it is
 *   `false` every operation fails `Unsupported`.
 * - `acquire` — waits for the lock, holds it until the scope closes.
 * - `tryAcquire` — takes the lock only if it is free right now (the
 *   browser's `ifAvailable`); `None` when it is not, without queueing.
 * - `query` — a diagnostic {@link LockSnapshot}.
 *
 * @since 0.2.0
 * @category services
 */
export class Locks extends Context.Service<
  Locks,
  {
    readonly supported: boolean;
    readonly acquire: (
      name: string,
      options?: LockOptions,
    ) => Effect.Effect<HeldLock, LockError, Scope.Scope>;
    readonly tryAcquire: (
      name: string,
      options?: { readonly mode?: LockMode | undefined },
    ) => Effect.Effect<Option.Option<HeldLock>, LockError, Scope.Scope>;
    readonly query: Effect.Effect<LockSnapshot, LockError>;
  }
>()("@thomasfosterau/effect-web/browser/Locks") {}

/** What a request's scope finalizer releases, filled in once the lock is granted. */
interface RequestState {
  release: () => void;
  released: Effect.Effect<void>;
  cancelled: boolean;
  /** Withdraws a queued request: on interruption, or when the scope closes first. */
  readonly withdraw: AbortController;
}

const toInfo = (info: LockInfoLike): LockInfo => ({
  name: info.name ?? "",
  mode: info.mode ?? "exclusive",
  clientId: Option.fromUndefinedOr(info.clientId),
});

/**
 * Builds the {@link Locks} service over a lock manager; `undefined` builds
 * the unsupported service (`supported: false`, every operation failing
 * `Unsupported`). {@link layer} passes `navigator.locks`.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 * import { TestLocks } from "@thomasfosterau/effect-web/testing"
 *
 * // Two "tabs" over one origin-wide lock manager.
 * const manager = TestLocks.makeLockManager()
 * const tab = Locks.make(manager)
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const lock = yield* tab.acquire("sync")
 *     return lock.mode
 *   }),
 * )
 * Effect.runPromise(program).then(console.log) // "exclusive"
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (manager: LockManagerLike | undefined): Locks["Service"] => {
  if (manager === undefined) {
    const unsupported = (name: Option.Option<string>) =>
      Effect.fail(lockError(name, "Unsupported", undefined));
    return Locks.of({
      supported: false,
      acquire: (name) => unsupported(Option.some(name)),
      tryAcquire: (name) => unsupported(Option.some(name)),
      query: unsupported(Option.none()),
    });
  }

  const request = (
    name: string,
    mode: LockMode,
    flags: { readonly steal: boolean; readonly ifAvailable: boolean },
  ): Effect.Effect<Option.Option<HeldLock>, LockError, Scope.Scope> =>
    Effect.gen(function* () {
      // The release hook outlives the value: whatever the browser grants is
      // released when the scope closes, even if the grant raced an
      // interruption and never reached this fiber.
      const state: RequestState = {
        release: () => {},
        released: Effect.void,
        cancelled: false,
        withdraw: new AbortController(),
      };
      // Closing the scope withdraws a still-queued request, releases a held
      // lock, and waits for the browser to report either, so once `withLock`
      // returns, another context can already be granted the lock.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          state.cancelled = true;
          state.withdraw.abort();
          state.release();
          return state.released;
        }),
      );
      const stolen = yield* Deferred.make<void>();
      return yield* Effect.callback<Option.Option<HeldLock>, LockError>((resume, interrupted) => {
        let granted = false;
        const signal = state.withdraw.signal;
        interrupted.addEventListener("abort", () => state.withdraw.abort(), { once: true });
        // The browser refuses a signal next to `steal` / `ifAvailable`; neither
        // ever queues, so neither needs withdrawing.
        const options: LockManagerRequestOptions =
          flags.steal || flags.ifAvailable
            ? { mode, steal: flags.steal, ifAvailable: flags.ifAvailable }
            : { mode, signal };
        const outcome = manager.request(name, options, (lock) => {
          if (lock === null) {
            resume(Effect.succeedNone);
            return undefined;
          }
          // Interrupted (the signal) or its scope closed while the grant was
          // in flight: release at once rather than hold a lock nobody has.
          if (state.cancelled || signal.aborted) return undefined;
          granted = true;
          const held = pendingPromise();
          state.release = held.resolve;
          resume(Effect.succeedSome({ name, mode, stolen: Deferred.await(stolen) }));
          return held.promise;
        });
        // Whatever happens next — granted and released, withdrawn, or granted
        // after cancellation and released at once — the request settles, and
        // the scope's finalizer waits for it.
        state.released = settled(() => outcome);
        outcome.then(undefined, (cause: unknown) => {
          // After the grant the held promise never rejects, so the only way
          // the request can still reject is a steal.
          if (granted) {
            Deferred.doneUnsafe(stolen, Effect.void);
          } else {
            resume(
              Effect.fail(
                lockError(Option.some(name), reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
              ),
            );
          }
        });
      });
    });

  return Locks.of({
    supported: true,
    acquire: (name, options) =>
      request(name, options?.mode ?? "exclusive", {
        steal: options?.steal ?? false,
        ifAvailable: false,
      }).pipe(
        Effect.flatMap(
          Option.match({
            // Without `ifAvailable` the browser only ever calls back with a lock.
            onNone: () => Effect.die("navigator.locks granted no lock to a queued request"),
            onSome: Effect.succeed,
          }),
        ),
      ),
    tryAcquire: (name, options) =>
      request(name, options?.mode ?? "exclusive", { steal: false, ifAvailable: true }),
    query: Effect.tryPromise({
      try: () => manager.query(),
      catch: (cause) =>
        lockError(Option.none(), reasonOf(cause, REJECTION_REASONS, "Failed"), cause),
    }).pipe(
      Effect.map((snapshot) => ({
        held: (snapshot.held ?? []).map(toInfo),
        pending: (snapshot.pending ?? []).map(toInfo),
      })),
    ),
  });
};

/**
 * The {@link Locks} service over the ambient `navigator.locks`. Builds in any
 * context: where there is no lock manager the service reports
 * `supported: false` instead of failing the layer, so one layer serves every
 * browser and the server render alike.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 *
 * const program = Effect.gen(function* () {
 *   const locks = yield* Locks.Locks
 *   return locks.supported
 * })
 * // `true` where the runtime has `navigator.locks` (browsers, Node 24+),
 * // otherwise `false`.
 * Effect.runPromise(Effect.provide(program, Locks.layer)).then(console.log)
 * ```
 *
 * @since 0.2.0
 * @category layers
 */
export const layer: Layer.Layer<Locks> = Layer.sync(Locks, () => make(ambientNavigator()?.locks));

const runHolding = <A, E, R>(
  self: Effect.Effect<A, E, R>,
  held: HeldLock,
): Effect.Effect<A, E | LockError, R> =>
  Effect.raceFirst(
    self,
    Effect.andThen(
      held.stolen,
      Effect.fail(lockError(Option.some(held.name), "Stolen", undefined)),
    ),
  );

/**
 * Runs an effect while holding a lock: waits for the lock, runs `self`,
 * releases the lock however `self` ends. If another context steals the lock
 * meanwhile, `self` is interrupted and the result fails `Stolen` — the
 * guarded work never runs on unaware that it lost mutual exclusion.
 *
 * The lock's scope is local: a `Scope` that `self` itself requires is left
 * to the caller, never closed by this combinator.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 * import { TestLocks } from "@thomasfosterau/effect-web/testing"
 *
 * const refreshToken = Effect.succeed("fresh-token").pipe(Locks.withLock("auth-refresh"))
 *
 * Effect.runPromise(Effect.provide(refreshToken, TestLocks.layer())).then(console.log) // "fresh-token"
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const withLock: {
  (
    name: string,
    options?: LockOptions,
  ): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | LockError, R | Locks>;
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    name: string,
    options?: LockOptions,
  ): Effect.Effect<A, E | LockError, R | Locks>;
} = dual(
  (args) => Effect.isEffect(args[0]),
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    name: string,
    options?: LockOptions,
  ): Effect.Effect<A, E | LockError, R | Locks> =>
    Effect.flatMap(Locks, (locks) =>
      Effect.scopedWith((scope) =>
        Effect.flatMap(Scope.provide(locks.acquire(name, options), scope), (held) =>
          runHolding(self, held),
        ),
      ),
    ),
);

/**
 * Runs an effect under a lock only if the lock is free right now: `Some`
 * with the result when it ran, `None` (without running `self`, and without
 * queueing) when another context holds the lock. The fit for work any one
 * tab may do on everyone's behalf — a leader-elected poll, a once-per-origin
 * migration.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 * import { TestLocks } from "@thomasfosterau/effect-web/testing"
 *
 * const poll = Effect.succeed("polled").pipe(Locks.withLockIfAvailable("poller"))
 *
 * // Some("polled"): nobody else held the lock.
 * Effect.runPromise(Effect.provide(poll, TestLocks.layer())).then(console.log)
 * ```
 *
 * @since 0.2.0
 * @category combinators
 */
export const withLockIfAvailable: {
  (
    name: string,
    options?: { readonly mode?: LockMode | undefined },
  ): <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Option.Option<A>, E | LockError, R | Locks>;
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    name: string,
    options?: { readonly mode?: LockMode | undefined },
  ): Effect.Effect<Option.Option<A>, E | LockError, R | Locks>;
} = dual(
  (args) => Effect.isEffect(args[0]),
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
    name: string,
    options?: { readonly mode?: LockMode | undefined },
  ): Effect.Effect<Option.Option<A>, E | LockError, R | Locks> =>
    Effect.flatMap(Locks, (locks) =>
      Effect.scopedWith((scope) =>
        Effect.flatMap(
          Scope.provide(locks.tryAcquire(name, options), scope),
          Option.match({
            onNone: () => Effect.succeedNone,
            onSome: (held) => Effect.asSome(runHolding(self, held)),
          }),
        ),
      ),
    ),
);

/**
 * The origin's current {@link LockSnapshot}, from the {@link Locks} service.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Locks } from "@thomasfosterau/effect-web/browser"
 * import { TestLocks } from "@thomasfosterau/effect-web/testing"
 *
 * const program = Locks.query.pipe(Locks.withLock("export"))
 * Effect.runPromise(Effect.provide(program, TestLocks.layer())).then((snapshot) =>
 *   console.log(snapshot.held.map((lock) => lock.name)), // ["export"]
 * )
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const query: Effect.Effect<LockSnapshot, LockError, Locks> = Effect.flatMap(
  Locks,
  (locks) => locks.query,
);
