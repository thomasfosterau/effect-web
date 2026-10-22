/**
 * Unit tests for `./browser`'s `Locks` (the Web Locks adapter), driven
 * through `./testing`'s in-memory lock manager — so they pin both the
 * adapter's scope/interruption contract and the manager's request
 * algorithm (FIFO, shared/exclusive, `ifAvailable`, `steal`, `signal`).
 */

import { describe, expect, it } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { Locks } from "@thomasfosterau/effect-web/browser";
import { TestLocks } from "@thomasfosterau/effect-web/testing";

/**
 * Polls the origin's snapshot until `done` holds: the sync point for "the
 * forked fiber's request has reached the manager".
 */
const until = (locks: Locks.Locks["Service"], done: (snapshot: Locks.LockSnapshot) => boolean) =>
  locks.query.pipe(
    Effect.repeat({ until: done, schedule: Schedule.spaced("1 millis") }),
    Effect.timeout("1 second"),
  );

describe("Locks.acquire", () => {
  it("holds the lock for the scope's lifetime", async () => {
    const locks = Locks.make(TestLocks.makeLockManager());
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const during = yield* Effect.scoped(
          Effect.gen(function* () {
            const held = yield* locks.acquire("doc");
            expect(held).toMatchObject({ name: "doc", mode: "exclusive" });
            return yield* locks.query;
          }),
        );
        const after = yield* locks.query;
        return { during, after };
      }),
    );
    expect(result.during.held).toStrictEqual([
      { name: "doc", mode: "exclusive", clientId: Option.some("client-1") },
    ]);
    expect(result.after).toStrictEqual({ held: [], pending: [] });
  });

  it("serialises exclusive holders in request order", async () => {
    const origin = TestLocks.makeLockManager();
    const tabA = Locks.make(origin);
    const tabB = Locks.make(origin.forClient("tab-b"));
    const order = await Effect.runPromise(
      Effect.gen(function* () {
        const log: Array<string> = [];
        const releaseA = yield* Deferred.make<void>();
        const a = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              yield* tabA.acquire("x");
              log.push("a:start");
              yield* Deferred.await(releaseA);
              log.push("a:end");
            }),
          ),
        );
        yield* until(tabA, (snapshot) => snapshot.held.length === 1);
        const b = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              yield* tabB.acquire("x");
              log.push("b:start");
            }),
          ),
        );
        yield* until(tabA, (snapshot) => snapshot.pending.length === 1);
        const snapshot = yield* tabA.query;
        expect(snapshot.pending).toStrictEqual([
          { name: "x", mode: "exclusive", clientId: Option.some("tab-b") },
        ]);
        log.push("release");
        yield* Deferred.succeed(releaseA, undefined);
        yield* Fiber.join(a);
        yield* Fiber.join(b);
        return log;
      }),
    );
    expect(order).toStrictEqual(["a:start", "release", "a:end", "b:start"]);
  });

  it("lets shared holders hold together, and queues an exclusive one behind them FIFO", async () => {
    const locks = Locks.make(TestLocks.makeLockManager());
    const snapshot = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* locks.acquire("cache", { mode: "shared" });
          yield* locks.acquire("cache", { mode: "shared" });
          yield* Effect.forkScoped(locks.acquire("cache"));
          yield* until(locks, (snapshot) => snapshot.pending.length === 1);
          // A shared request after a queued exclusive one waits: no starvation.
          yield* Effect.forkScoped(locks.acquire("cache", { mode: "shared" }));
          yield* until(locks, (snapshot) => snapshot.pending.length === 2);
          return yield* locks.query;
        }),
      ),
    );
    expect(snapshot.held.map((lock) => lock.mode)).toStrictEqual(["shared", "shared"]);
    expect(snapshot.pending.map((lock) => lock.mode)).toStrictEqual(["exclusive", "shared"]);
  });

  it("withdraws a queued request when the waiting fiber is interrupted", async () => {
    const locks = Locks.make(TestLocks.makeLockManager());
    const after = await Effect.runPromise(
      Effect.gen(function* () {
        const holder = yield* Effect.forkChild(
          Effect.scoped(Effect.andThen(locks.acquire("q"), Effect.never)),
        );
        yield* until(locks, (snapshot) => snapshot.held.length === 1);
        const waiter = yield* Effect.forkChild(Effect.scoped(locks.acquire("q")));
        yield* until(locks, (snapshot) => snapshot.pending.length === 1);
        expect((yield* locks.query).pending).toHaveLength(1);
        // Interrupting aborts the request's signal: withdrawn by the time
        // the interrupt returns.
        yield* Fiber.interrupt(waiter);
        const pending = (yield* locks.query).pending;
        // The scope's finalizer waits for the release to be reported.
        yield* Fiber.interrupt(holder);
        return { pending, final: yield* locks.query };
      }),
    );
    expect(after.pending).toStrictEqual([]);
    expect(after.final).toStrictEqual({ held: [], pending: [] });
  });

  it("fails InvalidRequest for a reserved name or a shared steal", async () => {
    const locks = Locks.make(TestLocks.makeLockManager());
    const reserved = await Effect.runPromise(
      Effect.flip(Effect.scoped(locks.acquire("-reserved"))),
    );
    expect(reserved).toMatchObject({
      _tag: "LockError",
      reason: "InvalidRequest",
      lock: Option.some("-reserved"),
      message: "lock '-reserved': InvalidRequest",
    });
    const sharedSteal = await Effect.runPromise(
      Effect.flip(Effect.scoped(locks.acquire("x", { mode: "shared", steal: true }))),
    );
    expect(sharedSteal.reason).toBe("InvalidRequest");
  });
});

describe("Locks.tryAcquire / withLockIfAvailable", () => {
  it("takes a free lock and declines a held one without queueing", async () => {
    const origin = TestLocks.makeLockManager();
    const tabA = Locks.make(origin);
    const tabB = Locks.make(origin.forClient("tab-b"));
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const first = yield* tabA.tryAcquire("leader");
          const second = yield* tabB.tryAcquire("leader");
          const shared = yield* tabB.tryAcquire("other", { mode: "shared" });
          return { first, second, shared, snapshot: yield* tabA.query };
        }),
      ),
    );
    expect(Option.isSome(result.first)).toBe(true);
    expect(Option.isNone(result.second)).toBe(true);
    expect(Option.map(result.shared, (lock) => lock.mode)).toStrictEqual(Option.some("shared"));
    expect(result.snapshot.pending).toStrictEqual([]);
  });

  it("runs the effect only when the lock is free", async () => {
    const program = Effect.fn("program")(function* () {
      const free = yield* Effect.succeed("ran").pipe(Locks.withLockIfAvailable("job"));
      const busy = yield* Effect.succeed("ran").pipe(
        Locks.withLockIfAvailable("job"),
        Locks.withLock("job"),
      );
      return { free, busy };
    });
    const result = await Effect.runPromise(Effect.provide(program(), TestLocks.layer()));
    expect(result).toStrictEqual({ free: Option.some("ran"), busy: Option.none() });
  });
});

describe("Locks.withLock", () => {
  it("releases the lock when the guarded effect fails", async () => {
    const program = Effect.fn("program")(function* () {
      const failed = yield* Effect.flip(Effect.fail("boom").pipe(Locks.withLock("w")));
      return { failed, snapshot: yield* Locks.query };
    });
    const result = await Effect.runPromise(Effect.provide(program(), TestLocks.layer()));
    expect(result).toStrictEqual({ failed: "boom", snapshot: { held: [], pending: [] } });
  });

  it("supports the data-first form", async () => {
    const result = await Effect.runPromise(
      Effect.provide(Locks.withLock(Effect.succeed(1), "d", { mode: "shared" }), TestLocks.layer()),
    );
    expect(result).toBe(1);
    const maybe = await Effect.runPromise(
      Effect.provide(Locks.withLockIfAvailable(Effect.succeed(2), "d"), TestLocks.layer()),
    );
    expect(maybe).toStrictEqual(Option.some(2));
  });

  it("interrupts the guarded effect and fails Stolen when another context steals the lock", async () => {
    const origin = TestLocks.makeLockManager();
    const thief = Locks.make(origin.forClient("thief"));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const interrupted = yield* Deferred.make<void>();
        const victim = yield* Effect.forkChild(
          Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            Locks.withLock("session"),
            Effect.provide(TestLocks.layer(origin)),
          ),
        );
        yield* until(thief, (snapshot) => snapshot.held.length === 1);
        const holder = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* thief.acquire("session", { steal: true });
            return (yield* thief.query).held;
          }),
        );
        const error = yield* Effect.flip(Fiber.join(victim));
        yield* Deferred.await(interrupted);
        return { holder, error };
      }),
    );
    expect(result.holder).toStrictEqual([
      { name: "session", mode: "exclusive", clientId: Option.some("thief") },
    ]);
    expect(result.error).toMatchObject({ _tag: "LockError", reason: "Stolen" });
  });
});

describe("Locks without a lock manager", () => {
  it("reports unsupported and fails every operation Unsupported", async () => {
    const locks = Locks.make(undefined);
    expect(locks.supported).toBe(false);
    const errors = await Effect.runPromise(
      Effect.all([
        Effect.flip(Effect.scoped(locks.acquire("a"))),
        Effect.flip(Effect.scoped(locks.tryAcquire("a"))),
        Effect.flip(locks.query),
      ]),
    );
    expect(errors.map((error) => [error.reason, error.lock])).toStrictEqual([
      ["Unsupported", Option.some("a")],
      ["Unsupported", Option.some("a")],
      ["Unsupported", Option.none()],
    ]);
    expect(errors[2]?.message).toBe("lock query failed: Unsupported");
  });

  it("builds the live layer whether or not the runtime has navigator.locks", async () => {
    // Node 24 ships a native `navigator.locks`; Node 22 has none.
    const native = globalThis.navigator?.locks !== undefined;
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const locks = yield* Locks.Locks;
          const ran = locks.supported
            ? yield* Effect.succeed("ran").pipe(Locks.withLock("live-layer-test"))
            : "skipped";
          return { supported: locks.supported, ran };
        }),
        Locks.layer,
      ),
    );
    // Where the runtime has the API, the adapter runs over the real implementation.
    expect(result).toStrictEqual({ supported: native, ran: native ? "ran" : "skipped" });
  });
});

describe("Locks rejection mapping", () => {
  const rejecting = (cause: unknown): Locks.LockManagerLike => ({
    request: () => Promise.reject(cause),
    query: () => Promise.reject(cause),
  });

  it("maps the browser's DOMException names onto reasons", async () => {
    const reasons = await Effect.runPromise(
      Effect.all(
        [
          new DOMException("opaque origin", "SecurityError"),
          new DOMException("inactive document", "InvalidStateError"),
          new TypeError("something else"),
        ].map((cause) =>
          Effect.map(Effect.flip(Locks.make(rejecting(cause)).query), (error) => error.reason),
        ),
      ),
    );
    expect(reasons).toStrictEqual(["NotAllowed", "InvalidState", "Failed"]);
    const acquireError = await Effect.runPromise(
      Effect.flip(Effect.scoped(Locks.make(rejecting("odd")).acquire("x"))),
    );
    expect(acquireError).toMatchObject({ reason: "Failed", cause: "odd" });
  });

  it("fills a sparse snapshot's missing fields", async () => {
    const sparse: Locks.LockManagerLike = {
      request: () => Promise.resolve(),
      query: () => Promise.resolve({ held: [{}] }),
    };
    const snapshot = await Effect.runPromise(Locks.make(sparse).query);
    expect(snapshot).toStrictEqual({
      held: [{ name: "", mode: "exclusive", clientId: Option.none() }],
      pending: [],
    });
  });
});

describe("Locks grant races", () => {
  /** A manager whose grants the test hands out by hand, as a browser task would. */
  const manual = () => {
    const pending: Array<(lock: { readonly name: string; readonly mode: "exclusive" }) => void> =
      [];
    const outcomes: Array<Promise<void> | undefined> = [];
    const manager: Locks.LockManagerLike = {
      request: (name, _options, callback) =>
        new Promise<void>((resolve) => {
          pending.push((lock) => {
            const held = callback(lock);
            outcomes.push(held);
            Promise.resolve(held).then(() => resolve());
          });
        }),
      query: () => Promise.resolve({}),
    };
    const grantNext = () => pending.shift()?.({ name: "x", mode: "exclusive" });
    return { manager, grantNext, outcomes };
  };

  it("releases at once a lock granted after the acquiring fiber was interrupted", async () => {
    const { manager, grantNext, outcomes } = manual();
    const locks = Locks.make(manager);
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // The acquire times out inside a scope that stays open.
          const timedOut = yield* Effect.timeoutOption(locks.acquire("x"), "1 millis");
          // The browser's grant task runs only now.
          grantNext();
          return { timedOut, held: outcomes[0] };
        }),
      ),
    );
    expect(Option.isNone(result.timedOut)).toBe(true);
    // `undefined`, not a pending promise: the lock was handed straight back.
    expect(result.held).toBeUndefined();
  });

  it("waits, on closing, for a cancelled request to settle", async () => {
    const { manager, grantNext } = manual();
    const locks = Locks.make(manager);
    const log: Array<string> = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const closing = yield* Effect.forkChild(
          Effect.scoped(Effect.timeoutOption(locks.acquire("x"), "1 millis")).pipe(
            Effect.andThen(Effect.sync(() => log.push("scope closed"))),
          ),
        );
        yield* Effect.sleep("10 millis");
        log.push("granted");
        grantNext();
        yield* Fiber.join(closing);
      }),
    );
    expect(log).toStrictEqual(["granted", "scope closed"]);
  });
});
