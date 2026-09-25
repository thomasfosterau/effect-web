/**
 * Unit tests for the shared scrubber and the token gate — the applications'
 * `tests/unit/posthog.test.ts` verbatim, plus `resolveProjectToken`.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import {
  FILTERED,
  resolveProjectToken,
  scrubPostHogEvent,
  scrubPostHogProperties,
} from "@thomasfosterau/effect-web-posthog";

describe("scrubPostHogProperties", () => {
  it("removes cookie header", () => {
    const properties = {
      headers: { cookie: "session=abc123", "content-type": "text/html" },
    };
    scrubPostHogProperties(properties);
    expect(properties.headers.cookie).toBe(FILTERED);
    expect(properties.headers["content-type"]).toBe("text/html");
  });

  it("removes authorization header", () => {
    const properties = { headers: { Authorization: "Bearer token123" } };
    scrubPostHogProperties(properties);
    expect(properties.headers.Authorization).toBe("[Filtered]");
  });

  it("removes set-cookie header", () => {
    const properties = { headers: { "Set-Cookie": "session=xyz" } };
    scrubPostHogProperties(properties);
    expect(properties.headers["Set-Cookie"]).toBe("[Filtered]");
  });

  it("removes proxy-authorization header", () => {
    const properties = { headers: { "Proxy-Authorization": "Basic abc" } };
    scrubPostHogProperties(properties);
    expect(properties.headers["Proxy-Authorization"]).toBe("[Filtered]");
  });

  it("removes x-api-key header", () => {
    const properties = { headers: { "X-Api-Key": "key123" } };
    scrubPostHogProperties(properties);
    expect(properties.headers["X-Api-Key"]).toBe("[Filtered]");
  });

  it("replaces cookies value", () => {
    const properties = { cookies: { session: "abc" } };
    scrubPostHogProperties(properties);
    expect(properties.cookies).toBe("[Filtered]");
  });

  it("preserves non-sensitive headers", () => {
    const properties = { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } };
    scrubPostHogProperties(properties);
    expect(properties.headers["user-agent"]).toBe("Mozilla/5.0");
    expect(properties.headers.accept).toBe("text/html");
  });

  it("handles missing properties", () => {
    expect(() => scrubPostHogProperties(undefined)).not.toThrow();
    expect(() => scrubPostHogProperties(null)).not.toThrow();
  });

  it("handles properties with no headers or cookies", () => {
    const properties = { other: "value" };
    scrubPostHogProperties(properties);
    expect(properties).toEqual({ other: "value" });
  });

  it("handles undefined headers", () => {
    const properties = { headers: undefined };
    expect(() => scrubPostHogProperties(properties)).not.toThrow();
    expect(properties.headers).toBeUndefined();
  });

  it("leaves a non-object headers value alone", () => {
    const properties = { headers: "cookie=abc" };
    scrubPostHogProperties(properties);
    expect(properties.headers).toBe("cookie=abc");
  });
});

describe("scrubPostHogEvent", () => {
  it("scrubs the event's properties in place and returns the same reference", () => {
    const event = { properties: { headers: { cookie: "session=abc" } } };
    const result = scrubPostHogEvent(event);
    expect(result).toBe(event);
    expect(result.properties.headers.cookie).toBe("[Filtered]");
  });

  it("passes through null unchanged", () => {
    expect(scrubPostHogEvent(null)).toBeNull();
  });

  it("tolerates an event with null properties (the SDKs' own shape)", () => {
    const event = { properties: null };
    expect(scrubPostHogEvent(event)).toBe(event);
  });
});

describe("resolveProjectToken", () => {
  it("is Some for a present, non-blank token", () => {
    expect(resolveProjectToken("phc_present")).toEqual(Option.some("phc_present"));
  });

  it("is None for an absent token — the local-dev and fork-stage state", () => {
    expect(Option.isNone(resolveProjectToken(undefined))).toBe(true);
  });

  it('is None for a blank ("") token — must never read as configured (commit 9e7114ae)', () => {
    expect(Option.isNone(resolveProjectToken(""))).toBe(true);
    expect(Option.isNone(resolveProjectToken("   "))).toBe(true);
  });
});
