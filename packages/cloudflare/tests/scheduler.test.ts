/**
 * Unit tests for the `Scheduler` Effect → `ExecutionContext.waitUntil`
 * bridge — website's `packages/bindings/tests/scheduler.test.ts`.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { Scheduler, schedulerLayer } from "@thomasfosterau/effect-web-cloudflare";

describe("Scheduler.waitUntil", () => {
  it("runs the effect and hands the Promise to ctx.waitUntil when ctx is present", async () => {
    const handed: Array<Promise<unknown>> = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        handed.push(p);
      },
    };
    let didRun = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* scheduler.waitUntil(
          Effect.sync(() => {
            didRun = true;
          }),
        );
      }).pipe(Effect.provide(schedulerLayer(ctx))),
    );
    expect(handed.length).toBe(1);
    await handed[0];
    expect(didRun).toBe(true);
  });

  it("runs the effect detached when no ctx is provided", async () => {
    let didRun = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* scheduler.waitUntil(
          Effect.sync(() => {
            didRun = true;
          }),
        );
      }).pipe(Effect.provide(schedulerLayer(undefined))),
    );
    // Allow the detached promise to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(didRun).toBe(true);
  });

  it("swallows a detached failure instead of raising an unhandled rejection", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        yield* scheduler.waitUntil(Effect.fail("boom"));
      }).pipe(Effect.provide(schedulerLayer(undefined))),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Reaching here without vitest reporting an unhandled rejection is the assertion.
    expect(true).toBe(true);
  });
});
