/**
 * The served `robots.txt` body builders, over the policy-as-parameter form
 * (a representative disallow list is the fixture).
 *
 * ROBOTS-002 production opens to all crawlers; ROBOTS-003 it disallows the
 * non-content URL spaces; ROBOTS-004 it declares an absolute `Sitemap:`;
 * ROBOTS-005 non-production serves a full disallow.
 */

import { describe, expect, it } from "vite-plus/test";
import {
  LOW_CHURN_CACHE_CONTROL,
  NON_PRODUCTION_BODY,
  productionBody,
  robotsBody,
  type RobotsPolicy,
} from "@thomasfosterau/effect-robots";

const SITEMAP_URL = "https://thomasfoster.au/sitemap.xml";
const DISALLOW = ["/login", "/signup", "/api/", "/search", "/*/search", "/*/create", "/*/edit"];
const policy: RobotsPolicy = {
  disallow: DISALLOW,
  sitemapUrl: SITEMAP_URL,
  comments: ["Public knowledge base — all crawlers welcome, including AI."],
};

describe("robotsBody — stage selection", () => {
  it("ROBOTS-005: non-production serves the full-disallow stanza", () => {
    expect(robotsBody(false, policy)).toBe(NON_PRODUCTION_BODY);
    expect(robotsBody(false, policy)).toContain("User-agent: *");
    expect(robotsBody(false, policy)).toContain("Disallow: /");
    expect(robotsBody(false, policy)).not.toContain("Sitemap:");
  });

  it("production serves the full policy keyed off the supplied sitemap URL", () => {
    expect(robotsBody(true, policy)).toBe(productionBody(policy));
  });
});

describe("productionBody (ROBOTS-002/003/004)", () => {
  const body = productionBody(policy);

  it("ROBOTS-002: opens to all crawlers with no AI-specific block", () => {
    expect(body).toContain("User-agent: *");
    expect(body).not.toContain("Google-Extended");
    expect(body).not.toContain("Applebot-Extended");
  });

  it("ROBOTS-003: disallows every non-content URL space", () => {
    for (const path of DISALLOW) {
      expect(body).toContain(`Disallow: ${path}`);
    }
    expect(body).toContain("Disallow: /search");
    expect(body).toContain("Disallow: /*/search");
    expect(body).toContain("Disallow: /api/");
  });

  it("ROBOTS-004: declares the sitemap with the supplied absolute URL", () => {
    expect(body).toContain(`Sitemap: ${SITEMAP_URL}`);
    expect(body).toMatch(/^Sitemap: https:\/\//m);
  });

  it("is RFC-9309-shaped: comments, a single User-agent group, then the Sitemap field", () => {
    expect(body.startsWith("# Public knowledge base")).toBe(true);
    const lines = body.split("\n").filter((line) => line && !line.startsWith("#"));
    expect(lines[0]).toBe("User-agent: *");
    expect(lines.filter((line) => line.startsWith("Disallow: ")).length).toBe(DISALLOW.length);
    expect(lines.at(-1)).toBe(`Sitemap: ${SITEMAP_URL}`);
    expect(body.endsWith("\n")).toBe(true);
  });

  it("is byte-identical to the hand-joined body", () => {
    expect(body).toBe(
      [
        "# Public knowledge base — all crawlers welcome, including AI.",
        "User-agent: *",
        ...DISALLOW.map((path) => `Disallow: ${path}`),
        "",
        `Sitemap: ${SITEMAP_URL}`,
        "",
      ].join("\n"),
    );
  });

  it("emits no comment line when the policy has none", () => {
    expect(
      productionBody({ disallow: [], sitemapUrl: SITEMAP_URL }).startsWith("User-agent: *"),
    ).toBe(true);
  });
});

describe("LOW_CHURN_CACHE_CONTROL", () => {
  it("is the PERF-CACHE-002 policy the three documents share", () => {
    expect(LOW_CHURN_CACHE_CONTROL).toBe(
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
  });
});
