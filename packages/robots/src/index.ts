/**
 * `@thomasfosterau/effect-web-robots` — the Robots Exclusion Protocol
 * (RFC 9309) for Effect.
 *
 * Three layers, in one entry:
 *
 * 1. **The library**, its API and behaviour held fixed by the verbatim
 *    suite in `tests/library.test.ts`: the `Rule` / `RobotGroup` /
 *    `RobotsTxt` data classes, the `RobotsTxtFromString` schema,
 *    `parse` / `encode`, and the matcher `isAllowed` / `getCrawlDelay` /
 *    `getSitemaps`.
 * 2. **The consumer side** a crawler needs: {@link evaluateRobots} (the
 *    decision with its diagnostics), {@link fetchRobots} (RFC 9309 §2.3.1's
 *    failure posture over an `HttpClient`), {@link RobotsCache} (the
 *    pluggable per-origin cache; a persistent adapter, such as Workers KV,
 *    lives in the consuming application) and
 *    {@link makeRobotsChecker} (the cached `checkRobots` decision).
 * 3. **The serving side**: {@link robotsBody}, the stage-aware `robots.txt`
 *    a site serves.
 *
 * Peer: `effect` only.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";

// ── Types (Effect Data structures) ─────────────────────────────────────

/**
 * A single rule in a robots.txt file: a path pattern and whether it allows.
 *
 * @example
 * ```ts
 * import { Rule } from "@thomasfosterau/effect-web-robots"
 *
 * const rule = new Rule({ path: "/admin", allow: false })
 * rule.path // "/admin"
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export class Rule extends Data.Class<{
  readonly path: string;
  readonly allow: boolean;
}> {}

/**
 * A group of rules for one or more user agents.
 *
 * @example
 * ```ts
 * import { RobotGroup, Rule } from "@thomasfosterau/effect-web-robots"
 *
 * const group = new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/admin", allow: false })] })
 * group.crawlDelay // undefined
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export class RobotGroup extends Data.Class<{
  readonly userAgents: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<Rule>;
  readonly crawlDelay?: number | undefined;
}> {}

/**
 * A parsed robots.txt file: its groups and its `Sitemap:` URLs.
 *
 * @example
 * ```ts
 * import { RobotsTxt } from "@thomasfosterau/effect-web-robots"
 *
 * const robots = new RobotsTxt({ groups: [], sitemaps: ["https://example.com/sitemap.xml"] })
 * robots.sitemaps.length // 1
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export class RobotsTxt extends Data.Class<{
  readonly groups: ReadonlyArray<RobotGroup>;
  readonly sitemaps: ReadonlyArray<string>;
}> {}

// ── Schemas ────────────────────────────────────────────────────────────

/*
 * The `*Schema` names are the library's published API, held fixed by its
 * acceptance suite (the domain names are taken by the `Data.Class`
 * constructors above, and each schema's `Type` IS that class, so a
 * same-named alias would add nothing).
 */
/* oxlint-disable effect/avoid-schema-suffix, effect/require-schema-type-alias */

/**
 * Validates that a value is a {@link Rule} instance (`Schema.instanceOf`).
 *
 * @since 0.1.0
 * @category schemas
 */
export const RuleSchema = Schema.instanceOf(Rule, { identifier: "Rule" });

/**
 * Validates that a value is a {@link RobotGroup} instance (`Schema.instanceOf`).
 *
 * @since 0.1.0
 * @category schemas
 */
export const RobotGroupSchema = Schema.instanceOf(RobotGroup, { identifier: "RobotGroup" });

/**
 * Validates that a value is a {@link RobotsTxt} instance (`Schema.instanceOf`); use {@link RobotsTxtFromString} to parse text.
 *
 * @since 0.1.0
 * @category schemas
 */
export const RobotsTxtSchema = Schema.instanceOf(RobotsTxt, { identifier: "RobotsTxt" });
/* oxlint-enable effect/avoid-schema-suffix, effect/require-schema-type-alias */

/** One `field: value` line, comments and blanks removed. */
interface DirectiveLine {
  readonly field: string;
  readonly value: string;
}

/**
 * Splits a robots.txt line into its directive field and value, dropping
 * comments; `None` for a blank, comment-only or malformed line.
 */
const parseDirectiveLine = (rawLine: string): Option.Option<DirectiveLine> => {
  const commentIndex = rawLine.indexOf("#");
  const line = (commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine).trim();
  if (Str.isEmpty(line)) return Option.none();
  const colon = line.indexOf(":");
  if (colon < 0) return Option.none();
  return Option.some({
    field: line.slice(0, colon).trim().toLowerCase(),
    value: line.slice(colon + 1).trim(),
  });
};

/** The accumulator the parser threads through the lines. */
interface ParserState {
  readonly groups: Array<RobotGroup>;
  readonly sitemaps: Array<string>;
  userAgents: Array<string>;
  rules: Array<Rule>;
  crawlDelay: number | undefined;
  /** Whether a non-`User-agent` directive has been seen for the current group. */
  hasDirectives: boolean;
}

/** Closes the group being accumulated, if it has any directive. */
const finishGroup = (state: ParserState): void => {
  if (Arr.isReadonlyArrayNonEmpty(state.userAgents) && state.hasDirectives) {
    state.groups.push(
      new RobotGroup({
        userAgents: state.userAgents,
        rules: state.rules,
        crawlDelay: state.crawlDelay,
      }),
    );
  }
  if (state.hasDirectives) {
    state.userAgents = [];
    state.rules = [];
    state.crawlDelay = undefined;
    state.hasDirectives = false;
  }
};

/** Applies one directive to the parser state (RFC 9309 group rules). */
const applyDirective = (state: ParserState, { field, value }: DirectiveLine): void => {
  if (Str.isEmpty(value)) return;
  if (field === "user-agent") {
    // A `User-agent` after any directive starts a new group.
    if (state.hasDirectives) finishGroup(state);
    state.userAgents.push(value);
    return;
  }
  if (field === "sitemap") {
    state.sitemaps.push(value);
    return;
  }
  if (field === "disallow" || field === "allow") {
    state.rules.push(new Rule({ path: value, allow: field === "allow" }));
    state.hasDirectives = true;
    return;
  }
  if (field === "crawl-delay") {
    const delay = Number.parseFloat(value);
    if (!Number.isNaN(delay) && delay >= 0) {
      state.crawlDelay = delay;
      state.hasDirectives = true;
    }
  }
};

/**
 * Parses robots.txt content per RFC 9309: consecutive `User-agent:` lines
 * share one group; rules belong to the most recent group; `#` starts a
 * comment; unknown directives are ignored; a group with no directive is
 * dropped.
 */
const parseRobotsTxt = (content: string): RobotsTxt => {
  const state: ParserState = {
    groups: [],
    sitemaps: [],
    userAgents: [],
    rules: [],
    crawlDelay: undefined,
    hasDirectives: false,
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const directive = parseDirectiveLine(rawLine);
    if (Option.isSome(directive)) applyDirective(state, directive.value);
  }
  finishGroup(state);
  return new RobotsTxt({ groups: state.groups, sitemaps: state.sitemaps });
};

/** Encodes a group as its `User-agent` / rule / `Crawl-delay` lines. */
const encodeGroup = (group: RobotGroup): ReadonlyArray<string> => [
  ...Arr.map(group.userAgents, (userAgent) => `User-agent: ${userAgent}`),
  ...Arr.map(group.rules, (rule) => `${rule.allow ? "Allow" : "Disallow"}: ${rule.path}`),
  ...(group.crawlDelay === undefined ? [] : [`Crawl-delay: ${group.crawlDelay}`]),
  "",
];

/** Encodes a `RobotsTxt` as text: each group, a blank line, then the sitemaps. */
const encodeRobotsTxt = (robotsTxt: RobotsTxt): string =>
  [
    ...Arr.flatMap(robotsTxt.groups, encodeGroup),
    ...Arr.map(robotsTxt.sitemaps, (sitemap) => `Sitemap: ${sitemap}`),
  ].join("\n");

/**
 * The schema between robots.txt text and {@link RobotsTxt}: decoding parses
 * (RFC 9309 grouping, comments, unknown directives ignored), encoding
 * serialises.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { RobotsTxtFromString } from "@thomasfosterau/effect-web-robots"
 *
 * const robots = Schema.decodeUnknownSync(RobotsTxtFromString)("User-agent: *\nDisallow: /admin")
 * robots.groups.length // 1
 * Schema.encodeSync(RobotsTxtFromString)(robots) // "User-agent: *\nDisallow: /admin\n"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const RobotsTxtFromString = Schema.String.pipe(
  Schema.decodeTo(
    RobotsTxtSchema,
    SchemaTransformation.transform({ decode: parseRobotsTxt, encode: encodeRobotsTxt }),
  ),
);

/**
 * The decoded side of {@link RobotsTxtFromString}: a {@link RobotsTxt}.
 *
 * @since 0.1.0
 * @category schemas
 */
export type RobotsTxtFromString = typeof RobotsTxtFromString.Type;

/**
 * Parses robots.txt content into a {@link RobotsTxt} (synchronous).
 *
 * @example
 * ```ts
 * import { parse } from "@thomasfosterau/effect-web-robots"
 *
 * const robots = parse("User-agent: *\nDisallow: /admin\nAllow: /admin/public\n\nSitemap: https://example.com/sitemap.xml")
 * robots.groups[0]?.rules.length // 2
 * robots.sitemaps // ["https://example.com/sitemap.xml"]
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = (content: string): RobotsTxt =>
  Schema.decodeUnknownSync(RobotsTxtFromString)(content);

/**
 * Encodes a {@link RobotsTxt} back to robots.txt text (synchronous).
 *
 * @example
 * ```ts
 * import { encode, RobotGroup, RobotsTxt, Rule } from "@thomasfosterau/effect-web-robots"
 *
 * encode(new RobotsTxt({
 *   groups: [new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/admin", allow: false })] })],
 *   sitemaps: ["https://example.com/sitemap.xml"],
 * }))
 * // "User-agent: *\nDisallow: /admin\n\nSitemap: https://example.com/sitemap.xml"
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const encode = (robotsTxt: RobotsTxt): string =>
  Schema.encodeSync(RobotsTxtFromString)(robotsTxt);

// ── Matching ───────────────────────────────────────────────────────────

/** Escapes regex metacharacters (not `*`, expanded separately). */
const escapeRegex = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a rule path matches a URL path: `*` matches any sequence, a
 * trailing `$` anchors the end (RFC 9309 §2.2.3). An empty path and `/`
 * match everything.
 */
const matchesPath = (rulePath: string, urlPath: string): boolean => {
  if (rulePath === "" || rulePath === "/") return true;
  const anchored = rulePath.endsWith("$");
  const pattern = anchored ? rulePath.slice(0, -1) : rulePath;
  const body = pattern.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(urlPath);
};

/**
 * The specificity of a group's claim on a user agent: the length of its
 * longest matching product token (case-insensitive, exact or prefix), `0`
 * for the `*` wildcard, `-1` for no match (RFC 9309 §2.2.1).
 */
const groupSpecificity = (group: RobotGroup, normalizedUserAgent: string): number =>
  Arr.reduce(group.userAgents, -1, (specificity, userAgent) => {
    const pattern = userAgent.toLowerCase();
    if (pattern === "*") return Math.max(specificity, 0);
    if (normalizedUserAgent.startsWith(pattern)) return Math.max(specificity, pattern.length);
    return specificity;
  });

/**
 * The group whose user-agent token most specifically matches — the
 * longest matching token wins, ties keep the first group.
 */
const findMatchingGroup = (robotsTxt: RobotsTxt, userAgent: string): Option.Option<RobotGroup> => {
  const normalized = userAgent.toLowerCase();
  return Arr.reduce(
    robotsTxt.groups,
    { group: Option.none<RobotGroup>(), specificity: -1 },
    (best, group) => {
      const specificity = groupSpecificity(group, normalized);
      return specificity > best.specificity ? { group: Option.some(group), specificity } : best;
    },
  ).group;
};

/** True when `rule` takes precedence over `incumbent` for the same path. */
const outranks = (rule: Rule, incumbent: Option.Option<Rule>): boolean =>
  Option.isNone(incumbent) ||
  rule.path.length > incumbent.value.path.length ||
  (rule.path.length === incumbent.value.path.length && rule.allow && !incumbent.value.allow);

/** The winning rule for `path`: longest match wins, Allow wins ties (RFC 9309 §2.2.2). */
const findMostSpecificRule = (rules: ReadonlyArray<Rule>, path: string): Option.Option<Rule> =>
  Arr.reduce(rules, Option.none<Rule>(), (best, rule) =>
    matchesPath(rule.path, path) && outranks(rule, best) ? Option.some(rule) : best,
  );

/** The path without query or fragment, made absolute. */
const normalizePath = (path: string): string => {
  const bare = path.split("?")[0]?.split("#")[0] ?? "";
  return bare.startsWith("/") ? bare : `/${bare}`;
};

/**
 * Whether `userAgent` may access `urlPath` under the rules: the most
 * specific matching group, then its longest matching rule, Allow winning
 * ties; no matching group or rule means allowed. The query string and
 * fragment are stripped before matching (the library's documented
 * behaviour; {@link evaluateRobots} matches the query too, as RFC 9309
 * §2.2.2 does).
 *
 * @example
 * ```ts
 * import { isAllowed, parse } from "@thomasfosterau/effect-web-robots"
 *
 * const robots = parse("User-agent: *\nDisallow: /admin\nAllow: /admin/public")
 * isAllowed(robots, "MyBot", "/admin") // false
 * isAllowed(robots, "MyBot", "/admin/public") // true
 * isAllowed(robots, "MyBot", "/public") // true
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const isAllowed = (robotsTxt: RobotsTxt, userAgent: string, urlPath: string): boolean => {
  const group = findMatchingGroup(robotsTxt, userAgent);
  if (Option.isNone(group)) return true;
  const rule = findMostSpecificRule(group.value.rules, normalizePath(urlPath));
  return Option.isNone(rule) ? true : rule.value.allow;
};

/**
 * The crawl delay (seconds) for `userAgent`, from its matching group.
 *
 * @example
 * ```ts
 * import { getCrawlDelay, parse } from "@thomasfosterau/effect-web-robots"
 *
 * const robots = parse("User-agent: Googlebot\nCrawl-delay: 5\nDisallow: /x\n\nUser-agent: *\nCrawl-delay: 10\nDisallow: /y")
 * getCrawlDelay(robots, "Googlebot") // 5
 * getCrawlDelay(robots, "OtherBot") // 10
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const getCrawlDelay = (robotsTxt: RobotsTxt, userAgent: string): number | undefined =>
  Option.getOrUndefined(
    Option.map(findMatchingGroup(robotsTxt, userAgent), (group) => group.crawlDelay),
  );

/**
 * Every `Sitemap:` URL in the file.
 *
 * @example
 * ```ts
 * import { getSitemaps, parse } from "@thomasfosterau/effect-web-robots"
 *
 * getSitemaps(parse("Sitemap: https://example.com/sitemap.xml")) // ["https://example.com/sitemap.xml"]
 * ```
 *
 * @since 0.1.0
 * @category matching
 */
export const getSitemaps = (robotsTxt: RobotsTxt): ReadonlyArray<string> => robotsTxt.sitemaps;

// ── Evaluation (the crawlers' decision) ────────────────────────────────

/**
 * Upper bound applied to `Crawl-delay` so a hostile value cannot stall a
 * batch.
 *
 * @since 0.1.0
 * @category constants
 */
export const MAX_CRAWL_DELAY_SECONDS = 30;

/**
 * The result of evaluating robots.txt rules for one URL.
 *
 * @since 0.1.0
 * @category models
 */
export interface RobotsEvaluation {
  readonly allowed: boolean;
  /** The matched rule's path pattern (diagnostics), if any rule matched. */
  readonly matchedPattern: Option.Option<string>;
  /** The selected group's crawl delay, capped; `None` when it declares none. */
  readonly crawlDelaySeconds: Option.Option<number>;
}

/**
 * Options for {@link evaluateRobots}.
 *
 * @since 0.1.0
 * @category models
 */
export interface EvaluateOptions {
  /** The cap on a reported `Crawl-delay`. Defaults to {@link MAX_CRAWL_DELAY_SECONDS}. */
  readonly maxCrawlDelaySeconds?: number | undefined;
}

/**
 * Evaluates a parsed robots.txt for a user-agent token and a path — the
 * crawlers' decision, with its diagnostics. Group selection: the longest
 * matching product token wins, the `*` group is the fallback, none means
 * allowed. Rule precedence: longest matching pattern wins, Allow wins ties.
 * Unlike {@link isAllowed}, the path is matched as given, query included
 * (RFC 9309 §2.2.2), and only a fragment is stripped. The crawl delay is
 * capped and a non-positive one is dropped.
 *
 * @example
 * ```ts
 * import * as Option from "effect/Option"
 * import { evaluateRobots, parse } from "@thomasfosterau/effect-web-robots"
 *
 * const robots = parse("User-agent: *\nCrawl-delay: 3600\nDisallow: /private/\nAllow: /private/public/")
 * evaluateRobots(robots, "mybot", "/private/secret")
 * // { allowed: false, matchedPattern: Option.some("/private/"), crawlDelaySeconds: Option.some(30) }
 * evaluateRobots(robots, "mybot", "/private/public/page").allowed // true
 * ```
 *
 * @since 0.1.0
 * @category evaluation
 */
export const evaluateRobots = (
  robotsTxt: RobotsTxt,
  userAgentToken: string,
  path: string,
  options: EvaluateOptions = {},
): RobotsEvaluation => {
  const group = findMatchingGroup(robotsTxt, userAgentToken);
  if (Option.isNone(group)) {
    return { allowed: true, matchedPattern: Option.none(), crawlDelaySeconds: Option.none() };
  }
  const cap = options.maxCrawlDelaySeconds ?? MAX_CRAWL_DELAY_SECONDS;
  const rule = findMostSpecificRule(group.value.rules, path.split("#")[0] ?? "");
  return {
    allowed: Option.isNone(rule) ? true : rule.value.allow,
    matchedPattern: Option.map(rule, (matched) => matched.path),
    crawlDelaySeconds: Option.filter(
      Option.fromUndefinedOr(group.value.crawlDelay),
      (delay) => delay > 0,
    ).pipe(Option.map((delay) => Math.min(delay, cap))),
  };
};

// ── The fetch, the cache and the checker ───────────────────────────────

/**
 * robots.txt responses are capped at this many bytes (RFC 9309 §2.5).
 *
 * @since 0.1.0
 * @category constants
 */
export const MAX_ROBOTS_BYTES = 500 * 1024;

/**
 * Per-origin cache TTL for a fetched body or a 4xx (24 hours): a directive
 * change is honoured within a day.
 *
 * @since 0.1.0
 * @category constants
 */
export const ROBOTS_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Cache TTL for an unavailable robots.txt (one hour), so a misbehaving
 * origin is not probed on every capture.
 *
 * @since 0.1.0
 * @category constants
 */
export const ROBOTS_UNAVAILABLE_TTL_SECONDS = 60 * 60;

/**
 * The cache value for a robots.txt that could not be read (5xx, transport
 * failure, timeout). The leading character is a deliberate literal NUL
 * byte — it can never collide with a real body. Written as the `\0` escape
 * rather than an embedded raw NUL byte: same runtime string, but a raw NUL
 * in the source makes tools that binary-sniff stop treating the file as
 * text. Changing the value orphans entries already in a persistent cache.
 *
 * @since 0.1.0
 * @category constants
 */
export const ROBOTS_UNAVAILABLE_SENTINEL = "\0__robots_unavailable__";

/**
 * The cache value for an origin with no restrictions (a 4xx, 404 included).
 *
 * @since 0.1.0
 * @category constants
 */
export const ROBOTS_NO_RESTRICTIONS = "";

/**
 * The pluggable per-origin cache the checker reads through. Both methods
 * are infallible by contract: a cache that can fail degrades to a miss / a
 * dropped write inside its adapter. A persistent adapter, such as Workers
 * KV, lives in the consuming application.
 *
 * @since 0.1.0
 * @category models
 */
export interface RobotsCache<R = never> {
  /** The cached value for an origin (`https://host`), or `None`. */
  readonly get: (origin: string) => Effect.Effect<Option.Option<string>, never, R>;
  /** Stores the value with a TTL in seconds. */
  readonly put: (
    origin: string,
    value: string,
    ttlSeconds: number,
  ) => Effect.Effect<void, never, R>;
}

/**
 * A cache that stores nothing: every check fetches. The default cache of
 * {@link makeRobotsChecker}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { noRobotsCache } from "@thomasfosterau/effect-web-robots"
 *
 * await Effect.runPromise(noRobotsCache.put("https://example.com", "User-agent: *", 60))
 * Option.isNone(await Effect.runPromise(noRobotsCache.get("https://example.com"))) // true
 * ```
 *
 * @since 0.1.0
 * @category caches
 */
export const noRobotsCache: RobotsCache = {
  get: () => Effect.succeedNone,
  put: () => Effect.void,
};

/**
 * An in-memory cache (a `Map`), for tests and single-process crawlers. TTLs
 * are recorded, not enforced.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { memoryRobotsCache } from "@thomasfosterau/effect-web-robots"
 *
 * const cache = memoryRobotsCache()
 * await Effect.runPromise(cache.put("https://example.com", "User-agent: *\nDisallow: /", 60))
 * cache.entries.get("https://example.com")?.ttlSeconds // 60
 * ```
 *
 * @since 0.1.0
 * @category caches
 */
export const memoryRobotsCache = (): RobotsCache & {
  readonly entries: Map<string, { readonly value: string; readonly ttlSeconds: number }>;
} => {
  // oxlint-disable-next-line effect/avoid-native-object-helpers -- a mutable in-memory store a test inspects by key; structural equality buys nothing here.
  const entries = new Map<string, { readonly value: string; readonly ttlSeconds: number }>();
  return {
    entries,
    get: (origin) =>
      Effect.sync(() =>
        Option.map(Option.fromNullishOr(entries.get(origin)), (entry) => entry.value),
      ),
    put: (origin, value, ttlSeconds) =>
      Effect.sync(() => {
        entries.set(origin, { value, ttlSeconds });
      }),
  };
};

/**
 * Options for {@link fetchRobots} / {@link makeRobotsChecker}.
 *
 * @since 0.1.0
 * @category models
 */
export interface FetchRobotsOptions {
  /** The full `User-Agent` header sent with the request. */
  readonly userAgent: string;
  /** Wall-clock bound on the request. Defaults to 10 seconds. */
  readonly timeout?: Duration.Input | undefined;
  /** The body cap. Defaults to {@link MAX_ROBOTS_BYTES}. */
  readonly maxBytes?: number | undefined;
}

/**
 * Fetches `<origin>/robots.txt` through the `HttpClient` in context and
 * folds the outcome into the cache value with RFC 9309 §2.3.1's posture: a
 * 2xx body (capped), {@link ROBOTS_NO_RESTRICTIONS} for a 4xx (404
 * included), and {@link ROBOTS_UNAVAILABLE_SENTINEL} for a 5xx, a transport
 * failure, a timeout or a body that cannot be read — the crawler must
 * assume it is not permitted until it can read the rules. Never fails.
 *
 * Redirect policy is the client's: provide one whose redirects are
 * revalidated against the SSRF block list (`@thomasfosterau/effect-web/net`).
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpClient from "effect/http/HttpClient"
 * import * as HttpClientResponse from "effect/http/HttpClientResponse"
 * import { fetchRobots, ROBOTS_NO_RESTRICTIONS } from "@thomasfosterau/effect-web-robots"
 *
 * const notFound = HttpClient.make((request) =>
 *   Effect.succeed(HttpClientResponse.fromWeb(request, new Response("nope", { status: 404 }))),
 * )
 * await Effect.runPromise(
 *   fetchRobots("https://example.com", { userAgent: "mybot/1.0" }).pipe(
 *     Effect.provideService(HttpClient.HttpClient, notFound),
 *   ),
 * ) === ROBOTS_NO_RESTRICTIONS // true
 * ```
 *
 * @since 0.1.0
 * @category fetching
 */
export const fetchRobots = (
  origin: string,
  options: FetchRobotsOptions,
): Effect.Effect<string, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`${origin}/robots.txt`, {
      headers: { "user-agent": options.userAgent, accept: "text/plain,*/*;q=0.5" },
    });
    if (response.status >= 200 && response.status < 300) {
      const text = yield* response.text;
      return text.slice(0, options.maxBytes ?? MAX_ROBOTS_BYTES);
    }
    return response.status >= 500 ? ROBOTS_UNAVAILABLE_SENTINEL : ROBOTS_NO_RESTRICTIONS;
  }).pipe(
    Effect.timeout(options.timeout ?? Duration.seconds(10)),
    // Transport failure, timeout, a redirect the client refused, an
    // unreadable body: the same posture as a 5xx.
    Effect.orElseSucceed(() => ROBOTS_UNAVAILABLE_SENTINEL),
  );

/**
 * The decision {@link makeRobotsChecker}'s `checkRobots` returns.
 *
 * @since 0.1.0
 * @category models
 */
export type RobotsDecision =
  | { readonly allowed: true; readonly crawlDelaySeconds: Option.Option<number> }
  | { readonly allowed: false; readonly reason: string };

/**
 * What one crawler's checker is built from.
 *
 * @since 0.1.0
 * @category models
 */
export interface RobotsCheckerOptions<R = never> extends FetchRobotsOptions, EvaluateOptions {
  /** The product token matched against `User-agent:` lines. */
  readonly userAgentToken: string;
  /** The per-origin cache. Defaults to {@link noRobotsCache}. */
  readonly cache?: RobotsCache<R> | undefined;
  /** TTL for a body or a 4xx. Defaults to {@link ROBOTS_CACHE_TTL_SECONDS}. */
  readonly cacheTtlSeconds?: number | undefined;
  /** TTL for an unavailable outcome. Defaults to {@link ROBOTS_UNAVAILABLE_TTL_SECONDS}. */
  readonly unavailableTtlSeconds?: number | undefined;
  /**
   * Whether the query string takes part in matching. Defaults to `true`
   * (`pathname + search`, as RFC 9309 §2.2.2 matches); `false` matches the
   * pathname alone.
   */
  readonly matchQuery?: boolean | undefined;
}

/**
 * The reason a disallowed decision carries for an unavailable robots.txt.
 *
 * @since 0.1.0
 * @category constants
 */
export const ROBOTS_UNAVAILABLE_REASON =
  "robots.txt unavailable (server error) — treating as disallow";

/**
 * Builds a crawler's `checkRobots`: whether it may fetch `url` under the
 * origin's robots.txt, reading the origin's body through the cache and
 * fetching on a miss ({@link fetchRobots}), then {@link evaluateRobots}
 * for the crawler's token. Never fails — robots problems surface as
 * `allowed: false` decisions, and cache problems are the adapter's to
 * degrade. The fetch outcome is cached with the TTL its posture warrants
 * (unavailability shorter), and a failed cache write is not a failed
 * decision.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as HttpClient from "effect/http/HttpClient"
 * import * as HttpClientResponse from "effect/http/HttpClientResponse"
 * import { makeRobotsChecker, memoryRobotsCache } from "@thomasfosterau/effect-web-robots"
 *
 * const site = HttpClient.make((request) =>
 *   Effect.succeed(HttpClientResponse.fromWeb(request, new Response("User-agent: *\nDisallow: /secret/", { status: 200 }))),
 * )
 * const checkRobots = makeRobotsChecker({
 *   userAgent: "mybot/1.0 (+https://example.com)",
 *   userAgentToken: "mybot",
 *   cache: memoryRobotsCache(),
 * })
 * const decision = await Effect.runPromise(
 *   checkRobots("https://origin.example/secret/x").pipe(Effect.provideService(HttpClient.HttpClient, site)),
 * )
 * decision // { allowed: false, reason: "disallowed by robots.txt rule '/secret/'" }
 * ```
 *
 * @since 0.1.0
 * @category checking
 */
export const makeRobotsChecker = <R = never>(
  options: RobotsCheckerOptions<R>,
): ((url: string) => Effect.Effect<RobotsDecision, never, HttpClient.HttpClient | R>) => {
  const cache: RobotsCache<R> = options.cache ?? noRobotsCache;
  const loadRobots = (origin: string): Effect.Effect<string, never, HttpClient.HttpClient | R> =>
    Effect.gen(function* () {
      const cached = yield* cache.get(origin);
      if (Option.isSome(cached)) return cached.value;
      const fetched = yield* fetchRobots(origin, options);
      const ttl =
        fetched === ROBOTS_UNAVAILABLE_SENTINEL
          ? (options.unavailableTtlSeconds ?? ROBOTS_UNAVAILABLE_TTL_SECONDS)
          : (options.cacheTtlSeconds ?? ROBOTS_CACHE_TTL_SECONDS);
      yield* cache.put(origin, fetched, ttl);
      return fetched;
    });

  return (url) =>
    Effect.gen(function* () {
      const parsed = new URL(url);
      const body = yield* loadRobots(parsed.origin);
      if (body === ROBOTS_UNAVAILABLE_SENTINEL) {
        return { allowed: false, reason: ROBOTS_UNAVAILABLE_REASON } as const;
      }
      if (body === ROBOTS_NO_RESTRICTIONS) {
        return { allowed: true, crawlDelaySeconds: Option.none() } as const;
      }
      const path = options.matchQuery === false ? parsed.pathname : parsed.pathname + parsed.search;
      const evaluation = evaluateRobots(parse(body), options.userAgentToken, path, options);
      if (!evaluation.allowed) {
        return {
          allowed: false,
          reason: `disallowed by robots.txt rule '${Option.getOrElse(evaluation.matchedPattern, () => "")}'`,
        } as const;
      }
      return { allowed: true, crawlDelaySeconds: evaluation.crawlDelaySeconds } as const;
    });
};

// ── The served robots.txt ──────────────────────────────────────────────

/**
 * What a site's production `robots.txt` says.
 *
 * @since 0.1.0
 * @category models
 */
export interface RobotsPolicy {
  /**
   * Non-content URL spaces kept out of the crawl to preserve budget. A `*`
   * wildcard matches across path segments (RFC 9309 §2.2.3), so `/*\/edit`
   * covers `/posts/<uuid>/edit`.
   */
  readonly disallow: ReadonlyArray<string>;
  /** The absolute, production-canonical sitemap URL. */
  readonly sitemapUrl: string;
  /** Comment lines emitted first, without the `# ` prefix. */
  readonly comments?: ReadonlyArray<string> | undefined;
}

/**
 * The non-production body: a full disallow, no sitemap (ROBOTS-005), so a
 * `dev-<branch>` / `ci-<run>` / PR-preview deployment is never crawled.
 *
 * @since 0.1.0
 * @category serving
 */
export const NON_PRODUCTION_BODY = ["User-agent: *", "Disallow: /", ""].join("\n");

/**
 * The production body: open to all crawlers (`User-agent: *`, AI crawlers
 * included), the hygiene disallows, then the absolute sitemap URL
 * (ROBOTS-002 … -004).
 *
 * @example
 * ```ts
 * import { productionBody } from "@thomasfosterau/effect-web-robots"
 *
 * productionBody({ disallow: ["/login", "/*\/edit"], sitemapUrl: "https://example.com/sitemap.xml", comments: ["All crawlers welcome."] })
 * // "# All crawlers welcome.\nUser-agent: *\nDisallow: /login\nDisallow: /*\/edit\n\nSitemap: https://example.com/sitemap.xml\n"
 * ```
 *
 * @since 0.1.0
 * @category serving
 */
export const productionBody = (policy: RobotsPolicy): string =>
  [
    ...Arr.map(policy.comments ?? [], (comment) => `# ${comment}`),
    encode(
      new RobotsTxt({
        groups: [
          new RobotGroup({
            userAgents: ["*"],
            rules: Arr.map(policy.disallow, (path) => new Rule({ path, allow: false })),
          }),
        ],
        sitemaps: [policy.sitemapUrl],
      }),
    ),
    "",
  ].join("\n");

/**
 * The `robots.txt` body for a stage: the production policy when
 * `production`, else {@link NON_PRODUCTION_BODY} (ROBOTS-005). Pure, so the
 * stage branch is unit-testable without a runtime; the caller decides the
 * stage (`PUBLIC_STAGE === "production"`, say) and builds the sitemap URL
 * from the canonical base, never the request origin.
 *
 * @example
 * ```ts
 * import { NON_PRODUCTION_BODY, robotsBody } from "@thomasfosterau/effect-web-robots"
 *
 * robotsBody(false, { disallow: ["/login"], sitemapUrl: "https://example.com/sitemap.xml" }) === NON_PRODUCTION_BODY // true
 * robotsBody(true, { disallow: ["/login"], sitemapUrl: "https://example.com/sitemap.xml" }).includes("Sitemap: https://example.com/sitemap.xml") // true
 * ```
 *
 * @since 0.1.0
 * @category serving
 */
export const robotsBody = (production: boolean, policy: RobotsPolicy): string =>
  production ? productionBody(policy) : NON_PRODUCTION_BODY;

/**
 * The `Cache-Control` a low-churn generated document (`robots.txt`,
 * `sitemap.xml`, `feed.json`) is served with: the edge caches the whole
 * document, bounding any request-time enumeration behind it to at most one
 * per hour per edge (PERF-CACHE-002). A mutation that could change the
 * document purges its `Cache-Tag` rather than relying on the TTL alone.
 *
 * @since 0.1.0
 * @category serving
 */
export const LOW_CHURN_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * A guard for the strings the checker treats as sentinels: a real body is
 * neither empty nor the unavailable marker.
 *
 * @example
 * ```ts
 * import {
 *   isRobotsBody,
 *   ROBOTS_NO_RESTRICTIONS,
 *   ROBOTS_UNAVAILABLE_SENTINEL,
 * } from "@thomasfosterau/effect-web-robots"
 *
 * isRobotsBody("User-agent: *\nDisallow: /admin") // true
 * isRobotsBody(ROBOTS_NO_RESTRICTIONS) // false
 * isRobotsBody(ROBOTS_UNAVAILABLE_SENTINEL) // false
 * ```
 *
 * @since 0.1.0
 * @category predicates
 */
export const isRobotsBody = (value: string): boolean =>
  Predicate.isString(value) &&
  value !== ROBOTS_NO_RESTRICTIONS &&
  value !== ROBOTS_UNAVAILABLE_SENTINEL;
