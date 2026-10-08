/**
 * Unit tests for `resolveClientIp` — the client-address decision an
 * analytics reverse proxy uses to pick an `x-forwarded-for` value
 * (SEC-SSRF-005).
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { resolveClientIp } from "@thomasfosterau/effect-web";

describe("resolveClientIp", () => {
  it("chooses the platform-resolved address when it's non-empty", () => {
    expect(resolveClientIp(() => "203.0.113.7")).toStrictEqual(Option.some("203.0.113.7"));
  });

  it("chooses None when the platform resolves to a blank address", () => {
    expect(resolveClientIp(() => "")).toStrictEqual(Option.none());
  });

  it("chooses None when getClientAddress throws (platform can't determine an address)", () => {
    expect(
      resolveClientIp(() => {
        throw new Error("no address");
      }),
    ).toStrictEqual(Option.none());
  });
});
