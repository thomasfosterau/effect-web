/**
 * Unit tests for the read-path DB query counter (#538, on Effect `Metric`
 * since #955) — website's `packages/bindings/tests/observability-metrics.test.ts`.
 *
 * The counter wraps the request-scoped database client — in production a
 * real drizzle **class instance** — so these tests run it over a class
 * instance whose methods read `this`, because the load-bearing risk is the
 * receiver discipline: an UNBOUND call leaves `this` undefined inside
 * drizzle, and `transaction` then reads `this.session` and dies (the
 * deployed create forms 500'd). A plain-object-literal stub would not catch
 * it. `countingDatabase` is generic here, so the double cast the
 * application test carried is gone.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it, vi } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import {
  countingDatabase,
  logDbQueryCount,
  QUERY_METHODS,
  type RequestMetrics,
  withRequestMetrics,
} from "@thomasfosterau/effect-web-cloudflare";

/** Thrown by {@link FakeDb} when a method lands with an unbound `this`. */
class UnboundReceiver extends Schema.TaggedError<UnboundReceiver>()("UnboundReceiver", {
  method: Schema.String,
}) {}

/** The failure the "flushes even when the callback throws" test injects. */
class Boom extends Schema.TaggedError<Boom>()("Boom", { message: Schema.String }) {}

/**
 * A `db` modelled as a class instance whose `transaction` / `select` read
 * `this` internal state — mirroring drizzle, where `transaction`
 * dereferences `this.session`.
 */
class FakeDb {
  readonly session = { open: true };
  select() {
    if (!this.session.open) throw new UnboundReceiver({ method: "select" });
    return {
      from: (_table: string) => ({
        where: (_column: string) => ({
          limit: (_rows: number) => Effect.succeed(["row"]),
        }),
      }),
    };
  }
  insert(_table: string) {
    if (!this.session.open) throw new UnboundReceiver({ method: "insert" });
    return {
      values: (_row: { id: string }) => ({
        returning: () => Effect.succeed([{ id: "n1" }]),
      }),
    };
  }
  transaction<A>(cb: (tx: FakeDb) => A): A {
    if (!this.session.open) throw new UnboundReceiver({ method: "transaction" });
    return cb(this);
  }
}

const makeClassDb = (): FakeDb => countingDatabase(new FakeDb());

describe("QUERY_METHODS", () => {
  it("names drizzle's query-initiating methods, transaction included", () => {
    expect(QUERY_METHODS.has("select")).toBe(true);
    expect(QUERY_METHODS.has("transaction")).toBe(true);
    expect(QUERY_METHODS.has("session")).toBe(false);
  });
});

describe("countingDatabase over a class-instance client", () => {
  it("runs a transaction then a select in one request without corrupting the chain", async () => {
    const db = makeClassDb();
    let settled: Option.Option<RequestMetrics> = Option.none<RequestMetrics>();
    const result = await withRequestMetrics(
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const created = yield* db.transaction((tx) =>
              tx.insert("post").values({ id: "n1" }).returning(),
            );
            const got = yield* db.select().from("post_view").where("id").limit(1);
            return { created, got };
          }),
        ),
      (metrics) => {
        settled = Option.some(metrics);
      },
    );
    expect(result).toEqual({ created: [{ id: "n1" }], got: ["row"] });
    // Two top-level `db` calls were counted (transaction + select); the inner
    // `tx.insert` runs against the real tx, not the counting proxy.
    expect(Option.getOrUndefined(settled)?.dbQueryCount).toBe(2);
  });

  it("yields the correct rows from a wrapped select", async () => {
    const db = makeClassDb();
    const rows = await withRequestMetrics(
      () => Effect.runPromise(db.select().from("t").where("c").limit(1)),
      () => {},
    );
    expect(rows).toEqual(["row"]);
  });

  it("does not count outside a request scope, and still runs the query", async () => {
    const db = makeClassDb();
    const rows = await Effect.runPromise(db.select().from("t").where("c").limit(1));
    expect(rows).toEqual(["row"]);
  });

  it("passes non-query properties straight through", () => {
    const real = { marker: "REAL", notAQuery: 42 };
    const db = countingDatabase(real);
    expect(db.notAQuery).toBe(42);
    expect(db.marker).toBe("REAL");
  });
});

describe("withRequestMetrics", () => {
  it("hands a fresh zero accumulator per scope (counts don't leak)", async () => {
    const db = makeClassDb();
    let first: Option.Option<RequestMetrics> = Option.none<RequestMetrics>();
    await withRequestMetrics(
      () => Effect.runPromise(db.select().from("t").where("c").limit(1)),
      (m) => {
        first = Option.some(m);
      },
    );
    expect(Option.getOrUndefined(first)).toEqual({ dbQueryCount: 1 });

    let second: Option.Option<RequestMetrics> = Option.none<RequestMetrics>();
    await withRequestMetrics(
      async () => {},
      (m) => {
        second = Option.some(m);
      },
    );
    expect(Option.getOrUndefined(second)).toEqual({ dbQueryCount: 0 });
  });

  /**
   * Pins the load-bearing correctness property from the module doc: each
   * scope gets its own `Metric.Counter` instance and registry, so two
   * requests genuinely in flight at once in the same isolate must not merge
   * counts.
   */
  it("isolates concurrent request scopes (no cross-contamination across requests)", async () => {
    const db = makeClassDb();
    const settled: Array<RequestMetrics> = [];

    const runRequest = (queryCount: number) =>
      withRequestMetrics(
        () =>
          Effect.runPromise(
            // Sequential on purpose: each query is separated from the next by
            // a real async boundary within ONE request, so the two requests'
            // `AsyncLocalStorage` scopes genuinely interleave.
            Effect.forEach(
              Arr.range(1, queryCount),
              () =>
                Effect.andThen(db.select().from("t").where("c").limit(1), () =>
                  Effect.tryPromise({
                    try: () => new Promise((resolve) => setTimeout(resolve, 0)),
                    catch: (cause) => new Boom({ message: String(cause) }),
                  }),
                ),
              { concurrency: 1, discard: true },
            ),
          ),
        (m) => settled.push(m),
      );

    await Promise.all([runRequest(3), runRequest(5)]);

    expect(
      Arr.sort(
        settled.map((m) => m.dbQueryCount),
        Order.Number,
      ),
    ).toEqual([3, 5]);
  });

  it("flushes metrics on success", async () => {
    let flushed = false;
    await withRequestMetrics(
      async () => "ok",
      () => {
        flushed = true;
      },
    );
    expect(flushed).toBe(true);
  });

  it("flushes metrics even when the callback throws", async () => {
    let flushed = false;
    await expect(
      withRequestMetrics(
        async () => {
          throw new Boom({ message: "boom" });
        },
        () => {
          flushed = true;
        },
      ),
    ).rejects.toThrow("boom");
    expect(flushed).toBe(true);
  });

  it("returns the callback's resolved value", async () => {
    const value = await withRequestMetrics(
      async () => "the-value",
      () => {},
    );
    expect(value).toBe("the-value");
  });
});

describe("logDbQueryCount — structured read-path.db log line", () => {
  it("logs the event name, query count, and path as JSON", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    logDbQueryCount({ dbQueryCount: 3 }, "/books/some-book");

    expect(log).toHaveBeenCalledExactlyOnceWith(
      Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
        event: "read-path.db",
        dbQueryCount: 3,
        path: "/books/some-book",
      }),
    );

    log.mockRestore();
  });
});
