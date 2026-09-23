/**
 * Unit tests for the queue glue: the best-effort producers (gardeneria's
 * `packages/jobs/src/producer.ts`), the chunked batch (preferenceflow's
 * `packages/jobs/src/queue.ts`), drop-and-warn decoding (gardeneria's
 * `queues.ts` / preferenceflow's `consume.ts`) and the consumer prelude
 * (preferenceflow's `apps/worker/src/handlers.ts`).
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { workerEnv } from "@thomasfosterau/effect-web-cloudflare";
import {
  consumeBatch,
  decodeQueueMessage,
  ENQUEUE_CHUNK,
  enqueueBatchBestEffort,
  enqueueBestEffort,
  MissingHyperdrive,
  type QueueProducer,
  sendBatchChunked,
} from "@thomasfosterau/effect-web-cloudflare/queues";

/** A recording producer with both methods. */
const recording = () => {
  const sent: Array<unknown> = [];
  const batches: Array<number> = [];
  const queue: QueueProducer = {
    send: async (body, options) => {
      sent.push({ body, delaySeconds: options?.delaySeconds });
    },
    sendBatch: async (messages) => {
      batches.push(messages.length);
      for (const message of messages) sent.push({ body: message.body });
    },
  };
  return { queue, sent, batches };
};

describe("enqueueBestEffort", () => {
  it("sends through the binding, passing the delay option through", async () => {
    const { queue, sent } = recording();
    await Effect.runPromise(enqueueBestEffort(Option.some(queue), { id: 1 }, { delaySeconds: 30 }));
    expect(sent).toEqual([{ body: { id: 1 }, delaySeconds: 30 }]);
  });

  it("no-ops when the binding is absent", async () => {
    await expect(
      Effect.runPromise(enqueueBestEffort(Option.none(), { id: 1 })),
    ).resolves.toBeUndefined();
  });

  it("no-ops when the binding is present but has no send (an unconfigured stage)", async () => {
    // SAFETY: the placeholder shape under test — a binding object with no `send`.
    const placeholder = {} as QueueProducer;
    await expect(
      Effect.runPromise(enqueueBestEffort(Option.some(placeholder), { id: 1 })),
    ).resolves.toBeUndefined();
  });

  it("swallows a rejecting send — the write must not fail because the queue did", async () => {
    const queue: QueueProducer = {
      send: async () => {
        throw new Error("queue down");
      },
    };
    await expect(
      Effect.runPromise(enqueueBestEffort(Option.some(queue), { id: 1 })),
    ).resolves.toBeUndefined();
  });
});

describe("enqueueBatchBestEffort", () => {
  it("prefers sendBatch, in chunks of ENQUEUE_CHUNK", async () => {
    const { queue, sent, batches } = recording();
    const messages = Array.from({ length: 250 }, (_, i) => i);
    await Effect.runPromise(enqueueBatchBestEffort(queue, messages));
    expect(ENQUEUE_CHUNK).toBe(100);
    expect(batches).toEqual([100, 100, 50]);
    expect(sent).toHaveLength(250);
  });

  it("falls back to one send per message when the binding has no sendBatch", async () => {
    const sent: Array<unknown> = [];
    const queue: QueueProducer = {
      send: async (body) => {
        sent.push(body);
      },
    };
    await Effect.runPromise(enqueueBatchBestEffort(queue, ["a", "b"]));
    expect(sent).toEqual(["a", "b"]);
  });

  it("does nothing for an empty batch", async () => {
    const { queue, batches } = recording();
    await Effect.runPromise(enqueueBatchBestEffort(queue, []));
    expect(batches).toEqual([]);
  });

  it("swallows a rejecting batch", async () => {
    const queue: QueueProducer = {
      send: async () => {},
      sendBatch: async () => {
        throw new Error("queue down");
      },
    };
    await expect(Effect.runPromise(enqueueBatchBestEffort(queue, [1, 2]))).resolves.toBeUndefined();
  });
});

describe("sendBatchChunked", () => {
  it("chunks to ENQUEUE_CHUNK and reports the total sent", async () => {
    const sizes: Array<number> = [];
    const client = {
      sendBatch: (messages: ReadonlyArray<Cloudflare.Queues.SendMessage>) =>
        Effect.sync(() => {
          sizes.push(messages.length);
        }),
    };
    const total = await Effect.runPromise(
      sendBatchChunked(
        client,
        Array.from({ length: 150 }, (_, i) => ({ body: i })),
      ),
    );
    expect(total).toBe(150);
    expect(sizes).toEqual([100, 50]);
  });

  it("propagates the client's SendError — the caller decides whether a lost enqueue is fatal", async () => {
    const client = {
      sendBatch: () => Effect.fail(new Cloudflare.Queues.SendError({ message: "rejected" })),
    };
    const exit = await Effect.runPromiseExit(sendBatchChunked(client, [{ body: 1 }]));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("decodeQueueMessage", () => {
  const Job = Schema.Struct({ id: Schema.String });
  const decode = decodeQueueMessage(Job, "EMBED_QUEUE");

  it("decodes a well-formed body", async () => {
    const got = await Effect.runPromise(decode({ id: "n1" }));
    expect(got).toEqual(Option.some({ id: "n1" }));
  });

  it("drops a malformed body with a <queue>.drop warning naming the queue", async () => {
    const lines: Array<{ readonly message: unknown; readonly annotations: unknown }> = [];
    const capture = Logger.make<unknown, void>(({ message, fiber }) => {
      lines.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
    });
    const got = await Effect.runPromise(
      decode({ nope: true }).pipe(
        Effect.provide(Logger.layer([capture])),
        Effect.provideService(References.MinimumLogLevel, "All"),
      ),
    );
    expect(Option.isNone(got)).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toEqual(["EMBED_QUEUE.drop"]);
    expect(lines[0]?.annotations).toMatchObject({
      event: "EMBED_QUEUE.drop",
      queue: "EMBED_QUEUE",
    });
  });
});

describe("consumeBatch", () => {
  interface Env {
    readonly HYPERDRIVE?: { readonly connectionString: string } | undefined;
  }
  const message = (body: unknown): Cloudflare.Queues.Message => ({
    body,
    id: "m",
    timestamp: new Date(0),
    attempts: 1,
    ack() {},
    retry() {},
  });
  const run = <E>(
    stream: Stream.Stream<Cloudflare.Queues.Message>,
    env: Env,
    handler: (bodies: ReadonlyArray<unknown>, env: Env) => Effect.Effect<void, E>,
    hyperdrive?: Option.Option<string>,
  ) =>
    Effect.runPromiseExit(
      consumeBatch(stream, handler, { env: workerEnv<Env>(), hyperdrive }).pipe(
        Effect.provideService(Cloudflare.WorkerEnvironment, env),
      ),
    );

  it("collects the batch's bodies and hands them to run with the env", async () => {
    const seen: Array<unknown> = [];
    let seenEnv: Env | undefined;
    const env: Env = { HYPERDRIVE: { connectionString: "postgresql://…" } };
    const exit = await run(
      Stream.fromIterable([message({ id: 1 }), message({ id: 2 })]),
      env,
      (bodies, e) =>
        Effect.sync(() => {
          seen.push(...bodies);
          seenEnv = e;
        }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
    expect(seenEnv).toBe(env);
  });

  it("fails the whole batch fast with MissingHyperdrive when the binding is absent", async () => {
    let ran = false;
    const exit = await run(Stream.fromIterable([message({ id: 1 })]), {}, () =>
      Effect.sync(() => {
        ran = true;
      }),
    );
    expect(ran).toBe(false);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("MissingHyperdrive");
    }
    expect(new MissingHyperdrive({ binding: "HYPERDRIVE" }).binding).toBe("HYPERDRIVE");
  });

  it("skips the Hyperdrive check for a consumer that never reaches Postgres", async () => {
    let ran = false;
    const exit = await run(
      Stream.fromIterable([message({ id: 1 })]),
      {},
      () =>
        Effect.sync(() => {
          ran = true;
        }),
      Option.none(),
    );
    expect(ran).toBe(true);
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("propagates run's own failure so the batch retries", async () => {
    const exit = await run(
      Stream.fromIterable([message({ id: 1 })]),
      { HYPERDRIVE: { connectionString: "postgresql://…" } },
      () => Effect.fail("infrastructure"),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
