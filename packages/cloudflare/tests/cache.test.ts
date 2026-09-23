/**
 * Unit tests for the KV read-through resource cache (PERF-CACHE-004).
 *
 * The crux is `isPubliclyServeable`: KV is populated by mutations, so it can
 * hold a `private` or otherwise admin-only resource — and, since #1319, by
 * Comment's own submission write-through, so a `pending` comment too. The
 * read-through path must never serve such an entry to an anonymous /
 * non-admin viewer. The predicate suite is gardeneria's
 * `apps/api/tests/resource-cache-readthrough.test.ts` verbatim; the
 * read-through cases are the behaviour gardeneria and website pinned in
 * their `tests/integration/resource-cache-readthrough.test.ts` against a
 * real KV binding, here over the `./testing` stub namespace.
 */

/* oxlint-disable effect/effect-run-in-body */

import { beforeEach, describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  isPubliclyServeable,
  makeResourceCache,
  MIN_RESOURCE_CACHE_TTL,
  RESOURCE_CACHE_TTL,
} from "@thomasfosterau/effect-web-cloudflare/cache";
import { makeStubKv } from "@thomasfosterau/effect-web-cloudflare/testing";

describe("isPubliclyServeable — read-through security gate (PERF-CACHE-004)", () => {
  it("serves a public Content resource", () => {
    expect(isPubliclyServeable({ attributes: { visibility: "public" } })).toBe(true);
  });

  it("REFUSES a private Content resource (never leak admin-written private)", () => {
    expect(isPubliclyServeable({ attributes: { visibility: "private" } })).toBe(false);
  });

  it("refuses any non-'public' visibility value defensively", () => {
    expect(isPubliclyServeable({ attributes: { visibility: "draft" } })).toBe(false);
    expect(isPubliclyServeable({ attributes: { visibility: "" } })).toBe(false);
    expect(isPubliclyServeable({ attributes: { visibility: null } })).toBe(false);
  });

  it("serves an entity-family resource (no visibility axis)", () => {
    expect(isPubliclyServeable({ attributes: { name: "Ada" } })).toBe(true);
  });

  it("refuses malformed / non-object cached values", () => {
    expect(isPubliclyServeable(null)).toBe(false);
    expect(isPubliclyServeable(undefined)).toBe(false);
    expect(isPubliclyServeable("a string")).toBe(false);
    expect(isPubliclyServeable(42)).toBe(false);
    expect(isPubliclyServeable({})).toBe(false);
    expect(isPubliclyServeable({ attributes: null })).toBe(false);
    expect(isPubliclyServeable({ attributes: "not-an-object" })).toBe(false);
  });
});

describe("isPubliclyServeable — the moderationState axis (#1319, CACHE-AUTH-005)", () => {
  it("REFUSES a pending comment — the leak this axis exists to close", () => {
    expect(isPubliclyServeable({ attributes: { moderationState: "pending" } })).toBe(false);
  });

  it("REFUSES a rejected comment", () => {
    expect(isPubliclyServeable({ attributes: { moderationState: "rejected" } })).toBe(false);
  });

  it("serves an approved comment", () => {
    expect(isPubliclyServeable({ attributes: { moderationState: "approved" } })).toBe(true);
  });

  it("refuses any non-'approved' moderationState defensively", () => {
    expect(isPubliclyServeable({ attributes: { moderationState: "escalated" } })).toBe(false);
    expect(isPubliclyServeable({ attributes: { moderationState: "" } })).toBe(false);
    expect(isPubliclyServeable({ attributes: { moderationState: null } })).toBe(false);
    expect(isPubliclyServeable({ attributes: { moderationState: "APPROVED" } })).toBe(false);
  });

  it("axes compose as AND — a public visibility cannot rescue a pending comment", () => {
    expect(
      isPubliclyServeable({ attributes: { visibility: "public", moderationState: "pending" } }),
    ).toBe(false);
    expect(
      isPubliclyServeable({ attributes: { visibility: "private", moderationState: "approved" } }),
    ).toBe(false);
    expect(
      isPubliclyServeable({ attributes: { visibility: "public", moderationState: "approved" } }),
    ).toBe(true);
  });

  it("leaves resources with no moderationState axis alone", () => {
    expect(isPubliclyServeable({ attributes: { visibility: "public", title: "A post" } })).toBe(
      true,
    );
  });
});

describe("isPubliclyServeable — the draft axis (S6)", () => {
  it("REFUSES a draft, even a public one", () => {
    expect(isPubliclyServeable({ attributes: { draft: true } })).toBe(false);
    expect(isPubliclyServeable({ attributes: { visibility: "public", draft: true } })).toBe(false);
  });

  it("serves a published (draft: false) or unlabelled resource", () => {
    expect(isPubliclyServeable({ attributes: { draft: false } })).toBe(true);
  });
});

describe("isPubliclyServeable — the tombstone axis (#1319, CACHE-AUTH-005)", () => {
  it("REFUSES a resource carrying deletedAt, whatever else passes", () => {
    expect(isPubliclyServeable({ attributes: { deletedAt: "2026-08-02T00:00:00.000Z" } })).toBe(
      false,
    );
    expect(
      isPubliclyServeable({
        attributes: {
          visibility: "public",
          moderationState: "approved",
          deletedAt: "2026-08-02T00:00:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("serves a live resource, which omits deletedAt entirely", () => {
    expect(isPubliclyServeable({ attributes: { visibility: "public" } })).toBe(true);
  });

  it("REFUSES an explicit `deletedAt: null` rather than reading it as absent", () => {
    expect(isPubliclyServeable({ attributes: { deletedAt: null } })).toBe(false);
    expect(
      isPubliclyServeable({
        attributes: { visibility: "public", moderationState: "approved", deletedAt: null },
      }),
    ).toBe(false);
  });
});

describe("isPubliclyServeable — the owned-family posture (#1096)", () => {
  const owned = { owned: true } as const;

  it("serves a public owned row", () => {
    expect(isPubliclyServeable({ attributes: { visibility: "public" } }, owned)).toBe(true);
  });

  for (const visibility of ["private", "followers"] as const) {
    it(`REFUSES a ${visibility} owned row`, () => {
      expect(isPubliclyServeable({ attributes: { visibility } }, owned)).toBe(false);
    });
  }

  it("REFUSES an owned row whose visibility attribute is ABSENT", () => {
    expect(isPubliclyServeable({ attributes: { name: "Ada" } }, owned)).toBe(false);
  });

  it("REFUSES an owned row whose visibility is explicitly undefined", () => {
    expect(isPubliclyServeable({ attributes: { visibility: undefined } }, owned)).toBe(false);
  });

  it("leaves reference data unchanged when the flag is absent", () => {
    expect(isPubliclyServeable({ attributes: { name: "Ada" } })).toBe(true);
    expect(isPubliclyServeable({ attributes: { name: "Ada" } }, { owned: false })).toBe(true);
  });

  it("composes as AND with the other axes", () => {
    expect(
      isPubliclyServeable({ attributes: { visibility: "public", deletedAt: "2026-01-01" } }, owned),
    ).toBe(false);
    expect(
      isPubliclyServeable(
        { attributes: { visibility: "public", moderationState: "pending" } },
        owned,
      ),
    ).toBe(false);
  });
});

describe("isPubliclyServeable — the publication axis (#1096)", () => {
  const gated = { publishGated: true } as const;
  const hourMs = 60 * 60 * 1000;
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

  it("serves a page whose stamp has arrived", () => {
    expect(isPubliclyServeable({ attributes: { publishedAt: iso(-hourMs) } }, gated)).toBe(true);
  });

  it("REFUSES an unpublished page — no stamp at all", () => {
    expect(isPubliclyServeable({ attributes: { title: "Draft" } }, gated)).toBe(false);
  });

  it("REFUSES a page scheduled for the future", () => {
    expect(isPubliclyServeable({ attributes: { publishedAt: iso(hourMs) } }, gated)).toBe(false);
  });

  it("REFUSES an explicit null stamp rather than reading it as absent", () => {
    expect(isPubliclyServeable({ attributes: { publishedAt: null } }, gated)).toBe(false);
  });

  it("REFUSES an unparseable stamp rather than guessing", () => {
    expect(isPubliclyServeable({ attributes: { publishedAt: "not a date" } }, gated)).toBe(false);
    expect(isPubliclyServeable({ attributes: { publishedAt: 12345 } }, gated)).toBe(false);
  });

  it("accepts a Date instance as well as its JSON string form", () => {
    expect(
      isPubliclyServeable({ attributes: { publishedAt: new Date(Date.now() - hourMs) } }, gated),
    ).toBe(true);
    expect(
      isPubliclyServeable({ attributes: { publishedAt: new Date(Date.now() + hourMs) } }, gated),
    ).toBe(false);
  });

  it("leaves families without the flag unchanged", () => {
    expect(isPubliclyServeable({ attributes: { publishedAt: iso(hourMs) } })).toBe(true);
    expect(isPubliclyServeable({ attributes: { title: "Draft" } })).toBe(true);
  });
});

// ── The read-through, over the stub namespace ──────────────────────────

const Post = Schema.Struct({
  id: Schema.String,
  attributes: Schema.Struct({ visibility: Schema.String, title: Schema.String }),
});
type Post = typeof Post.Type;

const publicPost: Post = { id: "p1", attributes: { visibility: "public", title: "Hello" } };
const privatePost: Post = { id: "p2", attributes: { visibility: "private", title: "Secret" } };

const kv = makeStubKv();
beforeEach(() => kv.reset());

const createCache = makeResourceCache({ resolveKv: Effect.succeed(Option.some(kv.namespace)) });
const posts = createCache(Post, "posts", { owned: true });

/** A DB read that counts how often it ran. */
const dbReads = { count: 0 };
const dbGet = (post: Post) =>
  Effect.sync(() => {
    dbReads.count += 1;
    return post;
  });
beforeEach(() => {
  dbReads.count = 0;
});

describe("makeResourceCache — the handle", () => {
  it("keys by type:id and clamps the TTL to Cloudflare KV's floor", () => {
    expect(posts.key("p1")).toBe("posts:p1");
    expect(posts.ttlSeconds).toBe(RESOURCE_CACHE_TTL);
    expect(createCache(Post, "comments", { ttlSeconds: 5 }).ttlSeconds).toBe(
      MIN_RESOURCE_CACHE_TTL,
    );
    expect(createCache(Post, "pages", { ttlSeconds: 120 }).ttlSeconds).toBe(120);
  });

  it("takes a default TTL for the whole factory", () => {
    const short = makeResourceCache({
      resolveKv: Effect.succeed(Option.none()),
      defaultTtlSeconds: 90,
    });
    expect(short(Post, "posts").ttlSeconds).toBe(90);
  });

  it("set writes JSON with the TTL backstop, get decodes it, delete removes it", async () => {
    await posts.set(kv.namespace, "p1", publicPost);
    expect(kv.peek("posts:p1")).toEqual(Option.some(publicPost));
    expect(kv.peekTtl("posts:p1")).toEqual(Option.some(RESOURCE_CACHE_TTL));
    expect(await posts.get(kv.namespace, "p1")).toEqual(Option.some(publicPost));
    await posts.delete(kv.namespace, "p1");
    expect(await posts.get(kv.namespace, "p1")).toEqual(Option.none());
  });

  it("get deletes an entry that fails the schema and reads it as a miss", async () => {
    kv.seed("posts:p1", { id: "p1", attributes: { stale: true } });
    expect(await posts.get(kv.namespace, "p1")).toEqual(Option.none());
    expect(kv.peek("posts:p1")).toEqual(Option.none());
  });
});

describe("makeResourceCache — readThrough (PERF-CACHE-004)", () => {
  it("misses, reads the DB, and populates KV with a serveable resource", async () => {
    const got = await Effect.runPromise(posts.readThrough("p1", dbGet(publicPost)));
    expect(got).toEqual(publicPost);
    expect(dbReads.count).toBe(1);
    expect(kv.peek("posts:p1")).toEqual(Option.some(publicPost));
  });

  it("serves a hit without touching the DB", async () => {
    kv.seed("posts:p1", publicPost);
    const got = await Effect.runPromise(posts.readThrough("p1", dbGet(privatePost)));
    // The seeded (KV) copy came back, not the DB's — the read was a hit.
    expect(got).toEqual(publicPost);
    expect(dbReads.count).toBe(0);
  });

  it("REFUSES a private hit and falls through to the DB (CACHE-AUTH-005)", async () => {
    kv.seed("posts:p2", privatePost);
    const got = await Effect.runPromise(posts.readThrough("p2", dbGet(publicPost)));
    expect(got).toEqual(publicPost);
    expect(dbReads.count).toBe(1);
  });

  it("does not populate KV with a non-serveable DB result", async () => {
    await Effect.runPromise(posts.readThrough("p2", dbGet(privatePost)));
    expect(kv.peek("posts:p2")).toEqual(Option.none());
  });

  it("applies the owned posture on the hit: a projection without visibility is refused", async () => {
    kv.seed("posts:p3", { id: "p3", attributes: { visibility: "public", title: "x" } });
    const loose = createCache(
      Schema.Struct({ id: Schema.String, attributes: Schema.Struct({ title: Schema.String }) }),
      "posts",
      { owned: true },
    );
    // The schema drops `visibility` on decode, so the decoded hit lacks the
    // axis — and an owned family refuses that rather than serving it.
    let reads = 0;
    const got = await Effect.runPromise(
      loose.readThrough(
        "p3",
        Effect.sync(() => {
          reads += 1;
          return { id: "p3", attributes: { title: "from db" } };
        }),
      ),
    );
    expect(got.attributes.title).toBe("from db");
    expect(reads).toBe(1);
  });

  it("bypasses the cache entirely for a freshness viewer (#1215)", async () => {
    kv.seed("posts:p1", publicPost);
    const fresh = createCache(Post, "posts", { bypass: Effect.succeed(true) });
    const got = await Effect.runPromise(fresh.readThrough("p1", dbGet(privatePost)));
    expect(got).toEqual(privatePost);
    expect(dbReads.count).toBe(1);
  });

  it("degrades a KV read fault to a DB read", async () => {
    kv.seed("posts:p1", publicPost);
    kv.setGetFault(true);
    const got = await Effect.runPromise(posts.readThrough("p1", dbGet(publicPost)));
    expect(got).toEqual(publicPost);
    expect(dbReads.count).toBe(1);
  });

  it("degrades an unavailable binding to a DB read", async () => {
    const none = makeResourceCache({ resolveKv: Effect.succeed(Option.none()) })(Post, "posts");
    const got = await Effect.runPromise(none.readThrough("p1", dbGet(publicPost)));
    expect(got).toEqual(publicPost);
    expect(dbReads.count).toBe(1);
  });

  it("propagates the DB read's own failure", async () => {
    const exit = await Effect.runPromiseExit(posts.readThrough("p1", Effect.fail("NotFound")));
    expect(exit._tag).toBe("Failure");
  });

  it("takes a custom serveability policy in place of the default", async () => {
    kv.seed("posts:p2", privatePost);
    const lenient = createCache(Post, "posts", { serveable: () => true });
    const got = await Effect.runPromise(lenient.readThrough("p2", dbGet(publicPost)));
    expect(got).toEqual(privatePost);
    expect(dbReads.count).toBe(0);
  });
});

describe("makeResourceCache — the write-through (#1096)", () => {
  it("setOnKv writes a serveable resource", async () => {
    await Effect.runPromise(posts.setOnKv("p1", publicPost));
    expect(kv.peek("posts:p1")).toEqual(Option.some(publicPost));
  });

  it("setOnKv DELETES rather than skips a non-serveable resource (the public → private flip)", async () => {
    kv.seed("posts:p2", publicPost);
    await Effect.runPromise(posts.setOnKv("p2", privatePost));
    expect(kv.peek("posts:p2")).toEqual(Option.none());
  });

  it("deleteOnKv evicts", async () => {
    kv.seed("posts:p1", publicPost);
    await Effect.runPromise(posts.deleteOnKv("p1"));
    expect(kv.peek("posts:p1")).toEqual(Option.none());
  });

  it("both are best-effort: no binding, no error", async () => {
    const none = makeResourceCache({ resolveKv: Effect.succeed(Option.none()) })(Post, "posts");
    await expect(Effect.runPromise(none.setOnKv("p1", publicPost))).resolves.toBeUndefined();
    await expect(Effect.runPromise(none.deleteOnKv("p1"))).resolves.toBeUndefined();
  });

  it("both swallow a KV fault so the mutation result still surfaces", async () => {
    const faulty = makeResourceCache({
      resolveKv: Effect.succeed(
        Option.some({
          get: async () => null,
          put: async () => {
            throw new Error("kv down");
          },
          delete: async () => {
            throw new Error("kv down");
          },
        }),
      ),
    })(Post, "posts");
    await expect(Effect.runPromise(faulty.setOnKv("p1", publicPost))).resolves.toBeUndefined();
    await expect(Effect.runPromise(faulty.deleteOnKv("p1"))).resolves.toBeUndefined();
  });
});
