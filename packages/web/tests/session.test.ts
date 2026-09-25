/**
 * Unit tests for the degraded-session report (website's
 * `session-degraded-report.ts`; gardeneria pins the message in its degraded
 * session unit test).
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
