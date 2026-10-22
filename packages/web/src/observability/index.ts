/**
 * The read-path observability signals a Worker emits on Cloudflare Workers
 * observability — which captures a Worker's `console.log` output as a
 * queryable invocation log with no exporter, no binding and no bundle
 * weight — on Effect's own `Logger` and `Tracer` seams:
 *
 * - {@link logStructured} — the JSON-line sink.
 * - {@link spanTracer} — the allow-listed span logger.
 * - {@link logEvent} / {@link logWarningEvent} / {@link logErrorEvent} /
 *   {@link describeError} — the event trio on `Effect.annotateLogs`.
 * - {@link deriveAuthOutcome} / {@link logAuthOutcome} — the auth-tax signal.
 * - {@link withRequestMetrics} / {@link incrementRequestMetric} /
 *   {@link currentRequestMetrics} / {@link countingProxy} — the per-request
 *   metric scope (a query count per request).
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

/**
 * The per-request metric scope: {@link withRequestMetrics},
 * {@link incrementRequestMetric}, {@link currentRequestMetrics} and
 * {@link countingProxy}.
 *
 * @since 0.2.0
 */
export * from "./request-metrics.ts";

/**
 * The line encoder: `Schema.fromJsonString(Schema.Unknown)` in the encode
 * direction, i.e. `value -> JSON text`. Built once at module scope so the
 * schema machinery is not re-derived per logged line. Byte-identical to the
 * `JSON.stringify` it replaces (same `undefined`-dropping, same key order).
 */
const encodeJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/**
 * The sink: writes the logged payload as one `console.log` JSON line.
 * `options.message` is always a one-element array here: `Effect.log`
 * collects its call's arguments into `message` verbatim, and
 * {@link logStructured} always calls it with exactly one argument — so
 * unwrapping the sole element is safe by construction.
 *
 * **Not `Logger.consoleJson` / `Logger.formatJson`.** Effect's built-in
 * structured formatters wrap the logged value in an envelope
 * (`{"message":<value>,"level":…,"timestamp":…,"fiberId":…}`), not the flat
 * `{"event":"read-path.db",…}` / `{"event":"span",…}` shape this module
 * emits. That flat line shape is a stable output contract: log dashboards and
 * queries key on its top-level fields, so it never changes shape. This sink
 * keeps it exactly while routing the emission through `effect/Logger`.
 *
 * A `Logger` is a stateless value object, so building this once at module
 * scope is not a per-request construction.
 */
const jsonLogger: Logger.Logger<unknown, void> = Logger.make(({ message }) => {
  // SAFETY: `Effect.log` collects its arguments into `message` verbatim, and
  // `logStructured` — the only caller that reaches this sink — always passes
  // exactly one; the tuple type restates that invariant.
  const [payload] = message as readonly [unknown];
  // oxlint-disable-next-line effect/use-console-service -- `console.log` IS the output contract: Cloudflare Workers observability captures a Worker's console output as the queryable invocation log, with no exporter and no binding. This function is itself the `Logger` sink, so routing it through the `Console` service would be circular.
  console.log(encodeJsonLine(payload));
});

/**
 * Installs {@link jsonLogger} as the SOLE logger for the wrapped effect.
 * `Logger.layer` replaces the active logger set rather than merging with it,
 * so scoping it to just the `Effect.log` call in {@link logStructured} — via
 * `Effect.provide`, not a merge into the per-request runtime's ambient
 * loggers — means this never touches how any other `Effect.log` call site
 * formats or routes its output.
 */
const jsonLoggerLayer = Logger.layer([jsonLogger]);

/**
 * Logs `payload` as a single structured JSON line via `effect/Logger`.
 * Safe to call from plain (non-Effect) code — a tracer's `end` hook, a
 * request-metrics `onSettle` callback: the whole pipeline (the context lookup
 * `Effect.log` does, then the synchronous `console.log`) never suspends, so
 * `Effect.runSync` always returns immediately.
 *
 * Also pins `References.MinimumLogLevel` to `"All"` for this one call, so
 * these signals stay unconditional, like a bare `console.log`, even if an
 * ambient `Logger.withMinimumLogLevel` raises the threshold for ordinary
 * `Effect.log` call sites.
 *
 * @example
 * ```ts
 * import { logStructured } from "@thomasfosterau/effect-web/observability"
 *
 * // prints: {"event":"read-path.db","dbQueryCount":3,"path":"/posts"}
 * logStructured({ event: "read-path.db", dbQueryCount: 3, path: "/posts" })
 * ```
 *
 * @since 0.1.0
 * @category logging
 */
export const logStructured = (payload: Record<string, unknown>): void => {
  // oxlint-disable-next-line effect/effect-run-in-body -- this is the boundary: `logStructured` is called from plain (non-Effect) JS — a tracer's `Span#end` hook, a metrics `onSettle` callback — so something has to run the effect. The pipeline never suspends (context lookup + a synchronous `console.log`).
  Effect.runSync(
    Effect.log(payload).pipe(
      Effect.provideService(References.MinimumLogLevel, "All"),
      Effect.provide(jsonLoggerLayer),
    ),
  );
};

/**
 * Shared, empty attribute map for every span. Nothing downstream reads a
 * span's `attributes` (the logged line carries only name/duration/ids/ok),
 * so `attribute()` is a no-op and every span can safely share one immutable
 * `Map` instead of allocating a fresh one per span.
 */
// oxlint-disable-next-line effect/avoid-native-object-helpers -- `Tracer.Span["attributes"]` is typed `ReadonlyMap<string, unknown>` by effect itself; a `HashMap` is not assignable to it.
const NO_ATTRIBUTES: ReadonlyMap<string, unknown> = new Map();

/**
 * The structured span logger: a `Tracer.Tracer` (built via `Tracer.make`,
 * Effect's own tracer seam) that logs one {@link logStructured} line —
 * `{ event: "span", name, durationMs, traceId, spanId, ok }` — per completed
 * span whose name is in `trackedSpanNames`, and nothing for any other.
 *
 * Effect's default tracer times every span but has no exporter, so a
 * span's duration never leaves the process without this. The allow-list is
 * load-bearing: this tracer replaces `Tracer.Tracer` for the *whole*
 * per-request `Layer`, and `Effect.withSpan` can have 100+ call sites in a
 * single request's Effect graph, so without it every one would emit a line
 * on every request — unbounded per-request cost for spans nobody queries.
 * Extend the set deliberately when a new span is worth observing; the set
 * differs per application, which is why it is a constructor parameter here
 * and not a constant.
 *
 * Every span stays a lean value object — one shared empty attributes `Map`
 * and `crypto.randomUUID()` ids — rather than paying `Tracer.NativeSpan`'s
 * per-span allocations. Build the tracer once at module scope, never per
 * request.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Tracer from "effect/Tracer"
 * import { spanTracer } from "@thomasfosterau/effect-web/observability"
 *
 * const tracer = spanTracer(["operations.search"])
 *
 * // logs {"event":"span","name":"operations.search","durationMs":…,"traceId":…,"spanId":…,"ok":true}
 * await Effect.succeed("hit").pipe(
 *   Effect.withSpan("operations.search"),
 *   Effect.provideService(Tracer.Tracer, tracer),
 *   Effect.runPromise,
 * )
 * ```
 *
 * @since 0.1.0
 * @category tracing
 */
export const spanTracer = (trackedSpanNames: Iterable<string>): Tracer.Tracer => {
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- this `.has` runs on every `Effect.withSpan` call site in a request's graph; a native `Set` of string literals is the cheapest possible membership test and `HashSet` would hash the name each time.
  const tracked = new Set(trackedSpanNames);
  return Tracer.make({
    span(options) {
      const parent = Option.getOrUndefined(options.parent);
      const traceId = parent?.traceId ?? crypto.randomUUID();
      const spanId = crypto.randomUUID();
      let status: Tracer.SpanStatus = { _tag: "Started", startTime: options.startTime };

      return {
        _tag: "Span",
        name: options.name,
        spanId,
        traceId,
        parent: options.parent,
        annotations: options.annotations,
        get status() {
          return status;
        },
        attributes: NO_ATTRIBUTES,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        attribute() {},
        event() {},
        addLinks() {},
        end(endTime, exit) {
          status = { _tag: "Ended", startTime: options.startTime, endTime, exit };
          if (!tracked.has(options.name)) return;
          const durationMs = Math.round((Number(endTime - options.startTime) / 1e6) * 100) / 100;
          logStructured({
            event: "span",
            name: options.name,
            durationMs,
            traceId,
            spanId,
            ok: Exit.isSuccess(exit),
          });
        },
      };
    },
  });
};

/**
 * An informational event: `event` is the discriminant a log query filters
 * on (`feed.consume`, `crawl.completed`, …), the fields ride as log
 * annotations. The ambient logger decides the output format; this only
 * fixes the shape.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { logEvent } from "@thomasfosterau/effect-web/observability"
 *
 * await Effect.runPromise(logEvent("feed.consume", { cycleId: "c1", outcome: "ok" }))
 * ```
 *
 * @since 0.1.0
 * @category logging
 */
export const logEvent = (
  event: string,
  fields: Record<string, unknown> = {},
): Effect.Effect<void> => Effect.logInfo(event).pipe(Effect.annotateLogs({ event, ...fields }));

/**
 * A degraded-but-continuing outcome: a dropped message, a skipped entry, a
 * swallowed enqueue failure.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { logWarningEvent } from "@thomasfosterau/effect-web/observability"
 *
 * await Effect.runPromise(logWarningEvent("queue.dropped", { reason: "undecodable" }))
 * ```
 *
 * @since 0.1.0
 * @category logging
 */
export const logWarningEvent = (
  event: string,
  fields: Record<string, unknown> = {},
): Effect.Effect<void> => Effect.logWarning(event).pipe(Effect.annotateLogs({ event, ...fields }));

/**
 * A recorded failure: the row carries the error, and so does the log.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { describeError, logErrorEvent } from "@thomasfosterau/effect-web/observability"
 *
 * await Effect.runPromise(logErrorEvent("crawl.failed", { error: describeError(new Error("timeout")) }))
 * ```
 *
 * @since 0.1.0
 * @category logging
 */
export const logErrorEvent = (
  event: string,
  fields: Record<string, unknown> = {},
): Effect.Effect<void> => Effect.logError(event).pipe(Effect.annotateLogs({ event, ...fields }));

/**
 * Renders any failure value as the one-line text an `error` column and a
 * log annotation carry. Tagged errors render as `Tag: message`; anything
 * else falls back to its `String` form, so a defect from a library is still
 * legible on the row.
 *
 * @example
 * ```ts
 * import { describeError } from "@thomasfosterau/effect-web/observability"
 *
 * describeError({ _tag: "FetchFailed", message: "timeout" }) // "FetchFailed: timeout"
 * describeError({ _tag: "Interrupted" }) // "Interrupted"
 * describeError(new Error("boom")) // "boom"
 * describeError(42) // "42"
 * ```
 *
 * @since 0.1.0
 * @category logging
 */
export const describeError = (error: unknown): string => {
  if (Predicate.isObject(error)) {
    // SAFETY: a structural read of two optional members on an arbitrary
    // object; each is checked with `Predicate.isString` before use.
    const tagged = error as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = Predicate.isString(tagged._tag) ? Option.some(tagged._tag) : Option.none();
    const message =
      Predicate.isString(tagged.message) && tagged.message !== ""
        ? Option.some(tagged.message)
        : Option.none();
    if (Option.isSome(tag) && Option.isSome(message)) return `${tag.value}: ${message.value}`;
    if (Option.isSome(tag)) return tag.value;
    if (Option.isSome(message)) return message.value;
  }
  return String(error);
};

/**
 * The label the read-path auth-tax signal gives a request's session
 * resolution — see {@link deriveAuthOutcome}.
 *
 * @since 0.1.0
 * @category models
 */
export type AuthOutcome = "skipped" | "resolved" | "anonymous" | "degraded";

/**
 * The facts {@link deriveAuthOutcome} labels.
 *
 * @since 0.1.0
 * @category models
 */
export interface AuthOutcomeFacts {
  /** The structural precondition for the session call was unavailable (a missing auth binding). */
  readonly bindingMissing: boolean;
  /** The request carried a session cookie. */
  readonly hasCookie: boolean;
  /**
   * Whether the request carried a machine-auth API key (bearer /
   * `x-api-key`). A key is a credential just like a cookie: its presence
   * takes the request off the cookieless fast path. Defaults to `false`.
   */
  readonly hasApiKey?: boolean | undefined;
  /** The session call threw or failed. */
  readonly sessionError: boolean;
  /** The session call ran and returned a session. */
  readonly sessionResolved: boolean;
}

/**
 * Derives the auth-tax outcome from the facts that determine it, one place
 * every front door calls so the same condition always gets the same label:
 *
 * - `"degraded"` — the structural precondition for the session call was
 *   unavailable (a missing auth binding) or the call threw/failed; the
 *   request still serves, fail-open, as anonymous.
 * - `"skipped"` — the credential-less fast path (PERF-CACHE-003): no session
 *   cookie and no API key, so the session call never ran. Near-zero duration
 *   by construction.
 * - `"resolved"` — the call ran (paid the round trip) and returned a session.
 * - `"anonymous"` — the call ran but resolved to no session — a stale /
 *   expired / invalid credential, not an error. Distinct from `"skipped"`
 *   because it still paid the round trip; folding it into `"skipped"` would
 *   corrupt that bucket's near-zero-duration assumption.
 *
 * @example
 * ```ts
 * import { deriveAuthOutcome } from "@thomasfosterau/effect-web/observability"
 *
 * deriveAuthOutcome({ bindingMissing: false, hasCookie: false, sessionError: false, sessionResolved: false }) // "skipped"
 * deriveAuthOutcome({ bindingMissing: false, hasCookie: true, sessionError: false, sessionResolved: true }) // "resolved"
 * deriveAuthOutcome({ bindingMissing: false, hasCookie: true, sessionError: false, sessionResolved: false }) // "anonymous"
 * deriveAuthOutcome({ bindingMissing: true, hasCookie: true, sessionError: false, sessionResolved: false }) // "degraded"
 * ```
 *
 * @since 0.1.0
 * @category signals
 */
export const deriveAuthOutcome = (input: AuthOutcomeFacts): AuthOutcome => {
  if (input.bindingMissing || input.sessionError) return "degraded";
  const hasCredential = input.hasCookie || (input.hasApiKey ?? false);
  if (!hasCredential) return "skipped";
  return input.sessionResolved ? "resolved" : "anonymous";
};

/**
 * Logs the structured `read-path.auth` line: how long session resolution
 * took and which {@link AuthOutcome} it reached.
 *
 * @example
 * ```ts
 * import { logAuthOutcome } from "@thomasfosterau/effect-web/observability"
 *
 * // prints: {"event":"read-path.auth","durationMs":12.5,"outcome":"resolved"}
 * logAuthOutcome(12.5, "resolved")
 * ```
 *
 * @since 0.1.0
 * @category signals
 */
export const logAuthOutcome = (durationMs: number, outcome: AuthOutcome): void =>
  logStructured({ event: "read-path.auth", durationMs, outcome });
