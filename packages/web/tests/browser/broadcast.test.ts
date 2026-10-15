/**
 * Unit tests for `./browser`'s `Broadcast`, driven through `./testing`'s
 * in-memory `TestBroadcast` hub.
 */

/*
 * A vitest test body IS the runtime boundary — it is the entrypoint that runs
 * the effect under test, and `effect-run-in-body` has no entrypoint detection.
 */
/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Broadcast } from "@thomasfosterau/effect-web/browser";
import { TestBroadcast } from "@thomasfosterau/effect-web/testing";

const Ping = Schema.Struct({ type: Schema.Literal("ping"), at: Schema.Number });

describe("Broadcast.channel", () => {
  it("delivers a published value to every other channel of the same name, never to itself", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const tabA = yield* Broadcast.channel("sync", Ping);
            const tabB = yield* Broadcast.channel("sync", Ping);
            const other = yield* Broadcast.channel("other", Ping);
            const control = yield* TestBroadcast.Control;
            const ownInbox = yield* tabA.subscribe;
            const otherInbox = yield* other.subscribe;
            const inbox = yield* tabB.subscribe;
            yield* tabA.publish({ type: "ping", at: 1 });
            // B's delivery is the last a post schedules; A and `other` have
            // had theirs by the time it arrives.
            const received = yield* Stream.runHead(inbox);
            const own = yield* Stream.runCollect(Stream.take(ownInbox, 1)).pipe(
              Effect.timeoutOption("5 millis"),
            );
            const elsewhere = yield* Stream.runCollect(Stream.take(otherInbox, 1)).pipe(
              Effect.timeoutOption("5 millis"),
            );
            return { received, own, elsewhere, posted: yield* control.posted };
          }),
        ),
        TestBroadcast.layer,
      ),
    );
    expect(result).toStrictEqual({
      received: Option.some({ type: "ping", at: 1 }),
      own: Option.none(),
      elsewhere: Option.none(),
      posted: [{ channel: "sync", message: { type: "ping", at: 1 } }],
    });
  });

  it("drops messages that do not decode, and keeps listening", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const channel = yield* Broadcast.channel("sync", Ping);
            const control = yield* TestBroadcast.Control;
            const inbox = yield* channel.subscribe;
            yield* control.deliver("sync", { type: "pong" });
            yield* control.deliver("sync", { type: "ping", at: 2 });
            return yield* Stream.runCollect(Stream.take(inbox, 1));
          }),
        ),
        TestBroadcast.layer,
      ),
    );
    expect(result).toStrictEqual([{ type: "ping", at: 2 }]);
  });

  it("listens from the moment `messages` runs", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const channel = yield* Broadcast.channel("sync", Ping);
            const control = yield* TestBroadcast.Control;
            const head = yield* Effect.forkChild(Stream.runHead(channel.messages));
            // Re-deliver until the stream, once listening, takes one.
            const deliverEach = Effect.forever(
              Effect.andThen(
                control.deliver("sync", { type: "ping", at: 3 }),
                Effect.sleep("1 millis"),
              ),
            );
            return yield* Effect.raceFirst(Fiber.join(head), deliverEach);
          }),
        ),
        TestBroadcast.layer,
      ),
    );
    expect(result).toStrictEqual(Option.some({ type: "ping", at: 3 }));
  });

  it("encodes through the schema before posting", async () => {
    const Counted = Schema.Struct({ count: Schema.NumberFromString });
    const posted = await Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const channel = yield* Broadcast.channel("count", Counted);
            yield* channel.publish({ count: 5 });
            return yield* Effect.flatMap(TestBroadcast.Control, (control) => control.posted);
          }),
        ),
        TestBroadcast.layer,
      ),
    );
    expect(posted).toStrictEqual([{ channel: "count", message: { count: "5" } }]);
  });
});

describe("Broadcast.open", () => {
  it("fails DataClone for an uncloneable message and Closed after its scope", async () => {
    const { broadcast } = TestBroadcast.make();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const channel = yield* Effect.scoped(
          Effect.gen(function* () {
            const raw = yield* broadcast.open("raw");
            const clone = yield* Effect.flip(raw.post({ run: () => undefined }));
            return { raw, clone };
          }),
        );
        const closed = yield* Effect.flip(channel.raw.post("late"));
        return { clone: channel.clone, closed };
      }),
    );
    expect(result.clone).toMatchObject({
      _tag: "BroadcastError",
      channel: "raw",
      reason: "DataClone",
      message: "channel 'raw': DataClone",
    });
    expect(result.closed.reason).toBe("Closed");
  });

  it("passes undecoded values through the raw channel", async () => {
    const { broadcast, control } = TestBroadcast.make();
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const raw = yield* broadcast.open("raw");
          const inbox = yield* raw.subscribe;
          yield* control.deliver("raw", { anything: [1, 2] });
          return yield* Stream.runCollect(Stream.take(inbox, 1));
        }),
      ),
    );
    expect(seen).toStrictEqual([{ anything: [1, 2] }]);
  });

  it("is unsupported without BroadcastChannel, and maps a throwing factory", async () => {
    const unsupported = Broadcast.make(undefined);
    expect(unsupported.supported).toBe(false);
    const missing = await Effect.runPromise(Effect.flip(Effect.scoped(unsupported.open("x"))));
    expect(missing.reason).toBe("Unsupported");
    const throwing = Broadcast.make(() => {
      throw new DOMException("no", "UnknownError");
    });
    const failed = await Effect.runPromise(Effect.flip(Effect.scoped(throwing.open("x"))));
    expect(failed.reason).toBe("Failed");
  });

  it("builds the live layer over Node's BroadcastChannel", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const broadcast = yield* Broadcast.Broadcast;
            const channel = yield* broadcast.open("live-test");
            yield* channel.post("hello");
            return broadcast.supported;
          }),
        ),
        Broadcast.layer,
      ),
    );
    expect(result).toBe(true);
  });
});

describe("Broadcast stream lifetime", () => {
  it("ends a subscription's stream when the channel's scope closes", async () => {
    const { broadcast } = TestBroadcast.make();
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const inbox = yield* Effect.scoped(
          Effect.flatMap(broadcast.open("ending"), (raw) => raw.subscribe),
        );
        return yield* Stream.runCollect(inbox).pipe(Effect.timeoutOption("1 second"));
      }),
    );
    expect(collected).toStrictEqual(Option.some([]));
  });
});
