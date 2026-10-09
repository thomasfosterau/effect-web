/**
 * Unit tests for the degraded-session report. `SESSION_DEGRADED_LOG_MESSAGE`
 * is pinned verbatim: it is a fixed string that a consumer's log queries and
 * tests match on.
 */
import { describe, expect, it } from "vite-plus/test";
import { describeSessionDegraded, SESSION_DEGRADED_LOG_MESSAGE } from "@thomasfosterau/effect-web";

describe("describeSessionDegraded", () => {
  it("pairs the fixed log message with the error and forwards the error verbatim", () => {
    const error = new Error("db down");
    const report = describeSessionDegraded(error);
    expect(report.logArgs).toStrictEqual([SESSION_DEGRADED_LOG_MESSAGE, error]);
    expect(report.reportedError).toBe(error);
  });

  it("never wraps a non-Error value either", () => {
    expect(describeSessionDegraded("boom").reportedError).toBe("boom");
  });
});
