/**
 * In-memory stand-ins for the Cloudflare bindings an integration harness
 * provides — a KV namespace, an R2 bucket, a queue producer — ported from
 * preferenceflow's `packages/integration-harness/stub-bindings.ts` (the
 * reference), with gardeneria's per-binding queue recording
 * (`peekStubQueue`, `packages/integration-harness/harness.ts`). Each stub
 * implements exactly the native-binding surface alchemy's binding clients
 * call (`env[LogicalId].get(...)`, `.put(...)`, …), so a test exercises the
 * SAME `Cloudflare.KV.ReadWriteNamespace` / `R2.ReadWriteBucket` /
 * `Queues.WriteQueue` clients the deployed Worker runs — only the object
 * behind `env[LogicalId]` differs.
 *
 * Where the applications kept module-scope stores reset per test, these are
 * factories: an application builds its harness's set once
 * ({@link makeStubBindings}) and resets it in a global `beforeEach`.
 *
 * @since 0.1.0
 */
import type { RuntimeContext, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { Self } from "alchemy/Self";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import { runtimeStubsLayer, type AlchemyExecutionContext, type WorkerRuntime } from "../runtime.ts";

// ── KV ───────────────────────────────────────────────────────────────

/**
 * One stored KV entry: the value as written, the `expirationTtl` the `put`
 * carried, and any `metadata`.
 */
interface StubKvEntry {
  readonly value: string | Uint8Array<ArrayBuffer>;
  readonly expirationTtl: Option.Option<number>;
  readonly metadata: unknown;
}

/**
 * The read types the platform's `KVNamespace.get` accepts.
 *
 * @since 0.1.0
 * @category models
 */
export type StubKvGetType = "text" | "json" | "arrayBuffer" | "stream";

/**
 * A KV `list` page, in the platform's shape.
 *
 * @since 0.1.0
 * @category models
 */
export type StubKvListPage =
  | {
      readonly keys: Array<{ readonly name: string; readonly metadata?: unknown }>;
      readonly list_complete: true;
      readonly cacheStatus: null;
    }
  | {
      readonly keys: Array<{ readonly name: string; readonly metadata?: unknown }>;
      readonly list_complete: false;
      readonly cursor: string;
      readonly cacheStatus: null;
    };

/**
 * The `KVNamespace` stub surface: the subset of the Workers runtime
 * interface alchemy's `ReadWriteNamespace` client reaches.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubKvNamespace {
  get(
    key: string | ReadonlyArray<string>,
    typeOrOptions?: StubKvGetType | { readonly type?: StubKvGetType | undefined },
  ): Promise<unknown>;
  getWithMetadata(
    key: string,
    typeOrOptions?: StubKvGetType | { readonly type?: StubKvGetType | undefined },
  ): Promise<{ readonly value: unknown; readonly metadata: unknown }>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { readonly expirationTtl?: number | undefined; readonly metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    readonly prefix?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): Promise<StubKvListPage>;
}

/**
 * A stub KV namespace with its inspection handles.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubKv {
  /** The binding object to put behind `env[LogicalId]`. */
  readonly namespace: StubKvNamespace;
  /**
   * Reads a raw entry by key without going through a cache handle, or
   * `None` when absent. A stored string is JSON-parsed (the shape every
   * cache-style writer stores); bytes come back as written. Exists so a test
   * can prove an assertion is not vacuous: asserting that a cached document
   * is refused means nothing unless it was demonstrably in KV to begin with.
   */
  readonly peek: (key: string) => Option.Option<unknown>;
  /**
   * The `expirationTtl` the caller passed when it last wrote `key`, or
   * `None` if never written through `put` (or written without one) — lets a
   * spec pin a TTL that is a correctness bound rather than a tuning knob.
   */
  readonly peekTtl: (key: string) => Option.Option<number>;
  /**
   * Writes a raw value under `key`, bypassing every write-through gate.
   * Strings are stored as-is; anything else is JSON-serialised. The only way
   * to construct the case that isolates the READ gate: an entry whose state
   * disagrees with the database.
   */
  readonly seed: (key: string, value: unknown) => void;
  /**
   * When `true`, every `get` / `getWithMetadata` rejects, modelling a KV
   * operational fault (or a malformed stored value that makes `get({ type:
   * "json" })` reject). A read-through cache MUST treat this as a miss.
   */
  readonly setGetFault: (faulting: boolean) => void;
  /** Clears values, TTLs and the fault flag. */
  readonly reset: () => void;
}

const entryText = (entry: StubKvEntry): string =>
  Predicate.isString(entry.value) ? entry.value : new TextDecoder().decode(entry.value);

const entryBytes = (entry: StubKvEntry): Uint8Array<ArrayBuffer> =>
  Predicate.isString(entry.value) ? new TextEncoder().encode(entry.value) : entry.value;

const kvReadType = (
  typeOrOptions?: StubKvGetType | { readonly type?: StubKvGetType | undefined },
): StubKvGetType =>
  Predicate.isString(typeOrOptions) ? typeOrOptions : (typeOrOptions?.type ?? "text");

/** Project a stored entry to the requested read type. */
const kvReaders: Record<StubKvGetType, (entry: StubKvEntry) => unknown> = {
  text: entryText,
  json: (entry) => JSON.parse(entryText(entry)),
  arrayBuffer: (entry) => entryBytes(entry).slice().buffer,
  stream: (entry) => new Blob([entryBytes(entry)]).stream(),
};

const kvRead = (entry: StubKvEntry, type: StubKvGetType): unknown => kvReaders[type](entry);

/**
 * A private copy of a view's bytes over a plain `ArrayBuffer` — never the
 * caller's buffer (which may be shared, resizable, or mutated after the put)
 * — so a stored body is immutable.
 */
const copyBytes = (view: ArrayBufferView): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy;
};

/**
 * Every body shape the R2 `put` contract allows, as bytes. `null` mirrors the
 * Workers runtime's contract, where it is a legal EMPTY body.
 */
const toBytes = async (
  // oxlint-disable-next-line effect/prefer-option-over-null -- mirrors the Workers runtime `R2Bucket.put` body contract, where `null` is a legal empty body the binding client forwards verbatim.
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (value === null) return new Uint8Array();
  if (Predicate.isString(value)) return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return copyBytes(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
};

/**
 * Builds an in-memory KV namespace stub. One store per call; back several
 * bindings with the same instance when a test wants them to share (as
 * preferenceflow's `Cache` and `Robots` do).
 *
 * `get` honours the platform's single-key and multi-key overloads and all
 * four read types; `list` honours `prefix`, `limit` and the opaque `cursor`
 * (the next key to start from).
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { makeStubKv } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const kv = makeStubKv()
 * await kv.namespace.put("doc", JSON.stringify({ n: 1 }), { expirationTtl: 60 })
 * await kv.namespace.get("doc", { type: "json" }) // { n: 1 }
 * kv.peekTtl("doc") // Option.some(60)
 * await kv.namespace.get("absent") // null
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeStubKv = (): StubKv => {
  const store = new Map<string, StubKvEntry>();
  let getFault = false;
  const keysWithPrefix = (prefix = ""): ReadonlyArray<string> =>
    Arr.sort(
      Arr.filter(Arr.fromIterable(store.keys()), (key) => key.startsWith(prefix)),
      Order.String,
    );
  const namespace: StubKvNamespace = {
    get: async (key, typeOrOptions) => {
      if (getFault) throw new Error("stub KV get fault");
      const type = kvReadType(typeOrOptions);
      const read = (one: string) => {
        const entry = store.get(one);
        return entry === undefined ? null : kvRead(entry, type);
      };
      if (Predicate.isString(key)) return read(key);
      // oxlint-disable-next-line effect/avoid-native-object-helpers -- the platform's multi-key `get` resolves a native `Map`, and the client under test reads it as one.
      return new Map(Arr.map(key, (one) => [one, read(one)] as const));
    },
    getWithMetadata: async (key, typeOrOptions) => {
      if (getFault) throw new Error("stub KV get fault");
      const entry = store.get(key);
      return entry === undefined
        ? { value: null, metadata: null }
        : { value: kvRead(entry, kvReadType(typeOrOptions)), metadata: entry.metadata ?? null };
    },
    put: async (key, value, options) => {
      store.set(key, {
        value: Predicate.isString(value) ? value : await toBytes(value),
        expirationTtl: Option.fromNullishOr(options?.expirationTtl),
        metadata: options?.metadata,
      });
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async (options) => {
      const limit = options?.limit ?? 1000;
      const all = keysWithPrefix(options?.prefix);
      const found = options?.cursor === undefined ? 0 : all.indexOf(options.cursor);
      const from = found < 0 ? 0 : found;
      const page = all.slice(from, from + limit);
      const keys = page.map((name) => ({ name, metadata: store.get(name)?.metadata }));
      const next = all[from + limit];
      return next === undefined
        ? { keys, list_complete: true, cacheStatus: null }
        : { keys, list_complete: false, cursor: next, cacheStatus: null };
    },
  };
  return {
    namespace,
    peek: (key) =>
      Option.map(Option.fromNullishOr(store.get(key)), (entry) =>
        Predicate.isString(entry.value) ? JSON.parse(entry.value) : entry.value,
      ),
    peekTtl: (key) =>
      Option.flatMap(Option.fromNullishOr(store.get(key)), (entry) => entry.expirationTtl),
    seed: (key, value) => {
      store.set(key, {
        value: Predicate.isString(value) ? value : JSON.stringify(value),
        // A seeded entry never went through `put`, so it carries no TTL.
        expirationTtl: Option.none(),
        metadata: undefined,
      });
    },
    setGetFault: (faulting) => {
      getFault = faulting;
    },
    reset: () => {
      store.clear();
      getFault = false;
    },
  };
};

// ── R2 ───────────────────────────────────────────────────────────────

interface StubR2Entry {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly etag: string;
  readonly uploaded: Date;
  readonly httpMetadata: Record<string, string>;
  readonly customMetadata: Record<string, string>;
}

/**
 * The `R2Object` shape alchemy's client wraps.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubR2Object {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata: Record<string, string>;
  readonly customMetadata: Record<string, string>;
  readonly checksums: Record<string, never>;
  readonly storageClass: "Standard";
  readonly writeHttpMetadata: (headers: Headers) => void;
}

/**
 * An `R2Object` plus the body accessors an `R2ObjectBody` carries.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubR2ObjectBody extends StubR2Object {
  readonly body: ReadableStream;
  readonly bodyUsed: boolean;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
  readonly bytes: () => Promise<Uint8Array<ArrayBuffer>>;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
  readonly blob: () => Promise<Blob>;
}

/**
 * An R2 `list` page, in the platform's shape.
 *
 * @since 0.1.0
 * @category models
 */
export type StubR2ListPage =
  | {
      readonly objects: ReadonlyArray<StubR2Object>;
      readonly delimitedPrefixes: ReadonlyArray<string>;
      readonly truncated: false;
    }
  | {
      readonly objects: ReadonlyArray<StubR2Object>;
      readonly delimitedPrefixes: ReadonlyArray<string>;
      readonly truncated: true;
      readonly cursor: string;
    };

/**
 * The `R2Bucket` stub surface: `put`, `get`, `head`, `delete` and `list`
 * over an in-memory object map. Multipart uploads are not modelled — a test
 * that reaches them fails loudly rather than passing against a fake.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubR2Bucket {
  put(
    key: string,
    // oxlint-disable-next-line effect/prefer-option-over-null -- mirrors the Workers runtime `R2Bucket.put` body contract; see `toBytes`.
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: {
      readonly httpMetadata?: Record<string, string> | Headers | undefined;
      readonly customMetadata?: Record<string, string> | undefined;
    },
  ): Promise<StubR2Object>;
  // oxlint-disable-next-line effect/prefer-option-over-null -- the platform resolves `null` for a missing object, and the binding client under test reads exactly that.
  get(key: string): Promise<StubR2ObjectBody | null>;
  // oxlint-disable-next-line effect/prefer-option-over-null -- same platform contract as `get`.
  head(key: string): Promise<StubR2Object | null>;
  delete(keys: string | ReadonlyArray<string>): Promise<void>;
  list(options?: {
    readonly prefix?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): Promise<StubR2ListPage>;
  createMultipartUpload(): Promise<never>;
  resumeMultipartUpload(): never;
}

/**
 * A stub R2 bucket with its inspection handles.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubR2 {
  /** The binding object to put behind `env[LogicalId]`. */
  readonly bucket: StubR2Bucket;
  /** An archived object's bytes straight from the store (a copy), or `None`. */
  readonly peek: (key: string) => Option.Option<Uint8Array<ArrayBuffer>>;
  /** Every archived key, in key order. */
  readonly keys: () => ReadonlyArray<string>;
  /** Clears the object map. */
  readonly reset: () => void;
}

/**
 * An opaque per-content identity standing in for R2's etag. Not R2's MD5 —
 * WebCrypto has no MD5 and no spec depends on the digest algorithm, only on
 * two puts of the same bytes agreeing and two different bodies disagreeing.
 */
const contentEtag = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Arr.map(Arr.fromIterable(digest.subarray(0, 16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const r2Object = (key: string, entry: StubR2Entry): StubR2Object => ({
  key,
  version: entry.etag,
  size: entry.bytes.byteLength,
  etag: entry.etag,
  httpEtag: `"${entry.etag}"`,
  uploaded: entry.uploaded,
  httpMetadata: entry.httpMetadata,
  customMetadata: entry.customMetadata,
  checksums: {},
  storageClass: "Standard",
  writeHttpMetadata: (headers) => {
    for (const [name, value] of Record.toEntries(entry.httpMetadata)) headers.set(name, value);
  },
});

const r2ObjectBody = (key: string, entry: StubR2Entry): StubR2ObjectBody => {
  const bytes = entry.bytes;
  return {
    ...r2Object(key, entry),
    body: new Blob([bytes]).stream(),
    bodyUsed: false,
    arrayBuffer: async () => bytes.slice().buffer,
    bytes: async () => bytes.slice(),
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    blob: async () => new Blob([bytes]),
  };
};

/**
 * Builds an in-memory R2 bucket stub. A message the crawl archives is
 * readable back within the same test — which is what lets a spec drive
 * archive → enqueue → consume against real bytes rather than a `put` that
 * succeeds into the void.
 *
 * @example
 * ```ts
 * import { makeStubR2 } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const r2 = makeStubR2()
 * await r2.bucket.put("feed/1/message.xml", "<MediaFeed/>")
 * const object = await r2.bucket.get("feed/1/message.xml")
 * object === null ? null : await object.text() // "<MediaFeed/>"
 * r2.keys() // ["feed/1/message.xml"]
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeStubR2 = (): StubR2 => {
  const objects = new Map<string, StubR2Entry>();
  const keys = (): ReadonlyArray<string> =>
    Arr.sort(Arr.fromIterable(objects.keys()), Order.String);
  const bucket: StubR2Bucket = {
    put: async (key, value, options) => {
      const bytes = await toBytes(value);
      const httpMetadata =
        options?.httpMetadata instanceof Headers
          ? Record.fromEntries(Arr.fromIterable(options.httpMetadata.entries()))
          : { ...options?.httpMetadata };
      const entry: StubR2Entry = {
        bytes,
        etag: await contentEtag(bytes),
        // oxlint-disable-next-line effect/use-clock-service -- stub metadata for the platform's `uploaded` field; nothing under test reads it as a clock.
        uploaded: new Date(),
        httpMetadata,
        customMetadata: { ...options?.customMetadata },
      };
      objects.set(key, entry);
      return r2Object(key, entry);
    },
    get: async (key) => {
      const entry = objects.get(key);
      return entry === undefined ? null : r2ObjectBody(key, entry);
    },
    head: async (key) => {
      const entry = objects.get(key);
      return entry === undefined ? null : r2Object(key, entry);
    },
    delete: async (toDelete) => {
      for (const key of Predicate.isString(toDelete) ? [toDelete] : toDelete) objects.delete(key);
    },
    list: async (options) => {
      const limit = options?.limit ?? 1000;
      const all = Arr.filter(keys(), (key) =>
        options?.prefix === undefined ? true : key.startsWith(options.prefix),
      );
      const start = options?.cursor === undefined ? 0 : Math.max(0, all.indexOf(options.cursor));
      const page = all.slice(start, start + limit);
      const listed = Arr.filterMap(page, (key) => {
        const entry = objects.get(key);
        return entry === undefined ? Result.failVoid : Result.succeed(r2Object(key, entry));
      });
      const next = all[start + limit];
      return next === undefined
        ? { objects: listed, delimitedPrefixes: [], truncated: false }
        : { objects: listed, delimitedPrefixes: [], truncated: true, cursor: next };
    },
    createMultipartUpload: async () => {
      throw new Error("R2 multipart upload is not modelled by the stub bucket");
    },
    resumeMultipartUpload: () => {
      throw new Error("R2 multipart upload is not modelled by the stub bucket");
    },
  };
  return {
    bucket,
    peek: (key) =>
      Option.map(Option.fromNullishOr(objects.get(key)), (entry) => entry.bytes.slice()),
    keys,
    reset: () => {
      objects.clear();
    },
  };
};

// ── Queue ────────────────────────────────────────────────────────────

/**
 * One message a queue producer stub accepted, in send order.
 *
 * @since 0.1.0
 * @category models
 */
export interface SentQueueMessage {
  readonly body: unknown;
  readonly contentType: Option.Option<string>;
  readonly delaySeconds: Option.Option<number>;
}

/**
 * The `Queue` producer stub surface: `send` and `sendBatch`, both recording.
 * `send` never fails, matching the deployed producer's happy path; a test
 * that needs the `SendError` path constructs it at the client, not here.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubQueueProducer {
  send(
    body: unknown,
    options?: {
      readonly contentType?: string | undefined;
      readonly delaySeconds?: number | undefined;
    },
  ): Promise<void>;
  sendBatch(
    messages: ReadonlyArray<{ readonly body: unknown; readonly contentType?: string | undefined }>,
    options?: { readonly delaySeconds?: number | undefined },
  ): Promise<void>;
}

/**
 * A stub queue producer with its inspection handles.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubQueue {
  /** The binding object to put behind `env[LogicalId]`. */
  readonly queue: StubQueueProducer;
  /**
   * Every message sent since the last reset, in the order the producer sent
   * them — one entry per message, whether through `send` or inside a
   * `sendBatch` (a caller that batches N and one that sends N make the same
   * claim about what reached the queue). A copy.
   */
  readonly sent: () => ReadonlyArray<SentQueueMessage>;
  /** The bodies alone — gardeneria's `peekStubQueue` shape. */
  readonly bodies: () => ReadonlyArray<unknown>;
  /** Empties the log. */
  readonly reset: () => void;
}

/**
 * Builds a recording queue producer stub. The consumer side is never
 * modelled: a spec that wants a message consumed calls the consumer's
 * handler with it directly.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { makeStubQueue } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const queue = makeStubQueue()
 * await queue.queue.send({ id: 1 })
 * await queue.queue.sendBatch([{ body: { id: 2 } }], { delaySeconds: 5 })
 * queue.bodies() // [{ id: 1 }, { id: 2 }]
 * queue.sent()[1]?.delaySeconds // Option.some(5)
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeStubQueue = (): StubQueue => {
  const log: Array<SentQueueMessage> = [];
  const record = (
    body: unknown,
    options?: {
      readonly contentType?: string | undefined;
      readonly delaySeconds?: number | undefined;
    },
  ): void => {
    log.push({
      body,
      contentType: Option.fromNullishOr(options?.contentType),
      delaySeconds: Option.fromNullishOr(options?.delaySeconds),
    });
  };
  return {
    queue: {
      send: async (body, options) => {
        record(body, options);
      },
      sendBatch: async (messages, options) => {
        for (const message of messages) {
          record(message.body, {
            contentType: message.contentType,
            delaySeconds: options?.delaySeconds,
          });
        }
      },
    },
    sent: () => log.slice(),
    bodies: () => Arr.map(log, (message) => message.body),
    reset: () => {
      log.length = 0;
    },
  };
};

// ── The stub Worker env and its binding catalogue ────────────────────

/**
 * A throwing stub for a binding no local test may reach (a Durable Object
 * namespace, a service binding to another Worker): every property is a
 * function that throws, so a test that reaches it fails loudly instead of
 * silently exercising a fake. Resolved lazily, so an unused entry costs
 * nothing.
 *
 * @example
 * ```ts
 * import { throwingBinding } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const crawler = throwingBinding("ORIGIN_CRAWLER") as { idFromName: (name: string) => unknown }
 * let message = ""
 * try { crawler.idFromName("x") } catch (error) { message = String(error) }
 * message // "Error: ORIGIN_CRAWLER not available in the test harness"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const throwingBinding = (name: string) =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${name} not available in the test harness`);
      },
    },
  );

/**
 * `Cloudflare.Hyperdrive.Connect` stub for a harness whose `Database` is not
 * Hyperdrive-backed: it panics on use, so a test that somehow reaches it
 * fails loudly instead of silently exercising a fake.
 *
 * @since 0.1.0
 * @category layers
 */
export const stubHyperdriveConnectLayer: Layer.Layer<Cloudflare.Hyperdrive.Connect> = Layer.succeed(
  Cloudflare.Hyperdrive.Connect,
  () => Effect.die("Cloudflare.Hyperdrive.Connect used in the test harness"),
);

/**
 * The provider-emitted values every deployed `env` carries, with the stub
 * values a harness reports.
 *
 * @since 0.1.0
 * @category constants
 */
export const STUB_ALCHEMY_ENV = {
  ALCHEMY_STAGE: "test",
  ALCHEMY_PHASE: "runtime",
} as const;

/**
 * Builds a Worker `env` whose binding objects are stubs, keyed by each
 * resource's `LogicalId` — the key the binding clients read — plus the
 * provider-emitted `ALCHEMY_*` values and any string entries. Typed as the
 * caller's env shape: the harness never exercises the full surface, and the
 * bindings resolve `env[LogicalId]` lazily, so unused entries cost nothing.
 *
 * @example
 * ```ts
 * import { makeStubEnv, makeStubKv } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * interface Env { readonly Cache: unknown; readonly PUBLIC_SITE_URL: string; readonly ALCHEMY_STAGE: string }
 * const env = makeStubEnv<Env>({ Cache: makeStubKv().namespace, PUBLIC_SITE_URL: "https://stage.example" }, "app")
 * env.ALCHEMY_STAGE // "test"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeStubEnv = <Env = Readonly<Record<string, unknown>>>(
  bindings: Readonly<Record<string, unknown>>,
  stackName: string,
): Env =>
  // SAFETY: the harness env is the caller's declared shape by construction;
  // the cast is the one every application's `STUB_ENV` carries.
  ({ ...STUB_ALCHEMY_ENV, ALCHEMY_STACK_NAME: stackName, ...bindings }) as Env;

/**
 * The services a stub binding catalogue provides.
 *
 * @since 0.1.0
 * @category models
 */
export type StubBindingServices =
  | Cloudflare.WorkerEnvironment
  | Cloudflare.KV.ReadWriteNamespace
  | Cloudflare.R2.ReadWriteBucket
  | Cloudflare.Queues.WriteQueue
  | Cloudflare.Hyperdrive.Connect
  | RuntimeContext
  | AlchemyExecutionContext
  | Stack
  | Self<Cloudflare.Worker>;

/**
 * One harness's set of stubs and the reset that clears them all —
 * preferenceflow's module-scope stores as a value. Queues are per binding
 * name (gardeneria's `peekStubQueue`): `queue("EMBED_QUEUE")` returns the
 * same recording producer on every call.
 *
 * @since 0.1.0
 * @category models
 */
export interface StubBindings {
  readonly kv: StubKv;
  readonly r2: StubR2;
  /** The recording producer for `binding`, created on first use. */
  readonly queue: (binding: string) => StubQueue;
  /** The bodies sent to one queue binding since the last reset — gardeneria's `peekStubQueue`. */
  readonly peekStubQueue: (binding: string) => ReadonlyArray<unknown>;
  /** Clears the KV store, the R2 object map and every queue's log. */
  readonly reset: () => void;
}

/**
 * Builds one harness's stubs.
 *
 * @example
 * ```ts
 * import { makeStubBindings } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const stubs = makeStubBindings()
 * await stubs.queue("EMBED_QUEUE").queue.send({ id: "n1" })
 * stubs.peekStubQueue("EMBED_QUEUE") // [{ id: "n1" }]
 * stubs.reset()
 * stubs.peekStubQueue("EMBED_QUEUE") // []
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeStubBindings = (): StubBindings => {
  const kv = makeStubKv();
  const r2 = makeStubR2();
  const queues = new Map<string, StubQueue>();
  const queue = (binding: string): StubQueue => {
    const existing = queues.get(binding);
    if (existing !== undefined) return existing;
    const created = makeStubQueue();
    queues.set(binding, created);
    return created;
  };
  return {
    kv,
    r2,
    queue,
    peekStubQueue: (binding) => queues.get(binding)?.bodies() ?? [],
    reset: () => {
      kv.reset();
      r2.reset();
      for (const one of queues.values()) one.reset();
    },
  };
};

/**
 * The binding catalogue over a stub env: the KV / R2 / queue clients the
 * deployed Worker runs, resolved from `env` through the runtime scaffold
 * (one source of truth for the wiring), plus the panicking Hyperdrive
 * `Connect`. Pass the application's own `WorkerRuntime` so the `LogicalId`
 * and stack name match its deployed Worker.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import { makeWorkerRuntime } from "@thomasfosterau/effect-web-cloudflare"
 * import { makeStubBindings, makeStubEnv, stubBindingsLayer } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const Cache = Cloudflare.KV.Namespace("Cache")
 * const stubs = makeStubBindings()
 * const env = makeStubEnv({ Cache: stubs.kv.namespace }, "app")
 * const layer = stubBindingsLayer(makeWorkerRuntime({ logicalId: "App" }), env)
 * await Effect.runPromise(
 *   Effect.gen(function* () {
 *     const cache = yield* Cloudflare.KV.ReadWriteNamespace(Cache)
 *     yield* cache.put("doc:1", JSON.stringify({ id: 1 }))
 *   }).pipe(Effect.provide(layer)) as Effect.Effect<void, never, never>,
 * )
 * stubs.kv.peek("doc:1") // Option.some({ id: 1 })
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const stubBindingsLayer = (
  runtime: WorkerRuntime,
  env: Readonly<Record<string, unknown>>,
): Layer.Layer<StubBindingServices> =>
  Layer.mergeAll(
    runtime.workerLayer(env),
    runtime.bindAll(
      env,
      Cloudflare.KV.ReadWriteNamespaceBinding,
      Cloudflare.R2.ReadWriteBucketBinding,
      Cloudflare.Queues.WriteQueueBinding,
    ),
    stubHyperdriveConnectLayer,
  );

/**
 * Resolves a lazy resource declaration (`Cloudflare.KV.Namespace("Cache")`,
 * `Queues.Queue("EMBED_QUEUE")`, …) under a stub `Stack` and reads its
 * `LogicalId` — so an application's env-shape test checks "the key on my
 * `WorkerEnv` is literally the id the binding client reads" against alchemy,
 * not a hand-copied string (preferenceflow's `tests/worker-env.test.ts`).
 * The residual requirements are the deploy-time provider tags the resource
 * Effect carries in its type; nothing here runs a provider.
 *
 * @example
 * ```ts
 * import * as Cloudflare from "alchemy/Cloudflare"
 * import * as Effect from "effect/Effect"
 * import { logicalIdOf } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * await Effect.runPromise(logicalIdOf(Cloudflare.KV.Namespace("Cache"))) // "Cache"
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const logicalIdOf = (
  resource: Effect.Effect<{ readonly LogicalId: string }, unknown, unknown>,
): Effect.Effect<string> =>
  // SAFETY: the stub scaffold satisfies every service a resource declaration
  // reads at resolution (`Stack`); the provider tags left in the type are
  // never used outside a deploy.
  resource.pipe(
    Effect.map((resolved) => resolved.LogicalId),
    Effect.provide(runtimeStubsLayer({ logicalId: "test" })),
    Effect.orDie,
  ) as Effect.Effect<string>;

// ── Retry visibility ─────────────────────────────────────────────────

/**
 * The slice of vitest's `TestCase` {@link RetryVisibilityReporter} reads,
 * stated structurally so the reporter depends on no test runner package.
 *
 * @since 0.1.0
 * @category models
 */
export interface ReportedTestCase {
  readonly fullName: string;
  readonly module: { readonly relativeModuleId: string };
  readonly result: () => { readonly state: string };
  readonly diagnostic: () => { readonly retryCount: number } | undefined;
}

interface RetriedThenPassed {
  readonly name: string;
  readonly retryCount: number;
}

/**
 * Surfaces tests that only pass because of a `--retry` (preferenceflow's
 * `packages/integration-harness/retry-reporter.ts`). The retry is otherwise
 * silent: a test that fails once and passes on the second attempt reports
 * as a clean pass, so a real flake (or product bug) the retry is absorbing
 * can hide indefinitely. This reporter changes no retry behaviour — it only
 * names every retried-then-passed test at the end of the run, via vitest's
 * own reporter hooks (`onTestCaseResult`, `onTestRunEnd`). Under CI
 * (`CI=true` / `CI=1`) each line is a `::warning::` GitHub Actions
 * annotation.
 *
 * Register it in a vitest config: `reporters: ["default", new
 * RetryVisibilityReporter()]`.
 *
 * @example
 * ```ts
 * import { RetryVisibilityReporter } from "@thomasfosterau/effect-web-cloudflare/testing"
 *
 * const reporter = new RetryVisibilityReporter()
 * reporter.onTestCaseResult({
 *   fullName: "suite > flaky",
 *   module: { relativeModuleId: "tests/feed.test.ts" },
 *   result: () => ({ state: "passed" }),
 *   diagnostic: () => ({ retryCount: 1 }),
 * })
 * reporter.retriedThenPassed().map((one) => one.name) // ["tests/feed.test.ts > suite > flaky"]
 * ```
 *
 * @since 0.1.0
 * @category reporters
 */
export class RetryVisibilityReporter {
  /**
   * The cases recorded so far.
   *
   * @since 0.1.0
   */
  readonly #retriedThenPassed: Array<RetriedThenPassed> = [];
  /**
   * Where a line goes.
   *
   * @since 0.1.0
   */
  readonly #warn: (line: string) => void;
  /**
   * Whether to emit GitHub Actions annotations.
   *
   * @since 0.1.0
   */
  readonly #isCI: () => boolean;

  constructor(options?: {
    /** Where a line goes. Defaults to `console.warn`. */
    readonly warn?: ((line: string) => void) | undefined;
    /** Whether to emit GitHub Actions annotations. Defaults to reading `process.env.CI`. */
    readonly isCI?: (() => boolean) | undefined;
  }) {
    // oxlint-disable-next-line effect/use-console-service -- a vitest reporter runs outside any Effect runtime; `console.warn` is where vitest's own reporters write, and the applications' CI greps it.
    this.#warn = options?.warn ?? ((line) => console.warn(line));
    // oxlint-disable-next-line effect/avoid-process-env -- same: no `ConfigProvider` exists inside a reporter, and `CI` is the one variable GitHub Actions sets for the annotation format.
    this.#isCI = options?.isCI ?? (() => process.env.CI === "true" || process.env.CI === "1");
  }

  /**
   * The retried-then-passed cases recorded so far.
   *
   * @since 0.1.0
   */
  retriedThenPassed(): ReadonlyArray<RetriedThenPassed> {
    return this.#retriedThenPassed.slice();
  }

  /**
   * vitest's per-case hook: records a case that passed after at least one retry.
   *
   * @since 0.1.0
   */
  onTestCaseResult(testCase: ReportedTestCase): void {
    const diagnostic = testCase.diagnostic();
    if (
      testCase.result().state === "passed" &&
      diagnostic !== undefined &&
      diagnostic.retryCount > 0
    ) {
      this.#retriedThenPassed.push({
        name: `${testCase.module.relativeModuleId} > ${testCase.fullName}`,
        retryCount: diagnostic.retryCount,
      });
    }
  }

  /**
   * vitest's end-of-run hook: names every recorded case, once.
   *
   * @since 0.1.0
   */
  onTestRunEnd(): void {
    if (this.#retriedThenPassed.length === 0) return;
    const isCI = this.#isCI();
    this.#warn(
      `\n[retry-visibility] ${this.#retriedThenPassed.length} test(s) passed only after a retry (masked by --retry):`,
    );
    for (const { name, retryCount } of this.#retriedThenPassed) {
      const detail = `retried-then-passed: ${name} (retried ${retryCount}x)`;
      this.#warn(isCI ? `::warning::${detail}` : `  ${detail}`);
    }
  }
}
