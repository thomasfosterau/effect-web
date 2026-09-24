/**
 * The Cache-Tag purge-on-mutation helpers — website's
 * `apps/web/tests/unit/cache-purge.test.ts`, with the eligible-type set as
 * a parameter and the log lines read off Effect's logger.
 */

/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import {
  FEED_CACHE_TAG,
  makePurgeTagsForResourceType,
  purgeCacheTags,
  purgeCacheTagsPromise,
  SITEMAP_CACHE_TAG,
} from "@thomasfosterau/effect-web-sitemap";

class TestFailure extends Schema.TaggedError<TestFailure>()("TestFailure", {
  message: Schema.String,
}) {}

const purgeTagsForResourceType = makePurgeTagsForResourceType([
  "posts",
  "notes",
  "people",
  "projects",
]);

/** Runs `effect` capturing every log line's annotations. */
const runLogging = async <A>(effect: Effect.Effect<A>) => {
  const lines: Array<{ readonly message: unknown; readonly annotations: Record<string, unknown> }> =
    [];
  const capture = Logger.make<unknown, void>(({ message, fiber }) => {
    lines.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
  });
  const value = await Effect.runPromise(
    effect.pipe(
      Effect.provide(Logger.layer([capture])),
      Effect.provideService(References.MinimumLogLevel, "All"),
    ),
  );
  return { value, lines };
};

describe("makePurgeTagsForResourceType", () => {
  it("tags a sitemap-eligible type with sitemap + feed", () => {
    for (const type of ["posts", "notes", "people", "projects"]) {
      expect(purgeTagsForResourceType(type)).toEqual([SITEMAP_CACHE_TAG, FEED_CACHE_TAG]);
    }
  });

  it("returns no tags for a resource type outside both surfaces", () => {
    for (const type of ["comments", "session", "", "not-a-real-type"]) {
      expect(purgeTagsForResourceType(type)).toEqual([]);
    }
  });

  it("takes a custom tag list", () => {
    expect(makePurgeTagsForResourceType(["posts"], ["og"])("posts")).toEqual(["og"]);
  });
});

describe("purgeCacheTags", () => {
  it("calls ctx.cache.purge with the given tags", async () => {
    const purge = vi.fn(async () => ({ success: true, errors: [] }));
    await Effect.runPromise(purgeCacheTags({ cache: { purge } }, ["sitemap", "feed"]));
    expect(purge).toHaveBeenCalledWith({ tags: ["sitemap", "feed"] });
  });

  it("is a no-op for an empty tag list — never calls purge", async () => {
    const purge = vi.fn(async () => ({ success: true, errors: [] }));
    await Effect.runPromise(purgeCacheTags({ cache: { purge } }, []));
    expect(purge).not.toHaveBeenCalled();
  });

  it("is a no-op when ctx.cache is absent (local dev, Workers Cache unavailable)", async () => {
    await expect(Effect.runPromise(purgeCacheTags({}, ["sitemap"]))).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(purgeCacheTags(undefined, ["sitemap"])),
    ).resolves.toBeUndefined();
    await expect(purgeCacheTagsPromise(undefined, ["sitemap"])).resolves.toBeUndefined();
  });

  it("logs a purge failure rather than failing (dropped purge, not a dropped request)", async () => {
    const purge = vi.fn(async () => {
      throw new TestFailure({ message: "purge unavailable" });
    });
    const { lines } = await runLogging(purgeCacheTags({ cache: { purge } }, ["sitemap"]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.annotations).toMatchObject({ event: "cache-purge.failed", tags: ["sitemap"] });
    expect(lines[0]?.annotations["cause"]).toBe("TestFailure: purge unavailable");
  });

  it("logs a resolved success: false result rather than dropping it silently", async () => {
    const errors = [{ code: 10000, message: "internal error" }];
    const purge = vi.fn(async () => ({ success: false, errors }));
    const { lines } = await runLogging(purgeCacheTags({ cache: { purge } }, ["sitemap"]));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.annotations).toMatchObject({
      event: "cache-purge.rejected",
      tags: ["sitemap"],
      errors,
    });
  });

  it("does not log when the purge resolves success: true", async () => {
    const purge = vi.fn(async () => ({ success: true, errors: [] }));
    const { lines } = await runLogging(purgeCacheTags({ cache: { purge } }, ["sitemap"]));
    expect(lines).toEqual([]);
  });

  it("the Promise form resolves through the same path", async () => {
    const purge = vi.fn(async () => ({ success: true, errors: [] }));
    await expect(purgeCacheTagsPromise({ cache: { purge } }, ["feed"])).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledWith({ tags: ["feed"] });
  });
});
