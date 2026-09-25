/**
 * Cloudflare Queues glue the applications scattered across their jobs
 * packages and Workers — everything that is not already alchemy's own
 * `consumeQueueMessages` / `EventSourceLive` / `CronEventSourceLive`:
 *
 * - the **producer side** ({@link enqueueBestEffort},
 *   {@link enqueueBatchBestEffort}, {@link sendBatchChunked}): gardeneria's
 *   `packages/jobs/src/producer.ts` (website inlines it in
 *   `embedding/queue.ts`) and preferenceflow's `sendBatch` chunking;
 * - the **consumer side** ({@link decodeQueueMessage}, {@link consumeBatch},
 *   {@link MissingHyperdrive}): gardeneria's `queues.ts`, preferenceflow's
 *   `consume.ts` / `apps/worker/src/handlers.ts` and website's
 *   `apps/worker/src/worker.ts`.
 *
 * @since 0.1.0
 */
import type * as Cloudflare from "alchemy/Cloudflare";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describeError, logWarningEvent } from "@thomasfosterau/effect-web/observability";

/**
 * Minimal shape of a Cloudflare Queue producer binding (`env.EMBED_QUEUE`,
 * `env.FEED_QUEUE`, …). Structural rather than the platform's `Queue<T>`:
 * only this much of the binding is ever used, and an unconfigured stage's
 * placeholder may lack `sendBatch`.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueueProducer {
  /** `options` is a passthrough for a delayed re-enqueue (`delaySeconds`, PERF-PIPE-001). */
  send(body: unknown, options?: { readonly delaySeconds?: number | undefined }): Promise<void>;
  sendBatch?(messages: ReadonlyArray<{ readonly body: unknown }>): Promise<void>;
}

/**
 * Cloudflare Queues cap `sendBatch` at 100 messages (PERF-PIPE-001).
 *
 * @since 0.1.0
 * @category constants
 */
export const ENQUEUE_CHUNK = 100;

/**
 * Enqueues one message, swallowing every failure — including an absent
 * binding, and a binding that is present but has no `send` (what an
 * unconfigured stage's placeholder looks like).
 *
 * **Enqueue is best-effort.** A producer runs on the request path — the
 * write that wants an embedding, the comment that wants a notification — and
 * the queue is the least important thing in that request. So a failed
 * enqueue is swallowed rather than propagated: the write must not fail
 * because a queue was unavailable, and the job is either recovered by a sweep
 * or simply not done. Swallowing is a decision, not an oversight, which is
 * why it lives in one documented place rather than an `Effect.ignore` per
 * producer.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { enqueueBestEffort } from "@thomasfosterau/effect-web-cloudflare/queues"
 *
 * const sent: Array<unknown> = []
 * const queue = { send: async (body: unknown) => { sent.push(body) } }
 * await Effect.runPromise(enqueueBestEffort(Option.some(queue), { id: 1 }))
 * await Effect.runPromise(enqueueBestEffort(Option.none(), { id: 2 })) // no binding: swallowed
 * sent // [{ id: 1 }]
 * ```
 *
 * @since 0.1.0
 * @category producers
 */
export const enqueueBestEffort = (
  queue: Option.Option<QueueProducer>,
  message: unknown,
  options?: { readonly delaySeconds?: number | undefined },
): Effect.Effect<void> =>
  Option.isNone(queue) || !Predicate.isFunction(queue.value.send)
    ? Effect.void
    : Effect.tryPromise(() => queue.value.send(message, options)).pipe(
        // Swallowed by design — see the doc above.
        Effect.ignore,
      );

/**
 * Enqueues messages in chunks of {@link ENQUEUE_CHUNK}, preferring the
 * binding's batch API (one round-trip per chunk) and falling back to one
 * `send` per message when it has none. Failures are swallowed exactly as
 * {@link enqueueBestEffort} swallows them.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { enqueueBatchBestEffort } from "@thomasfosterau/effect-web-cloudflare/queues"
 *
 * const batches: Array<number> = []
 * const queue = {
 *   send: async () => {},
 *   sendBatch: async (messages: ReadonlyArray<{ readonly body: unknown }>) => { batches.push(messages.length) },
 * }
 * await Effect.runPromise(enqueueBatchBestEffort(queue, Array.from({ length: 250 }, (_, i) => i)))
 * batches // [100, 100, 50]
 * ```
 *
 * @since 0.1.0
 * @category producers
 */
export const enqueueBatchBestEffort = (
  queue: QueueProducer,
  messages: ReadonlyArray<unknown>,
): Effect.Effect<void> =>
  Arr.match(messages, {
    onEmpty: () => Effect.void,
    onNonEmpty: (all) => {
      const sendBatch = queue.sendBatch;
      if (Predicate.isFunction(sendBatch)) {
        return Effect.forEach(
          Arr.chunksOf(all, ENQUEUE_CHUNK),
          (chunk) =>
            Effect.tryPromise(() =>
              sendBatch.call(
                queue,
                chunk.map((body) => ({ body })),
              ),
            ).pipe(Effect.ignore),
          // Sequential: the producer runs on the request path and one
          // in-flight batch call at a time is the applications' behaviour.
          { concurrency: 1, discard: true },
        );
      }
      return Effect.forEach(all, (message) => enqueueBestEffort(Option.some(queue), message), {
        concurrency: 1,
        discard: true,
      });
    },
  });

/**
 * `sendBatch` on alchemy's `WriteQueue` client, chunked to
 * {@link ENQUEUE_CHUNK} so N messages cost ⌈N/100⌉ round trips rather than N
 * or a rejected over-size batch. Fails with the binding's `SendError`; the
 * caller decides whether a lost enqueue is fatal (for a crawl it is not: the
 * rows already exist and a sweep re-enqueues stale ones).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { sendBatchChunked } from "@thomasfosterau/effect-web-cloudflare/queues"
 *
 * const sizes: Array<number> = []
 * const client = { sendBatch: (messages: ReadonlyArray<{ readonly body: unknown }>) => Effect.sync(() => { sizes.push(messages.length) }) }
 * const sent = await Effect.runPromise(sendBatchChunked(client, Array.from({ length: 150 }, (_, i) => ({ body: i }))))
 * sent // 150
 * sizes // [100, 50]
 * ```
 *
 * @since 0.1.0
 * @category producers
 */
export const sendBatchChunked = <E, R>(
  client: {
    readonly sendBatch: (
      messages: ReadonlyArray<Cloudflare.Queues.SendMessage>,
    ) => Effect.Effect<void, E, R>;
  },
  messages: ReadonlyArray<Cloudflare.Queues.SendMessage>,
): Effect.Effect<number, E, R> =>
  Effect.forEach(Arr.chunksOf(messages, ENQUEUE_CHUNK), (chunk) => client.sendBatch(chunk), {
    // Sequential, so a `SendError` on chunk N leaves chunks < N sent and
    // > N unsent — a bounded, describable partial failure.
    concurrency: 1,
    discard: true,
  }).pipe(Effect.as(messages.length));

/**
 * Decodes one queue message body, or `None` for a malformed one — the
 * consumer-side convention every queue shares: a malformed message is
 * dropped, not retried, since it will never become valid, and the drop is
 * logged (a `<queue>.drop` warning event with the decode failure) so a
 * producer bug is visible off the request path.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import * as Schema from "effect/Schema"
 * import { decodeQueueMessage } from "@thomasfosterau/effect-web-cloudflare/queues"
 *
 * const decode = decodeQueueMessage(Schema.Struct({ id: Schema.String }), "EMBED_QUEUE")
 * await Effect.runPromise(decode({ id: "n1" })) // Option.some({ id: "n1" })
 * Option.isNone(await Effect.runPromise(decode({ nope: true }))) // true — dropped with a warning
 * ```
 *
 * @since 0.1.0
 * @category consumers
 */
export const decodeQueueMessage =
  <A, I>(schema: Schema.Codec<A, I>, queue: string) =>
  (body: unknown): Effect.Effect<Option.Option<A>> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.asSome,
      Effect.catch((error) =>
        logWarningEvent(`${queue}.drop`, { queue, reason: describeError(error) }).pipe(
          Effect.as(Option.none<A>()),
        ),
      ),
    );

/**
 * Failed (and so retried) when a consumer batch runs without the Hyperdrive
 * binding — the handler cannot reach Postgres, so the whole batch fails fast
 * rather than each downstream query discovering it independently. Tagged so
 * the event source's retry log names it.
 *
 * @since 0.1.0
 * @category errors
 */
export class MissingHyperdrive extends Schema.TaggedError<MissingHyperdrive>()(
  "MissingHyperdrive",
  {
    binding: Schema.String,
  },
) {}

/**
 * Options for {@link consumeBatch}.
 *
 * @since 0.1.0
 * @category models
 */
export interface ConsumeBatchOptions<Env> {
  /** The runtime `env`, narrowed — `workerEnv<PipelineWorkerEnv>()`. */
  readonly env: Effect.Effect<Env, never, Cloudflare.WorkerEnvironment>;
  /**
   * The env key the Hyperdrive binding lives under; the batch fails with
   * {@link MissingHyperdrive} when it is absent. Defaults to `"HYPERDRIVE"`.
   * Pass `Option.none()` for a consumer that never reaches Postgres.
   */
  readonly hyperdrive?: Option.Option<string> | undefined;
}

/**
 * The shared consumer prelude: read the runtime `env`, fail the whole batch
 * fast when Hyperdrive is unbound (so it retries rather than every query
 * discovering the missing pool on its own), collect the batch's message
 * bodies, then hand them to the queue-specific `run` — which decodes /
 * filters the bodies and `Effect.provide`s the batch processor its own
 * per-event layer. `run` is fully provided by the time it returns, so the
 * only outer requirement is `WorkerEnvironment`.
 *
 * Ack / retry: alchemy's `consumeQueueMessages` acks the whole batch when the
 * handler succeeds and retries it when it fails, so `run` keeps
 * message-level failures out of its error channel (recorded on their rows,
 * or dropped by {@link decodeQueueMessage}) and fails only for an
 * infrastructure failure.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import * as Stream from "effect/Stream"
 * import { workerEnv } from "@thomasfosterau/effect-web-cloudflare"
 * import { consumeBatch } from "@thomasfosterau/effect-web-cloudflare/queues"
 *
 * interface Env { readonly HYPERDRIVE?: { readonly connectionString: string } | undefined }
 * const seen: Array<unknown> = []
 * const message = (body: unknown) => ({ body, id: "m", timestamp: new Date(), attempts: 1, ack() {}, retry() {} })
 * await Effect.runPromise(
 *   consumeBatch(
 *     Stream.fromIterable([message({ id: 1 }), message({ id: 2 })]),
 *     (bodies) => Effect.sync(() => { seen.push(...bodies) }),
 *     { env: workerEnv<Env>() },
 *   ).pipe(Effect.provideService(Cloudflare.WorkerEnvironment, { HYPERDRIVE: { connectionString: "postgresql://…" } })),
 * )
 * seen // [{ id: 1 }, { id: 2 }]
 * ```
 *
 * @since 0.1.0
 * @category consumers
 */
export const consumeBatch = <Env, E>(
  stream: Stream.Stream<Cloudflare.Queues.Message>,
  run: (bodies: ReadonlyArray<unknown>, env: Env) => Effect.Effect<void, E>,
  options: ConsumeBatchOptions<Env>,
): Effect.Effect<void, E | MissingHyperdrive, Cloudflare.WorkerEnvironment> =>
  Effect.gen(function* () {
    const env = yield* options.env;
    const binding = options.hyperdrive ?? Option.some("HYPERDRIVE");
    if (Option.isSome(binding)) {
      // SAFETY: a structural presence check on the narrowed env; the key is
      // the caller's, and only truthiness is read.
      const bound = (env as Readonly<Record<string, unknown>>)[binding.value];
      if (bound === undefined || bound === null) {
        return yield* new MissingHyperdrive({ binding: binding.value });
      }
    }
    const messages = yield* Stream.runCollect(stream);
    yield* run(
      Arr.map(Arr.fromIterable(messages), (message) => message.body),
      env,
    );
  });
