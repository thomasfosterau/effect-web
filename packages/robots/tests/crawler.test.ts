/**
 * The crawlers' side: `evaluateRobots` over the parsed file (crawler cases
 * stated against the library's `RobotsTxt` shape), and the cached
 * `checkRobots` decision over a stub `HttpClient` and the in-memory cache.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  evaluateRobots,
  fetchRobots,
  isRobotsBody,
  makeRobotsChecker,
  memoryRobotsCache,
  parse,
  ROBOTS_CACHE_TTL_SECONDS,
  ROBOTS_NO_RESTRICTIONS,
  ROBOTS_UNAVAILABLE_REASON,
  ROBOTS_UNAVAILABLE_SENTINEL,
  ROBOTS_UNAVAILABLE_TTL_SECONDS,
  type RobotsCache,
} from "@thomasfosterau/effect-robots";

const UA = "thomasfoster-archiver";
const evaluate = (body: string, path: string) => evaluateRobots(parse(body), UA, path);

describe("parse — the crawlers' cases", () => {
  it("parses groups with multiple user agents", () => {
    const parsed = parse(
      [
        "User-agent: a",
        "User-agent: b",
        "Disallow: /private",
        "",
        "User-agent: c",
        "Allow: /",
      ].join("\n"),
    );
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0]?.userAgents).toEqual(["a", "b"]);
    expect(parsed.groups[0]?.rules).toHaveLength(1);
    expect(parsed.groups[1]?.userAgents).toEqual(["c"]);
  });

  it("ignores comments and blank lines", () => {
    const parsed = parse(
      ["# top comment", "", "User-agent: * # inline comment", "Disallow: /a # trailing"].join("\n"),
    );
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.rules[0]?.path).toBe("/a");
  });

  it("handles \\r\\n line endings", () => {
    const parsed = parse("User-agent: *\r\nDisallow: /x\r\n");
    expect(parsed.groups[0]?.rules[0]?.path).toBe("/x");
  });

  it("handles bare \\r line endings, failing closed rather than open", () => {
    const parsed = parse("User-agent: *\rDisallow: /\r");
    expect(evaluateRobots(parsed, "examplebot", "/x").allowed).toBe(false);
  });

  it("ignores rules and a Crawl-delay that appear before any user-agent line", () => {
    const parsed = parse("Crawl-delay: 5\nDisallow: /orphan\nUser-agent: *\nDisallow: /x");
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.rules).toHaveLength(1);
    expect(parsed.groups[0]?.crawlDelay).toBeUndefined();
  });

  it("ignores an invalid Crawl-delay, keeping any prior valid value", () => {
    const parsed = parse(
      ["User-agent: *", "Crawl-delay: 7", "Crawl-delay: notanumber", "Crawl-delay: -3"].join("\n"),
    );
    expect(parsed.groups[0]?.crawlDelay).toBe(7);
  });

  it("ignores lines with no colon and unknown directives, and collects Sitemap", () => {
    const parsed = parse(
      ["User-agent: *", "garbage-no-colon", "Sitemap: https://x/s.xml", "Disallow: /a"].join("\n"),
    );
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.rules).toHaveLength(1);
    expect(parsed.sitemaps).toEqual(["https://x/s.xml"]);
  });

  it("starts a fresh group when a User-agent line follows a rule line", () => {
    const parsed = parse(
      ["User-agent: a", "Disallow: /x", "User-agent: b", "Disallow: /y"].join("\n"),
    );
    expect(parsed.groups.map((group) => group.userAgents)).toEqual([["a"], ["b"]]);
  });
});

describe("evaluateRobots", () => {
  it("allows everything when there are no rules", () => {
    expect(evaluate("", "/any/path").allowed).toBe(true);
  });

  it("applies the wildcard group when no specific group matches", () => {
    const body = "User-agent: *\nDisallow: /private/";
    expect(evaluate(body, "/private/page").allowed).toBe(false);
    expect(evaluate(body, "/public/page").allowed).toBe(true);
  });

  it("prefers a specific user-agent group over the wildcard group", () => {
    const body = ["User-agent: *", "Disallow: /", "", `User-agent: ${UA}`, "Allow: /"].join("\n");
    expect(evaluate(body, "/anything").allowed).toBe(true);
  });

  it("matches user-agent tokens case-insensitively", () => {
    const body = "User-agent: ThomasFoster-Archiver\nDisallow: /denied";
    expect(evaluate(body, "/denied").allowed).toBe(false);
  });

  it("treats empty Disallow as allow-all", () => {
    expect(evaluate("User-agent: *\nDisallow:", "/anything").allowed).toBe(true);
  });

  it("applies longest-match precedence with Allow winning ties", () => {
    const body = ["User-agent: *", "Disallow: /folder/", "Allow: /folder/public/"].join("\n");
    expect(evaluate(body, "/folder/secret").allowed).toBe(false);
    expect(evaluate(body, "/folder/public/page").allowed).toBe(true);
  });

  it("supports * wildcards and the $ end anchor", () => {
    expect(evaluate("User-agent: *\nDisallow: /*.pdf", "/files/report.pdf").allowed).toBe(false);
    expect(evaluate("User-agent: *\nDisallow: /*.pdf", "/files/report.html").allowed).toBe(true);
    expect(evaluate("User-agent: *\nDisallow: /exact$", "/exact").allowed).toBe(false);
    expect(evaluate("User-agent: *\nDisallow: /exact$", "/exact/sub").allowed).toBe(true);
  });

  it("matches the query string and escapes regex metacharacters in patterns", () => {
    const body = "User-agent: *\nDisallow: /search?q=(secret)";
    expect(evaluate(body, "/search?q=(secret)").allowed).toBe(false);
    expect(evaluate(body, "/searchXq=Xsecret)").allowed).toBe(true);
  });

  it("escapes a literal mid-string $ rather than treating it as the end anchor", () => {
    const body = "User-agent: *\nDisallow: /foo$bar";
    expect(evaluate(body, "/foo$bar").allowed).toBe(false);
    expect(evaluate(body, "/foo$barbaz").allowed).toBe(false);
    expect(evaluate(body, "/foo").allowed).toBe(true);
  });

  it("strips a fragment from the path before matching (a `#` in a rule is a comment)", () => {
    expect(evaluate("User-agent: *\nDisallow: /a#b", "/ab").allowed).toBe(false);
    expect(evaluate("User-agent: *\nDisallow: /a", "/a#section").allowed).toBe(false);
    expect(evaluate("User-agent: *\nDisallow: /a$", "/a#section").allowed).toBe(false);
  });

  it("reports the crawl delay from the selected group, capped, and the matched pattern", () => {
    const body = `User-agent: ${UA}\nCrawl-delay: 5\nDisallow: /private`;
    const result = evaluate(body, "/private/x");
    expect(result.crawlDelaySeconds).toEqual(Option.some(5));
    expect(result.matchedPattern).toEqual(Option.some("/private"));
    expect(
      evaluate("User-agent: *\nCrawl-delay: 3600\nDisallow: /x", "/y").crawlDelaySeconds,
    ).toEqual(Option.some(30));
    expect(
      evaluateRobots(parse("User-agent: *\nCrawl-delay: 3600\nDisallow: /x"), UA, "/y", {
        maxCrawlDelaySeconds: 60,
      }).crawlDelaySeconds,
    ).toEqual(Option.some(60));
    expect(evaluate("User-agent: *\nCrawl-delay: 0\nDisallow: /x", "/y").crawlDelaySeconds).toEqual(
      Option.none(),
    );
  });

  it("allows everything when no group's agent token matches and there is no wildcard group", () => {
    const result = evaluate("User-agent: googlebot\nDisallow: /", "/anything");
    expect(result.allowed).toBe(true);
    expect(result.matchedPattern).toEqual(Option.none());
    expect(result.crawlDelaySeconds).toEqual(Option.none());
  });

  it("picks the most specific agent token when several match as a prefix", () => {
    const body = [
      "User-agent: thomasfoster",
      "Disallow: /",
      "",
      `User-agent: ${UA}`,
      "Allow: /",
    ].join("\n");
    expect(evaluate(body, "/anything").allowed).toBe(true);
  });

  it("keeps Allow on an equal-length tie whichever side it appears on", () => {
    expect(evaluate("User-agent: *\nAllow: /page\nDisallow: /page", "/page").allowed).toBe(true);
    expect(evaluate("User-agent: *\nDisallow: /page\nAllow: /page", "/page").allowed).toBe(true);
  });

  it("ignores an empty Allow pattern as a non-match", () => {
    expect(evaluate("User-agent: *\nAllow:\nDisallow: /x", "/x").allowed).toBe(false);
  });
});

// ── The checker over a stub site ────────────────────────────────────────

type Answer = Response | "transport-error";

/** A stub `HttpClient` answering from a pathname table, recording every request. */
const siteFrom = (routes: Record<string, () => Answer>) => {
  const requests: Array<string> = [];
  const client = HttpClient.make((request, url) => {
    requests.push(url.href);
    const answer = routes[url.pathname]?.() ?? new Response("not found", { status: 404 });
    return answer === "transport-error"
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: "connection refused",
            }),
          }),
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, answer));
  });
  return { client, requests };
};
const text =
  (body: string, status = 200) =>
  () =>
    new Response(body, { status, headers: { "content-type": "text/plain" } });

const checker = (cache: RobotsCache) =>
  makeRobotsChecker({
    userAgent: "thomasfoster-archiver/1.0 (+https://thomasfoster.au)",
    userAgentToken: UA,
    cache,
  });

describe("fetchRobots", () => {
  it("folds 2xx / 4xx / 5xx / transport failure into the cache values", async () => {
    const cases = [
      [text("User-agent: *\nDisallow: /x"), "User-agent: *\nDisallow: /x"],
      [text("gone", 404), ROBOTS_NO_RESTRICTIONS],
      [text("boom", 503), ROBOTS_UNAVAILABLE_SENTINEL],
      [() => "transport-error" as const, ROBOTS_UNAVAILABLE_SENTINEL],
    ] as const;
    await Effect.runPromise(
      Effect.forEach(
        cases,
        ([answer, expected]) => {
          const site = siteFrom({ "/robots.txt": answer });
          return fetchRobots("https://feed.test", { userAgent: "bot/1.0" }).pipe(
            Effect.provideService(HttpClient.HttpClient, site.client),
            Effect.tap((got) =>
              Effect.sync(() => {
                expect(got).toBe(expected);
                expect(site.requests).toEqual(["https://feed.test/robots.txt"]);
              }),
            ),
          );
        },
        { concurrency: 1, discard: true },
      ),
    );
  });

  it("caps the body at maxBytes and sends the User-Agent", async () => {
    let userAgent = "";
    const client = HttpClient.make((request) => {
      userAgent = request.headers["user-agent"] ?? "";
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("x".repeat(100))));
    });
    const got = await Effect.runPromise(
      fetchRobots("https://feed.test", { userAgent: "bot/1.0", maxBytes: 10 }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      ),
    );
    expect(got).toBe("x".repeat(10));
    expect(userAgent).toBe("bot/1.0");
  });

  it("isRobotsBody distinguishes a body from the sentinels", () => {
    expect(isRobotsBody("User-agent: *")).toBe(true);
    expect(isRobotsBody(ROBOTS_NO_RESTRICTIONS)).toBe(false);
    expect(isRobotsBody(ROBOTS_UNAVAILABLE_SENTINEL)).toBe(false);
  });
});

describe("makeRobotsChecker", () => {
  it("serves the decision from the cache without touching the origin", async () => {
    const cache = memoryRobotsCache();
    await Effect.runPromise(
      cache.put("https://feed.test", `User-agent: ${UA}\nDisallow: /27966/`, 1),
    );
    const site = siteFrom({});
    const decision = await Effect.runPromise(
      checker(cache)("https://feed.test/27966/Standard/").pipe(
        Effect.provideService(HttpClient.HttpClient, site.client),
      ),
    );
    expect(decision).toEqual({ allowed: false, reason: "disallowed by robots.txt rule '/27966/'" });
    expect(site.requests).toEqual([]);
  });

  it("treats a 404 as no restrictions and caches that for a day", async () => {
    const cache = memoryRobotsCache();
    const site = siteFrom({});
    const decision = await Effect.runPromise(
      checker(cache)("https://feed.test/27966/").pipe(
        Effect.provideService(HttpClient.HttpClient, site.client),
      ),
    );
    expect(decision).toEqual({ allowed: true, crawlDelaySeconds: Option.none() });
    expect(site.requests).toEqual(["https://feed.test/robots.txt"]);
    expect(cache.entries.get("https://feed.test")).toEqual({
      value: ROBOTS_NO_RESTRICTIONS,
      ttlSeconds: ROBOTS_CACHE_TTL_SECONDS,
    });
  });

  it("treats a 5xx or a transport failure as disallow-all and caches that for an hour", async () => {
    await Effect.runPromise(
      Effect.forEach(
        [text("boom", 503), () => "transport-error" as const],
        (answer) => {
          const cache = memoryRobotsCache();
          const site = siteFrom({ "/robots.txt": answer });
          return checker(cache)("https://feed.test/27966/").pipe(
            Effect.provideService(HttpClient.HttpClient, site.client),
            Effect.tap((decision) =>
              Effect.sync(() => {
                expect(decision).toEqual({ allowed: false, reason: ROBOTS_UNAVAILABLE_REASON });
                expect(cache.entries.get("https://feed.test")?.ttlSeconds).toBe(
                  ROBOTS_UNAVAILABLE_TTL_SECONDS,
                );
              }),
            ),
          );
        },
        { concurrency: 1, discard: true },
      ),
    );
  });

  it("evaluates a fetched body for the path and reports the crawl delay, then serves the cache", async () => {
    const cache = memoryRobotsCache();
    const site = siteFrom({
      "/robots.txt": text("User-agent: *\nCrawl-delay: 2\nDisallow: /secret/"),
    });
    const check = checker(cache);
    const allowed = await Effect.runPromise(
      check("https://feed.test/27966/").pipe(
        Effect.provideService(HttpClient.HttpClient, site.client),
      ),
    );
    expect(allowed).toEqual({ allowed: true, crawlDelaySeconds: Option.some(2) });
    const denied = await Effect.runPromise(
      check("https://feed.test/secret/x").pipe(
        Effect.provideService(HttpClient.HttpClient, site.client),
      ),
    );
    expect(denied.allowed).toBe(false);
    expect(site.requests).toEqual(["https://feed.test/robots.txt"]);
  });

  it("matches the query string by default and the pathname alone with matchQuery: false", async () => {
    const body = text("User-agent: *\nDisallow: /search?q=");
    const withQuery = makeRobotsChecker({ userAgent: "bot", userAgentToken: UA });
    const pathOnly = makeRobotsChecker({ userAgent: "bot", userAgentToken: UA, matchQuery: false });
    const site = siteFrom({ "/robots.txt": body });
    const a = await Effect.runPromise(
      withQuery("https://feed.test/search?q=x").pipe(
        Effect.provideService(HttpClient.HttpClient, site.client),
      ),
    );
    const b = await Effect.runPromise(
      pathOnly("https://feed.test/search?q=x").pipe(
        Effect.provideService(HttpClient.HttpClient, site.client),
      ),
    );
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(true);
  });

  it("fetches every time with no cache configured", async () => {
    const site = siteFrom({ "/robots.txt": text("User-agent: *\nDisallow: /nope") });
    const check = makeRobotsChecker({ userAgent: "bot", userAgentToken: UA });
    const decisions = await Effect.runPromise(
      Effect.forEach(
        Arr.range(1, 2),
        () =>
          check("https://feed.test/27966/").pipe(
            Effect.provideService(HttpClient.HttpClient, site.client),
          ),
        { concurrency: 1 },
      ),
    );
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true]);
    expect(site.requests).toHaveLength(2);
  });
});
