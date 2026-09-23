/**
 * Pins the behaviour `./browser` guarantees its callers — the applications'
 * `tests/unit/analytics.test.ts`: PostHog is initialised exactly once per
 * `makeAnalytics` however many call sites fire, a capture made before the
 * client is ready still lands (and lands *after* `init`), and none of it is
 * observable when analytics is off or failing.
 *
 * The import being dynamic is NOT asserted here — a unit runner resolves an
 * injected loader synchronously, so any such assertion would pass just as
 * happily against a static import. That property is only visible over an
 * actual build (PERF-BUNDLE-001 is review-guarded).
 */

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { makeAnalytics, type PostHogJs } from "@thomasfosterau/effect-web-posthog/browser";

class TestFailure extends Schema.TaggedError<TestFailure>()("TestFailure", {
  message: Schema.String,
}) {}

const posthog = {
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
};
// SAFETY: the tests drive only the six methods the wrappers forward.
// oxlint-disable-next-line effect/no-chained-type-assertions -- a hand-written double for the vendor singleton's class.
const load = async () => ({ default: posthog as unknown as PostHogJs });

/** A fresh surface; `token` is passed through as-is, `undefined` included. */
const fresh = (options: { readonly token: string | undefined } = { token: "phc_test_token" }) =>
  makeAnalytics({ token: options.token, host: "https://posthog.example", stage: "unit", load });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("makeAnalytics", () => {
  it("initialises PostHog once, with the /ingest proxy and the stage super-property", async () => {
    const analytics = fresh();
    analytics.init();
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));

    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test_token",
      expect.objectContaining({ api_host: "/ingest", ui_host: "https://posthog.example" }),
    );
    expect(posthog.register).toHaveBeenCalledWith({ environment: "unit" });
  });

  it("initialises once across many concurrent call sites", async () => {
    const analytics = fresh();
    analytics.init();
    analytics.captureEvent("a");
    analytics.identifyUser("user-1");
    analytics.captureEvent("b");
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(2));

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.register).toHaveBeenCalledTimes(1);
  });

  it("captures events queued before the chunk resolves, after init", async () => {
    const analytics = fresh();
    // No init() first: a capture on its own must still initialise.
    analytics.captureEvent("early_event", { n: 1 });
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(1));

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith("early_event", { n: 1 });
    expect(posthog.init.mock.invocationCallOrder[0]).toBeLessThan(
      posthog.capture.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("forwards identify, reset and captureException", async () => {
    const analytics = fresh();
    const error = new TestFailure({ message: "boom" });
    analytics.identifyUser("user-7", { email: "a@b.c" });
    analytics.reset();
    analytics.captureException(error);

    await vi.waitFor(() => expect(posthog.captureException).toHaveBeenCalledWith(error));
    expect(posthog.identify).toHaveBeenCalledWith("user-7", { email: "a@b.c" });
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });

  it("honours a custom apiHost", async () => {
    const analytics = makeAnalytics({
      token: "phc",
      host: undefined,
      stage: undefined,
      apiHost: "/ph",
      load,
    });
    analytics.init();
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));
    expect(posthog.init).toHaveBeenCalledWith(
      "phc",
      expect.objectContaining({ api_host: "/ph", ui_host: "" }),
    );
    expect(posthog.register).toHaveBeenCalledWith({ environment: "" });
  });

  describe("the project token gates whether analytics turns on", () => {
    it("is inert with an absent (undefined) project token — the local-dev and fork-stage state", async () => {
      const analytics = fresh({ token: undefined });
      analytics.init();
      expect(() => analytics.captureEvent("ignored")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(posthog.init).not.toHaveBeenCalled();
      expect(posthog.capture).not.toHaveBeenCalled();
    });

    it('is inert with a blank ("") project token — must never read as configured (commit 9e7114ae)', async () => {
      const analytics = fresh({ token: "" });
      analytics.init();
      expect(() => analytics.captureEvent("ignored")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(posthog.init).not.toHaveBeenCalled();
      expect(posthog.capture).not.toHaveBeenCalled();
    });

    it("initialises with a present, non-blank project token", async () => {
      const analytics = fresh({ token: "phc_present" });
      analytics.init();
      await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));

      expect(posthog.init).toHaveBeenCalledWith("phc_present", expect.anything());
    });
  });

  it("swallows a failure from PostHog rather than surfacing it to the reader", async () => {
    const analytics = fresh();
    posthog.capture.mockImplementationOnce(() => {
      throw new TestFailure({ message: "ingest blocked" });
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    expect(() => analytics.captureEvent("blocked")).not.toThrow();
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("swallows a failing loader the same way", async () => {
    const analytics = makeAnalytics({
      token: "phc",
      host: undefined,
      stage: undefined,
      load: async () => {
        throw new TestFailure({ message: "chunk blocked" });
      },
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    analytics.captureEvent("blocked");
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});
