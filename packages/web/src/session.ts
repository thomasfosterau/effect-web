/**
 * What a degraded (fail-open) session resolution reports. A front door that
 * resolves the session fail-open — a database outage or a missing auth
 * binding degrades the request to anonymous rather than failing it — must
 * never degrade silently.
 *
 * Ported from the website / gardeneria `session-degraded-report.ts`.
 *
 * @since 0.1.0
 */

/**
 * Logged (via the Worker's own `console.error`, captured by Cloudflare
 * Workers observability) whenever session resolution degrades a request to
 * anonymous.
 *
 * @since 0.1.0
 * @category constants
 */
export const SESSION_DEGRADED_LOG_MESSAGE =
  "authentication: session resolution failed; serving request as anonymous";

/**
 * What a degraded session resolution reports: to the Worker log, and to the
 * error tracker.
 *
 * @since 0.1.0
 * @category models
 */
export interface SessionDegradedReport {
  /** Positional args for `console.error(...logArgs)`. */
  readonly logArgs: readonly [message: string, error: unknown];
  /** The error to forward to the error tracker's exception capture, unwrapped. */
  readonly reportedError: unknown;
}

/**
 * Describes what a degraded session resolution reports for `error` — the
 * fixed {@link SESSION_DEGRADED_LOG_MESSAGE} paired with the error for the
 * Worker log, and the same error forwarded verbatim (never wrapped or
 * summarised, so issue grouping in the tracker is unaffected).
 *
 * @example
 * ```ts
 * import { describeSessionDegraded, SESSION_DEGRADED_LOG_MESSAGE } from "@thomasfosterau/effect-web"
 *
 * const error = new Error("db down")
 * const report = describeSessionDegraded(error)
 * report.logArgs[0] === SESSION_DEGRADED_LOG_MESSAGE // true
 * report.reportedError === error // true
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const describeSessionDegraded = (error: unknown): SessionDegradedReport => ({
  logArgs: [SESSION_DEGRADED_LOG_MESSAGE, error],
  reportedError: error,
});
