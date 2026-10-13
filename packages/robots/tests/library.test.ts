/**
 * The library's acceptance suite, run on `vite-plus/test`: it holds the API
 * and behaviour of `parse` / `encode` and the matcher fixed.
 */

import { describe, expect, it as test } from "vite-plus/test";
import {
  encode,
  getCrawlDelay,
  getSitemaps,
  isAllowed,
  parse,
  RobotGroup,
  RobotsTxt,
  Rule,
} from "@thomasfosterau/effect-robots";

describe("Parser", () => {
  test("should parse basic robots.txt", () => {
    const content = `
User-agent: *
Disallow: /admin
Allow: /public
    `.trim();

    const result = parse(content);

    expect(result.groups).toHaveLength(1);
    expect([...result.groups[0]!.userAgents]).toEqual(["*"]);
    expect(result.groups[0]?.rules).toHaveLength(2);
    expect(result.groups[0]?.rules[0]?.path).toBe("/admin");
    expect(result.groups[0]?.rules[0]?.allow).toBe(false);
    expect(result.groups[0]?.rules[1]?.path).toBe("/public");
    expect(result.groups[0]?.rules[1]?.allow).toBe(true);
  });

  test("should parse multiple user agents", () => {
    const content = `
User-agent: Googlebot
User-agent: Bingbot
Disallow: /private
    `.trim();

    const result = parse(content);

    expect(result.groups).toHaveLength(1);
    expect([...result.groups[0]!.userAgents]).toEqual(["Googlebot", "Bingbot"]);
  });

  test("should parse multiple groups", () => {
    const content = `
User-agent: Googlebot
Disallow: /no-google

User-agent: *
Disallow: /admin
    `.trim();

    const result = parse(content);

    expect(result.groups).toHaveLength(2);
    expect([...result.groups[0]!.userAgents]).toEqual(["Googlebot"]);
    expect([...result.groups[1]!.userAgents]).toEqual(["*"]);
  });

  test("should parse crawl-delay", () => {
    const content = `
User-agent: *
Crawl-delay: 10
Disallow: /admin
    `.trim();

    const result = parse(content);

    expect(result.groups[0]?.crawlDelay).toBe(10);
  });

  test("should parse sitemaps", () => {
    const content = `
User-agent: *
Disallow: /admin

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap2.xml
    `.trim();

    const result = parse(content);

    expect([...result.sitemaps]).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap2.xml",
    ]);
  });

  test("should ignore comments", () => {
    const content = `
# This is a comment
User-agent: * # inline comment
Disallow: /admin # another comment
    `.trim();

    const result = parse(content);

    expect(result.groups).toHaveLength(1);
    expect([...result.groups[0]!.userAgents]).toEqual(["*"]);
    expect(result.groups[0]?.rules).toHaveLength(1);
  });

  test("should handle empty lines", () => {
    const content = `
User-agent: *

Disallow: /admin

    `.trim();

    const result = parse(content);

    expect(result.groups).toHaveLength(1);
  });
});

describe("Encoder", () => {
  test("should encode basic robots.txt", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({
          userAgents: ["*"],
          rules: [
            new Rule({ path: "/admin", allow: false }),
            new Rule({ path: "/public", allow: true }),
          ],
        }),
      ],
      sitemaps: [],
    });

    const result = encode(robotsTxt);

    expect(result).toContain("User-agent: *");
    expect(result).toContain("Disallow: /admin");
    expect(result).toContain("Allow: /public");
  });

  test("should encode multiple user agents", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({
          userAgents: ["Googlebot", "Bingbot"],
          rules: [new Rule({ path: "/private", allow: false })],
        }),
      ],
      sitemaps: [],
    });

    const result = encode(robotsTxt);

    expect(result).toContain("User-agent: Googlebot");
    expect(result).toContain("User-agent: Bingbot");
  });

  test("should encode crawl-delay", () => {
    const robotsTxt = new RobotsTxt({
      groups: [new RobotGroup({ userAgents: ["*"], rules: [], crawlDelay: 10 })],
      sitemaps: [],
    });

    const result = encode(robotsTxt);

    expect(result).toContain("Crawl-delay: 10");
  });

  test("should encode sitemaps", () => {
    const robotsTxt = new RobotsTxt({
      groups: [],
      sitemaps: ["https://example.com/sitemap.xml", "https://example.com/sitemap2.xml"],
    });

    const result = encode(robotsTxt);

    expect(result).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(result).toContain("Sitemap: https://example.com/sitemap2.xml");
  });
});

describe("Matcher", () => {
  test("should allow access when no rules match", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/admin", allow: false })] }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/public")).toBe(true);
  });

  test("should disallow access to disallowed paths", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/admin", allow: false })] }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/admin")).toBe(false);
    expect(isAllowed(robotsTxt, "MyBot", "/admin/page")).toBe(false);
  });

  test("should apply most specific rule", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({
          userAgents: ["*"],
          rules: [
            new Rule({ path: "/admin", allow: false }),
            new Rule({ path: "/admin/public", allow: true }),
          ],
        }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/admin")).toBe(false);
    expect(isAllowed(robotsTxt, "MyBot", "/admin/private")).toBe(false);
    expect(isAllowed(robotsTxt, "MyBot", "/admin/public")).toBe(true);
    expect(isAllowed(robotsTxt, "MyBot", "/admin/public/page")).toBe(true);
  });

  test("should match user agents case-insensitively", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({
          userAgents: ["GoogleBot"],
          rules: [new Rule({ path: "/no-google", allow: false })],
        }),
        new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/admin", allow: false })] }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "googlebot", "/no-google")).toBe(false);
    expect(isAllowed(robotsTxt, "GOOGLEBOT", "/no-google")).toBe(false);
  });

  test("should support wildcard matching", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/*.php", allow: false })] }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/page.php")).toBe(false);
    expect(isAllowed(robotsTxt, "MyBot", "/admin/page.php")).toBe(false);
    expect(isAllowed(robotsTxt, "MyBot", "/page.html")).toBe(true);
  });

  test("should support end-of-path anchor", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/page$", allow: false })] }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/page")).toBe(false);
    expect(isAllowed(robotsTxt, "MyBot", "/page/subpage")).toBe(true);
    expect(isAllowed(robotsTxt, "MyBot", "/page.html")).toBe(true);
  });

  test("should get crawl delay", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({ userAgents: ["Googlebot"], rules: [], crawlDelay: 5 }),
        new RobotGroup({ userAgents: ["*"], rules: [], crawlDelay: 10 }),
      ],
      sitemaps: [],
    });

    expect(getCrawlDelay(robotsTxt, "Googlebot")).toBe(5);
    expect(getCrawlDelay(robotsTxt, "OtherBot")).toBe(10);
  });

  test("should get sitemaps", () => {
    const robotsTxt = new RobotsTxt({
      groups: [],
      sitemaps: ["https://example.com/sitemap.xml", "https://example.com/sitemap2.xml"],
    });

    expect([...getSitemaps(robotsTxt)]).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap2.xml",
    ]);
  });

  test("should select most specific user-agent group (RFC 9309)", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({ userAgents: ["*"], rules: [new Rule({ path: "/", allow: false })] }),
        new RobotGroup({
          userAgents: ["google"],
          rules: [new Rule({ path: "/private", allow: false })],
        }),
        new RobotGroup({
          userAgents: ["googlebot"],
          rules: [new Rule({ path: "/admin", allow: false })],
        }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "googlebot", "/")).toBe(true);
    expect(isAllowed(robotsTxt, "googlebot", "/private")).toBe(true);
    expect(isAllowed(robotsTxt, "googlebot", "/admin")).toBe(false);

    expect(isAllowed(robotsTxt, "googlebot-news", "/admin")).toBe(false);
    expect(isAllowed(robotsTxt, "googlebot-news", "/")).toBe(true);
    expect(isAllowed(robotsTxt, "googlebot-news", "/private")).toBe(true);

    expect(isAllowed(robotsTxt, "google-something", "/private")).toBe(false);
    expect(isAllowed(robotsTxt, "google-something", "/admin")).toBe(true);

    expect(isAllowed(robotsTxt, "otherbot", "/")).toBe(false);
  });

  test("should apply Allow precedence for equal-length rules (RFC 9309)", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({
          userAgents: ["*"],
          rules: [
            new Rule({ path: "/page", allow: false }),
            new Rule({ path: "/page", allow: true }),
          ],
        }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/page")).toBe(true);
  });

  test("should apply Allow precedence regardless of order (RFC 9309)", () => {
    const robotsTxt = new RobotsTxt({
      groups: [
        new RobotGroup({
          userAgents: ["*"],
          rules: [
            new Rule({ path: "/page", allow: true }),
            new Rule({ path: "/page", allow: false }),
          ],
        }),
      ],
      sitemaps: [],
    });

    expect(isAllowed(robotsTxt, "MyBot", "/page")).toBe(true);
  });

  test("should parse groups with only crawl-delay correctly", () => {
    const content = `
User-agent: A
Crawl-delay: 10

User-agent: B
Disallow: /admin
    `.trim();

    const result = parse(content);

    expect(result.groups).toHaveLength(2);
    expect([...result.groups[0]!.userAgents]).toEqual(["A"]);
    expect(result.groups[0]?.crawlDelay).toBe(10);
    expect(result.groups[0]?.rules).toHaveLength(0);

    expect([...result.groups[1]!.userAgents]).toEqual(["B"]);
    expect(result.groups[1]?.rules).toHaveLength(1);
  });
});

describe("Round-trip parsing and encoding", () => {
  test("should maintain data through parse and encode", () => {
    const original = `User-agent: *
Disallow: /admin
Allow: /public

Sitemap: https://example.com/sitemap.xml`;

    const parsed = parse(original);
    const encoded = encode(parsed);
    const reparsed = parse(encoded);

    expect([...reparsed.groups[0]!.userAgents]).toEqual([...parsed.groups[0]!.userAgents]);
    expect(reparsed.groups[0]?.rules).toHaveLength(parsed.groups[0]?.rules.length ?? 0);
    expect([...reparsed.sitemaps]).toEqual([...parsed.sitemaps]);
  });
});
