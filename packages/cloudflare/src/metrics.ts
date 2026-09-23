/**
 * The per-request DB query counter — the framework-agnostic core of the
 * applications' read-path instrumentation (#538), on Effect's `Metric`
 * (#955). Ported from `packages/bindings/src/observability-metrics.ts`,
 * generic over the client it counts: any object exposing the drizzle
 * query-initiating methods ({@link QUERY_METHODS}) can be wrapped.
 *
 * **Why a fresh `Metric.Counter` per request, not a module-scope singleton.**
 * A `Metric` caches the hooks it resolved from a registry *on the metric
 * instance itself* the first time it's read/written, so a shared counter
 * would silently pin every request's count to whichever request's registry
 * it saw first. A new `Metric.Counter` (a cheap descriptor) per request keeps
 * each instance's cache scoped to its own request's registry.
 *
 * **Why `AsyncLocalStorage` is the scoping bridge.** The counting call
 * happens synchronously, inside a `Proxy` trap, at a point in plain JS with
 * no `Effect.gen` yield to thread a per-request context through — so
 * `AsyncLocalStorage` (which a locale middleware already puts on the same
 * path) hands the trap the right per-request counter. `Metric` is the
 * counting primitive; `AsyncLocalStorage` is only ever the scoping
 * mechanism. Cloudflare Workers support it under the `nodejs_compat` flag.
 *
 * **Performance.** The read path: the counter must add no measurable CPU /
 * latency / allocation. Per request: a `Metric.Counter`, a `Context.Context`
 * and a `Map`. Per query-method call: one `Set.has` and, only when a request
 * scope is active, one synchronous `Metric#updateUnsafe` — no
 * `Effect.runSync`, no fiber. The proxy returns the underlying builder chain
 * **untouched**.
 *
 * @since 0.1.0
 */

// oxlint-disable-next-line effect/avoid-node-imports -- `AsyncLocalStorage` is the scoping bridge documented above (the counting call happens synchronously inside a `Proxy` trap, with no `Effect.gen` yield to thread context through).
import { AsyncLocalStorage } from "node:async_hooks";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import * as Predicate from "effect/Predicate";
import { logStructured } from "@thomasfosterau/effect-web/observability";

/**
 * Mutable per-request metric accumulator. One per incoming request.
 *
 * @since 0.1.0
 * @category models
 */
export interface RequestMetrics {
  /** Number of DB queries executed (incremented by {@link countingDatabase}). */
  readonly dbQueryCount: number;
}

/**
 * A request's `Metric.Counter` instance paired with the `Context.Context`
 * carrying its isolated `Metric.MetricRegistry`. Both are built fresh per
 * request — see the module doc for why a fresh `Metric.Counter`, not a
 * shared one, is what makes this safe.
 */
interface RequestMetricScope {
  readonly counter: Metric.Counter<number>;
  readonly context: Context.Context<never>;
}

const makeRequestMetricScope = (): RequestMetricScope => ({
  counter: Metric.counter("read_path.db.query_count", {
    description: "Query-initiating calls on the per-request Database client (read-path.db, #538).",
    incremental: true,
  }),
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- `Metric.MetricRegistry`'s service value IS a native `Map` in effect's own type; a `HashMap` is not assignable to it.
  context: Context.empty().pipe(Context.add(Metric.MetricRegistry, new Map())),
});

/**
 * Request-scoped metric-scope store. Absent outside a request (module init,
 * tests, a queue handler) — every reader treats that as "no metrics", a
 * no-op.
 */
const metricsScopeStore = new AsyncLocalStorage<RequestMetricScope>();

/**
 * Runs `fn` with a fresh per-request metric scope, then hands the settled
 * count to `onSettle` (always, success or throw) so the caller can flush it
 * onto the request span ({@link logDbQueryCount}). The count comes from the
 * same `Metric.Counter` the {@link countingDatabase} proxy increments during
 * the request.
 *
 * @example
 * ```ts
 * import { withRequestMetrics } from "@thomasfosterau/effect-web-cloudflare"
 *
 * let settled = { dbQueryCount: -1 }
 * const value = await withRequestMetrics(async () => "rendered", (metrics) => { settled = metrics })
 * value // "rendered"
 * settled.dbQueryCount // 0 — nothing queried
 * ```
 *
 * @since 0.1.0
 * @category instrumentation
 */
export const withRequestMetrics = async <T>(
  fn: () => Promise<T>,
  onSettle: (metrics: RequestMetrics) => void,
): Promise<T> => {
  const scope = makeRequestMetricScope();
  return metricsScopeStore.run(scope, async () => {
    // oxlint-disable-next-line effect/avoid-try-catch -- try/**finally**, not try/catch: this is the plain-`Promise` boundary a SvelteKit hook / Worker handler calls from, and the "flush on settle, success or throw" contract needs `finally`. Nothing is caught, so no error channel is being swallowed.
    try {
      return await fn();
    } finally {
      onSettle({ dbQueryCount: scope.counter.valueUnsafe(scope.context).count });
    }
  });
};

/**
 * The drizzle client method names that initiate a query — a property read of
 * one of these on the client begins a chain that ends in (at most) one
 * executed statement. Incrementing when one of these is **called** gives a
 * per-request query-intent count (PERF-DB-003's "query count per request"
 * signal) without walking rows. `transaction` counts as one (the statements
 * inside its callback run against the inner `tx`, not this wrapper) — its
 * presence still signals a round-trip.
 *
 * @since 0.1.0
 * @category constants
 */
// oxlint-disable-next-line effect/avoid-native-object-helpers -- read-path hot path: the per-call cost of the proxy trap is documented as one native `Set.has`. `HashSet.has` hashes the key on every property read of the request client.
export const QUERY_METHODS: ReadonlySet<string> = new Set([
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "insert",
  "update",
  "delete",
  "execute",
  "with",
  "$count",
  "query",
  "transaction",
]);

/**
 * Wraps a request-scoped database client in a thin counting layer that
 * increments the active request's `Metric.Counter` when a query-initiating
 * method ({@link QUERY_METHODS}) is **called** on the top-level client, then
 * invokes the method against the real client, leaving the returned builder /
 * Effect untouched.
 *
 * The critical subtlety — the client is a real class instance (drizzle's
 * `EffectPgDatabase`), so the counted method MUST be invoked with the client
 * as `this`: `Reflect.apply(value, target, args)`. An unbound call leaves
 * `this` undefined inside drizzle — `transaction` then dies with "Cannot read
 * properties of undefined (reading 'session')", which 500'd the applications'
 * create forms while every non-`transaction` path happened to survive.
 *
 * Counting at the call (not at the terminal `yield*`) keeps the chain
 * bit-identical. The trade-off is a small, bounded over-count: a builder that
 * is built but never executed (a sub-`SELECT` embedded via `.as(...)`) still
 * counts as one — acceptable for a relative N+1 / waterfall signal, not an
 * exact statement audit.
 *
 * Build it once per isolate and share it across requests; with no scope
 * active it is a no-op.
 *
 * @example
 * ```ts
 * import { countingDatabase, withRequestMetrics } from "@thomasfosterau/effect-web-cloudflare"
 *
 * class FakeDb {
 *   readonly rows = ["row"]
 *   select() { return this.rows }
 *   version = 1
 * }
 * const db = countingDatabase(new FakeDb())
 * let settled = { dbQueryCount: -1 }
 * await withRequestMetrics(async () => { db.select(); db.select() }, (m) => { settled = m })
 * settled.dbQueryCount // 2
 * db.version // 1 — a non-query property passes straight through
 * ```
 *
 * @since 0.1.0
 * @category instrumentation
 */
export const countingDatabase = <Db extends object>(db: Db): Db =>
  new Proxy(db, {
    get(target, prop) {
      // Read with the real instance as receiver so class accessors that touch
      // private state don't observe the Proxy as `this`.
      // oxlint-disable-next-line effect/no-reflect-get -- a `Proxy` `get` trap over an arbitrary drizzle client: the property is whatever the caller asked for, and forwarding it with the real instance as receiver IS the receiver discipline this module exists for.
      const value = Reflect.get(target, prop, target);
      if (Predicate.isString(prop) && QUERY_METHODS.has(prop) && Predicate.isFunction(value)) {
        // Count the query intent, then invoke the method with the real client
        // as `this` — see the receiver discipline in the doc above.
        return (...args: ReadonlyArray<unknown>) => {
          const scope = metricsScopeStore.getStore();
          if (scope !== undefined) scope.counter.updateUnsafe(1, scope.context);
          // oxlint-disable-next-line effect/no-reflect-apply -- the counted method must run with the real client as `this` (see the doc above: an unbound call 500'd the applications' create forms); `Reflect.apply` is the one typed way to say that for a method the proxy did not declare.
          return Reflect.apply(value, target, args);
        };
      }
      return value;
    },
  });

/**
 * The structured `read-path.db` log line (#538) — the {@link withRequestMetrics}
 * `onSettle` callback every front door passes, shared so the log shape can't
 * drift between Workers; emitted via `logStructured` (Effect's `Logger`).
 *
 * @example
 * ```ts
 * import { logDbQueryCount } from "@thomasfosterau/effect-web-cloudflare"
 *
 * // prints: {"event":"read-path.db","dbQueryCount":3,"path":"/books/some-book"}
 * logDbQueryCount({ dbQueryCount: 3 }, "/books/some-book")
 * ```
 *
 * @since 0.1.0
 * @category instrumentation
 */
export const logDbQueryCount = (metrics: RequestMetrics, path: string): void =>
  logStructured({ event: "read-path.db", dbQueryCount: metrics.dbQueryCount, path });
