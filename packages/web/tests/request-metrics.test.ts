/**
 * The per-request metric scope and the counting proxy, over a class-instance
 * client whose methods read `this`: the load-bearing risk is the receiver
 * discipline (an unbound call leaves `this` undefined, and a `transaction`
 * that reads its session fails where a plain-object stub would not).
 */
import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import {
  countingProxy,
  currentRequestMetrics,
  incrementRequestMetric,
  type RequestMetrics,
  withRequestMetrics,
} from "@thomasfosterau/effect-web/observability";

/** A client modelled on a database class instance: every method reads `this`. */
class FakeClient {
  readonly session = { open: true };
  select(): ReadonlyArray<string> {
    return this.session.open ? ["row"] : [];
  }
  insert(id: string) {
    return { id, open: this.session.open };
  }
  transaction<A>(callback: (tx: FakeClient) => A): A {
    if (!this.session.open) throw new TypeError("closed session");
    return callback(this);
  }
}

/** The failure the settle-on-failure test injects. */
class Boom extends Schema.TaggedError<Boom>()("Boom", { message: Schema.String }) {}

// oxlint-disable-next-line effect/avoid-native-object-helpers -- `countingProxy` takes a native `ReadonlySet`: its per-call cost is one `Set#has`.
const QUERY_METHODS: ReadonlySet<string> = new Set(["select", "insert", "transaction"]);

const settledCount = async <A>(fn: () => Promise<A>): Promise<{ value: A; count: number }> => {
  let count = -1;
  const value = await withRequestMetrics(fn, (metrics) => {
    count = metrics.count;
  });
  return { value, count };
};

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("countingProxy over a class-instance client", () => {
  it("runs a transaction then a select with the real client as this, counting each top-level call", async () => {
    const client = countingProxy(new FakeClient(), QUERY_METHODS);
    const { value, count } = await settledCount(async () => {
      const created = client.transaction((tx) => tx.insert("n1"));
      await tick();
      return { created, rows: client.select() };
    });
    expect(value).toStrictEqual({ created: { id: "n1", open: true }, rows: ["row"] });
    // The inner `tx.insert` runs on the real client handed to the callback, not the proxy.
    expect(count).toBe(2);
  });

  it("forwards outside a scope without counting", () => {
    const client = countingProxy(new FakeClient(), QUERY_METHODS);
    expect(client.select()).toStrictEqual(["row"]);
    expect(currentRequestMetrics()).toStrictEqual(Option.none());
  });

  it("passes other properties and non-function members straight through", async () => {
    const real = { marker: "REAL", select: 42, other: () => "other" };
    // oxlint-disable-next-line effect/avoid-native-object-helpers -- `countingProxy` takes a native `ReadonlySet`.
    const client = countingProxy(real, new Set(["select"]));
    const { value, count } = await settledCount(async () => [
      client.marker,
      client.select,
      client.other(),
    ]);
    expect(value).toStrictEqual(["REAL", 42, "other"]);
    expect(count).toBe(0);
  });

  it("does not count a symbol-keyed method", async () => {
    const key = Symbol("select");
    // oxlint-disable-next-line effect/avoid-native-object-helpers -- `countingProxy` takes a native `ReadonlySet`.
    const client = countingProxy({ [key]: () => "ok" }, new Set(["select"]));
    expect((await settledCount(async () => client[key]())).count).toBe(0);
  });
});

describe("withRequestMetrics", () => {
  it("starts every scope at zero and returns the callback's value", async () => {
    expect(await settledCount(async () => incrementRequestMetric(4))).toStrictEqual({
      value: undefined,
      count: 4,
    });
    expect(await settledCount(async () => "the-value")).toStrictEqual({
      value: "the-value",
      count: 0,
    });
  });

  it("reads the live count inside a scope", async () => {
    const { value } = await settledCount(async () => {
      incrementRequestMetric();
      await tick();
      incrementRequestMetric(2);
      return currentRequestMetrics();
    });
    expect(value).toStrictEqual(Option.some({ count: 3 }));
  });

  it("isolates concurrent scopes whose increments interleave", async () => {
    const client = countingProxy(new FakeClient(), QUERY_METHODS);
    const settled: Array<RequestMetrics> = [];
    const request = (queries: number) =>
      withRequestMetrics(
        () =>
          Arr.reduce(Arr.range(1, queries), Promise.resolve(), (previous) =>
            previous.then(async () => {
              client.select();
              await tick();
            }),
          ),
        (metrics) => settled.push(metrics),
      );
    await Promise.all([request(3), request(5)]);
    expect(
      Arr.sort(
        Arr.map(settled, (metrics) => metrics.count),
        Order.Number,
      ),
    ).toStrictEqual([3, 5]);
  });

  it("gives a nested call its own scope", async () => {
    let inner = -1;
    const { count } = await settledCount(async () => {
      incrementRequestMetric();
      await withRequestMetrics(
        async () => incrementRequestMetric(10),
        (metrics) => {
          inner = metrics.count;
        },
      );
      incrementRequestMetric();
    });
    expect(inner).toBe(10);
    expect(count).toBe(2);
  });

  it("settles on a rejection and on a synchronous throw, passing the failure through", async () => {
    const counts: Array<number> = [];
    await expect(
      withRequestMetrics(
        async () => {
          incrementRequestMetric();
          throw new Boom({ message: "boom" });
        },
        (metrics) => counts.push(metrics.count),
      ),
    ).rejects.toThrow("boom");
    await expect(
      withRequestMetrics(
        () => {
          throw new Boom({ message: "sync boom" });
        },
        (metrics) => counts.push(metrics.count),
      ),
    ).rejects.toThrow("sync boom");
    expect(counts).toStrictEqual([1, 0]);
  });
});
