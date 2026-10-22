/**
 * A per-request metric scope: one counter per incoming request, incremented
 * from plain (non-Effect) code — a `Proxy` trap over a database client — and
 * handed to the caller when the request settles. The relative count is an
 * N+1 / waterfall signal, not an exact audit.
 *
 * **A fresh `Metric.Counter` and `Metric.MetricRegistry` per request.** A
 * `Metric` caches the hooks it resolved from a registry on the metric
 * instance itself the first time it is used, so a module-scope counter would
 * pin every request's count to the first request's registry. A counter is a
 * cheap descriptor; building one per request keeps each instance's cache on
 * its own registry. One accumulator per request, never one per process.
 *
 * **`AsyncLocalStorage` is the scoping bridge**, because the count is taken
 * synchronously inside a `Proxy` trap, where no Effect context can be
 * threaded. It is created on first use, never at import, so the module stays
 * free of top-level effects. On Workers it needs `nodejs_compat` (or
 * `nodejs_als`).
 *
 * @since 0.2.0
 */
// oxlint-disable-next-line effect/avoid-node-imports -- `AsyncLocalStorage` is the scoping bridge documented above: the count is taken synchronously inside a `Proxy` trap with no Effect context to thread, and effect has no equivalent primitive. Node, Deno, Bun and Workers (`nodejs_compat`) all provide it.
import { AsyncLocalStorage } from "node:async_hooks";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

/**
 * What a request scope counted, as {@link withRequestMetrics} hands it to
 * `onSettle` and {@link currentRequestMetrics} reads it.
 *
 * @since 0.2.0
 * @category models
 */
export interface RequestMetrics {
  /** The number of increments in the scope ({@link incrementRequestMetric}, {@link countingProxy}). */
  readonly count: number;
}

/** A request's own counter, paired with the context carrying its isolated registry. */
interface RequestMetricScope {
  readonly counter: Metric.Counter<number>;
  readonly context: Context.Context<never>;
}

const makeScope = (): RequestMetricScope => ({
  counter: Metric.counter("request_metric_count", { incremental: true }),
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- `Metric.MetricRegistry`'s service value IS a native `Map` in effect's own type.
  context: Context.make(Metric.MetricRegistry, new Map()),
});

const readScope = (scope: RequestMetricScope): RequestMetrics => ({
  count: scope.counter.valueUnsafe(scope.context).count,
});

/** The scope store, created on first use so importing this module has no effect. */
let store: AsyncLocalStorage<RequestMetricScope> | undefined;

const scopeStore = (): AsyncLocalStorage<RequestMetricScope> =>
  (store ??= new AsyncLocalStorage<RequestMetricScope>());

/**
 * Runs `fn` in a fresh request scope and hands what it counted to `onSettle`
 * once `fn` settles, whether it resolved or rejected (or threw); the result
 * or failure of `fn` is passed through unchanged. Every increment made while
 * `fn` runs, across its awaits, lands in this scope; concurrent requests do
 * not share counts. A nested call opens its own scope, which the outer one
 * does not include.
 *
 * Its cost per request is a counter descriptor, a context, a `Map` and one
 * `AsyncLocalStorage#run`.
 *
 * @example
 * ```ts
 * import { incrementRequestMetric, withRequestMetrics } from "@thomasfosterau/effect-web/observability"
 *
 * const value = await withRequestMetrics(
 *   async () => {
 *     incrementRequestMetric()
 *     incrementRequestMetric()
 *     return "ok"
 *   },
 *   (metrics) => console.log(metrics.count), // 2
 * )
 * value // "ok"
 * ```
 *
 * @since 0.2.0
 * @category request metrics
 */
export const withRequestMetrics = <A>(
  fn: () => Promise<A>,
  onSettle: (metrics: RequestMetrics) => void,
): Promise<A> => {
  const scope = makeScope();
  return scopeStore()
    .run(scope, async () => fn())
    .finally(() => onSettle(readScope(scope)));
};

/**
 * Adds `amount` (default `1`) to the active request scope's counter, from
 * any code, Effect or not: one synchronous `Metric#updateUnsafe`, no fiber.
 * Outside a {@link withRequestMetrics} scope it does nothing.
 *
 * @example
 * ```ts
 * import { incrementRequestMetric, withRequestMetrics } from "@thomasfosterau/effect-web/observability"
 *
 * incrementRequestMetric() // no scope: a no-op
 * await withRequestMetrics(
 *   async () => incrementRequestMetric(3),
 *   (metrics) => console.log(metrics.count), // 3
 * )
 * ```
 *
 * @since 0.2.0
 * @category request metrics
 */
export const incrementRequestMetric = (amount = 1): void => {
  const scope = store?.getStore();
  if (scope !== undefined) scope.counter.updateUnsafe(amount, scope.context);
};

/**
 * What the active request scope has counted so far, or `None` outside a
 * {@link withRequestMetrics} scope.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { currentRequestMetrics, incrementRequestMetric, withRequestMetrics } from "@thomasfosterau/effect-web/observability"
 *
 * Option.isNone(currentRequestMetrics()) // true
 * await withRequestMetrics(
 *   async () => {
 *     incrementRequestMetric()
 *     return currentRequestMetrics() // Option.some({ count: 1 })
 *   },
 *   () => {},
 * )
 * ```
 *
 * @since 0.2.0
 * @category request metrics
 */
export const currentRequestMetrics = (): Option.Option<RequestMetrics> =>
  Option.map(Option.fromUndefinedOr(store?.getStore()), readScope);

/**
 * Wraps `client` so that calling one of `methodNames` on it increments the
 * active request scope's counter ({@link incrementRequestMetric}) once, then
 * invokes the method with the real client as `this` and returns its result
 * untouched. Every other property passes straight through, read with the
 * real client as receiver. Outside a scope the proxy only forwards.
 *
 * The method runs with `client` as `this` (`Reflect.apply`), never unbound:
 * a class-instance client whose method reads its own state (a database
 * client's `transaction` reading its session) fails on an unbound call.
 * Counting at the call rather than at execution keeps a returned builder
 * chain bit-identical; the cost is a bounded over-count, since a builder
 * that is built but never executed (a composed sub-query) still counts.
 * Only calls on `client` itself count, not calls on what a method returns
 * or passes to a callback (a transaction's inner client).
 *
 * `methodNames` is the caller's: which methods begin a query is the
 * client's vocabulary. Hoist the set to module scope; the per-call cost is
 * one `Set#has`, plus one `updateUnsafe` when a scope is live.
 *
 * @example
 * ```ts
 * import { countingProxy, withRequestMetrics } from "@thomasfosterau/effect-web/observability"
 *
 * class Client {
 *   readonly rows = ["row"]
 *   select() {
 *     return this.rows
 *   }
 * }
 *
 * const QUERY_METHODS: ReadonlySet<string> = new Set(["select"])
 * const client = countingProxy(new Client(), QUERY_METHODS)
 * await withRequestMetrics(
 *   async () => client.select(), // ["row"]
 *   (metrics) => console.log(metrics.count), // 1
 * )
 * ```
 *
 * @since 0.2.0
 * @category request metrics
 */
export const countingProxy = <T extends object>(client: T, methodNames: ReadonlySet<string>): T =>
  new Proxy(client, {
    get(target, property) {
      // oxlint-disable-next-line effect/no-reflect-get -- a `Proxy` trap over an arbitrary client: the property is whatever the caller reads, and the real client is the receiver so its accessors never see the proxy as `this`.
      const value: unknown = Reflect.get(target, property, target);
      if (!Predicate.isString(property) || !methodNames.has(property)) return value;
      if (!Predicate.isFunction(value)) return value;
      // oxlint-disable-next-line effect/no-unknown-returns -- the wrapper stands in for the client's own method, so it returns exactly what that method returns; the proxy's `T` restores the type at the call site.
      return (...args: ReadonlyArray<unknown>): unknown => {
        incrementRequestMetric();
        // oxlint-disable-next-line effect/no-reflect-apply -- the receiver discipline: the client's method runs with the real client as `this`, which an unbound call would lose.
        return Reflect.apply(value, target, args);
      };
    },
  });
