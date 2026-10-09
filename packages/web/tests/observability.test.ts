/**
 * Unit tests for `./observability`: the structured span logger, the
 * JSON-line sink, the event trio and the auth-outcome signal.
 *
 * `spanTracer` is a plain `Tracer.Tracer` implementation (built via
 * `Tracer.make`, Effect's own tracer extension point) whose completion
 * side-effect — a tracked span logs through `effect/Logger` — is what these
 * tests exercise, so they drive it directly through `Effect.withSpan` +
 * `Effect.provideService` and assert on that line — no telemetry-vendor
 * dependency, no client graph to mock out.
 */

/*
 * A vitest test body IS the runtime boundary — it is the entrypoint that runs
 * the effect under test, and `effect-run-in-body` has no entrypoint detection.
 */
/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import {
  deriveAuthOutcome,
  describeError,
  logAuthOutcome,
  logErrorEvent,
  logEvent,
  logStructured,
  logWarningEvent,
  spanTracer,
} from "@thomasfosterau/effect-web/observability";

/**
 * Decodes one logged line back into a record — the read side of the sink's
 * `Schema.fromJsonString(Schema.Unknown)` encoder, so the assertions go
 * through a schema rather than `JSON.parse` + a cast.
 */
const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/**
 * A realistic tracked set (dotted operation names, parents and their
 * children) — the tests use it rather than arbitrary names because the
 * allow-list is the property under test.
 */
const tracer = spanTracer([
  "operations.search",
  "operations.search.embedding",
  "operations.search.db",
  "operations.hydrateSearchResults",
  "operations.rerankSearchHits",
]);

describe("spanTracer", () => {
  it("logs a structured span line for a tracked span name on success", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Effect.succeed("ok").pipe(
      Effect.withSpan("operations.search"),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.runPromise,
    );

    expect(log).toHaveBeenCalledTimes(1);
    const line = decodeLine(log.mock.calls[0]?.[0]);
    expect(line).toMatchObject({ event: "span", name: "operations.search", ok: true });
    expect(typeof line.durationMs).toBe("number");
    // SAFETY: the line above asserted `durationMs` is a number.
    expect(line.durationMs as number).toBeGreaterThanOrEqual(0);
    expect(typeof line.traceId).toBe("string");
    expect(typeof line.spanId).toBe("string");

    log.mockRestore();
  });

  it("does not log a span whose name isn't in the tracked allow-list", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Effect.succeed("ok").pipe(
      Effect.withSpan("some.untracked.span"),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.runPromise,
    );

    expect(log).not.toHaveBeenCalled();

    log.mockRestore();
  });

  it("takes the allow-list as its parameter: another tracer, another set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const other = spanTracer(["some.untracked.span"]);

    await Effect.succeed("ok").pipe(
      Effect.withSpan("some.untracked.span"),
      Effect.provideService(Tracer.Tracer, other),
      Effect.runPromise,
    );
    await Effect.succeed("ok").pipe(
      Effect.withSpan("operations.search"),
      Effect.provideService(Tracer.Tracer, other),
      Effect.runPromise,
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(decodeLine(log.mock.calls[0]?.[0])).toMatchObject({ name: "some.untracked.span" });

    log.mockRestore();
  });

  it("logs ok: false when a tracked span's effect fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Effect.runPromiseExit(
      Effect.fail("boom").pipe(
        Effect.withSpan("operations.search"),
        Effect.provideService(Tracer.Tracer, tracer),
      ),
    );

    expect(log).toHaveBeenCalledTimes(1);
    const line = decodeLine(log.mock.calls[0]?.[0]);
    expect(line).toMatchObject({ event: "span", name: "operations.search", ok: false });

    log.mockRestore();
  });

  it("propagates the parent's traceId to a tracked child span", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Effect.succeed("child").pipe(
      Effect.withSpan("operations.search.db"),
      Effect.andThen((value) => Effect.succeed(value)),
      Effect.withSpan("operations.search"),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.runPromise,
    );

    expect(log).toHaveBeenCalledTimes(2);
    const lines = log.mock.calls.map((call) => decodeLine(call[0]));
    const child = lines.find((line) => line.name === "operations.search.db");
    const parent = lines.find((line) => line.name === "operations.search");
    expect(child?.traceId).toBeDefined();
    expect(child?.traceId).toBe(parent?.traceId);
    expect(child?.spanId).not.toBe(parent?.spanId);

    log.mockRestore();
  });

  it("gives independent top-level tracked spans distinct traceIds", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Effect.succeed("a").pipe(
      Effect.withSpan("operations.search"),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.runPromise,
    );
    await Effect.succeed("b").pipe(
      Effect.withSpan("operations.hydrateSearchResults"),
      Effect.provideService(Tracer.Tracer, tracer),
      Effect.runPromise,
    );

    expect(log).toHaveBeenCalledTimes(2);
    const [first, second] = log.mock.calls.map((call) => decodeLine(call[0]));
    expect(first?.traceId).not.toBe(second?.traceId);

    log.mockRestore();
  });
});

describe("logStructured", () => {
  it("emits exactly one flat JSON line, envelope-free, with the keys in insertion order", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    logStructured({ event: "read-path.db", dbQueryCount: 3, path: "/posts", skipped: undefined });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe(
      '{"event":"read-path.db","dbQueryCount":3,"path":"/posts"}',
    );

    log.mockRestore();
  });

  it("logs unconditionally, whatever the ambient minimum log level", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await Effect.sync(() => logStructured({ event: "x" })).pipe(
      Effect.provideService(References.MinimumLogLevel, "Fatal"),
      Effect.runPromise,
    );

    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

describe("logAuthOutcome / deriveAuthOutcome", () => {
  it("emits the read-path.auth line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logAuthOutcome(12.5, "resolved");
    expect(log.mock.calls[0]?.[0]).toBe(
      '{"event":"read-path.auth","durationMs":12.5,"outcome":"resolved"}',
    );
    log.mockRestore();
  });

  it("labels the same condition the same way", () => {
    const base = {
      bindingMissing: false,
      hasCookie: false,
      sessionError: false,
      sessionResolved: false,
    };
    expect(deriveAuthOutcome(base)).toBe("skipped");
    expect(deriveAuthOutcome({ ...base, hasApiKey: true })).toBe("anonymous");
    expect(deriveAuthOutcome({ ...base, hasCookie: true, sessionResolved: true })).toBe("resolved");
    expect(deriveAuthOutcome({ ...base, hasCookie: true })).toBe("anonymous");
    expect(deriveAuthOutcome({ ...base, bindingMissing: true })).toBe("degraded");
    expect(deriveAuthOutcome({ ...base, hasCookie: true, sessionError: true })).toBe("degraded");
  });
});

describe("the event trio", () => {
  /** A recording logger: captures level, message and annotations per line. */
  const record = <A, E>(effect: Effect.Effect<A, E>) => {
    const lines: Array<{ level: string; message: unknown; annotations: Record<string, unknown> }> =
      [];
    const logger = Logger.make(({ logLevel, message, fiber }) => {
      lines.push({
        level: logLevel,
        message,
        annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
      });
    });
    return Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([logger])))).then(() => lines);
  };

  it("carries the event name as both message and annotation, with the fields as annotations", async () => {
    const lines = await record(logEvent("feed.consume", { cycleId: "c1", outcome: "ok" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("Info");
    expect(lines[0]?.message).toStrictEqual(["feed.consume"]);
    expect(lines[0]?.annotations).toStrictEqual({
      event: "feed.consume",
      cycleId: "c1",
      outcome: "ok",
    });
  });

  it("uses the warning and error levels for the degraded and failed variants", async () => {
    const [warning] = await record(logWarningEvent("queue.dropped"));
    const [error] = await record(logErrorEvent("crawl.failed", { error: "boom" }));
    expect(warning?.level).toBe("Warn");
    expect(warning?.annotations).toStrictEqual({ event: "queue.dropped" });
    expect(error?.level).toBe("Error");
    expect(error?.annotations).toStrictEqual({ event: "crawl.failed", error: "boom" });
  });
});

describe("describeError", () => {
  it("renders tagged errors as Tag: message, and falls back to String", () => {
    expect(describeError({ _tag: "FetchFailed", message: "timeout" })).toBe("FetchFailed: timeout");
    expect(describeError({ _tag: "Interrupted" })).toBe("Interrupted");
    expect(describeError({ _tag: "Empty", message: "" })).toBe("Empty");
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError(42)).toBe("42");
    expect(describeError(null)).toBe("null");
  });
});
