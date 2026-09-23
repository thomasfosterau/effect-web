/**
 * Unit tests for the shared outbound-request safety primitives — the lexical
 * SSRF host block list and the redirect-revalidating fetch built on it
 * (SEC-SSRF / SEC-SSRF-003). Ported from website's
 * `packages/bindings/tests/net.test.ts` (itself moved there from the
 * web-archive pipeline's `url.test.ts` with the code, #559), plus the
 * Effect-native surface (`checkUrl`, `followRedirects`) the plain API now
 * wraps.
 */

/*
 * A vitest test body IS the runtime boundary — it is the entrypoint that runs
 * the effect under test, and `effect-run-in-body` has no entrypoint detection.
 */
/* oxlint-disable effect/effect-run-in-body */

import { describe, expect, it } from "vite-plus/test";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import {
  assertAllowedUrl,
  checkUrl,
  fetchFollowingRedirects,
  followRedirects,
  isBlockedHost,
} from "@thomasfosterau/effect-web/net";

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local, CGNAT, and internal hosts", () => {
    Array.forEach(
      [
        "localhost",
        "foo.localhost",
        "db.internal",
        "gateway.home.arpa",
        "127.0.0.1",
        "10.0.0.1",
        "192.168.1.1",
        "172.16.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "[::1]",
        "[fc00::1]",
        "[fe80::1]",
      ],
      (host) => {
        expect(isBlockedHost(host)).toBe(true);
      },
    );
  });

  it("blocks IPv4-mapped and NAT64 IPv6 literals carrying private IPv4 addresses", () => {
    Array.forEach(
      [
        // Hex-group form — what `new URL("http://[::ffff:127.0.0.1]/")`
        // canonicalises `hostname` to.
        "[::ffff:7f00:1]",
        "[::ffff:a00:1]",
        "[::ffff:c0a8:101]",
        "[64:ff9b::7f00:1]",
        // Dotted form, in case a caller hands us an un-canonicalised literal.
        "[::ffff:127.0.0.1]",
        "[::ffff:169.254.169.254]",
      ],
      (host) => {
        expect(isBlockedHost(host)).toBe(true);
      },
    );
  });

  /**
   * The fully-qualified (trailing-root-dot) spelling of every blocked name.
   *
   * `new URL("http://localhost./")` keeps the dot in `.hostname`, and DNS
   * resolves `localhost.` exactly as it resolves `localhost` — so without the
   * normalisation this is a live bypass of both the exact-match and the
   * suffix-match arm.
   */
  it("blocks the trailing-root-dot spelling of a blocked host", () => {
    Array.forEach(
      [
        "localhost.",
        "foo.localhost.",
        "db.internal.",
        "gateway.home.arpa.",
        "printer.local.",
        // Repeated dots are not resolvable, but normalising them costs nothing
        // and keeps the check total.
        "localhost..",
        // Case is normalised alongside the dot, not instead of it.
        "LOCALHOST.",
      ],
      (host) => {
        expect(isBlockedHost(host)).toBe(true);
      },
    );
  });

  it("treats an out-of-range dotted quad as private rather than public", () => {
    // `999.1.1.1` matches the dotted-quad shape but is not a valid address.
    // The guard fails safe: an unparseable quad is blocked, never allowed
    // through on the grounds that it did not match a known-private range.
    Array.forEach(["999.1.1.1", "256.1.1.1", "1.2.3.999"], (host) => {
      expect(isBlockedHost(host)).toBe(true);
    });
  });

  it("does not mistake a malformed IPv4-mapped literal for a private address", () => {
    // The embedded-IPv4 extractor yields nothing for anything that is not a
    // well-formed two-group hex or dotted form, so these fall through to the
    // public verdict instead of being misread as a private quad.
    Array.forEach(["[::ffff:zzzz:1]", "[::ffff:1:2:3]"], (host) => {
      expect(isBlockedHost(host)).toBe(false);
    });
  });

  it("allows public hostnames and addresses", () => {
    Array.forEach(
      [
        "example.com",
        "sub.example.org",
        "93.184.216.34",
        "8.8.8.8",
        "[2606:4700:4700::1111]",
        // IPv4-mapped / NAT64 forms of *public* IPv4 addresses stay allowed.
        "[::ffff:5db8:d822]",
        "[64:ff9b::808:808]",
        // A public name is not blocked merely for being fully qualified.
        "example.com.",
      ],
      (host) => {
        expect(isBlockedHost(host)).toBe(false);
      },
    );
  });
});

describe("assertAllowedUrl", () => {
  it("returns the parsed URL for an allowed public http(s) target", () => {
    expect(assertAllowedUrl("https://example.com/page").href).toBe("https://example.com/page");
  });

  it("rejects an unparsable URL", () => {
    expect(() => assertAllowedUrl("not a url at all")).toThrow("invalid URL");
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => assertAllowedUrl("ftp://example.com/file")).toThrow("unsupported scheme");
  });

  it("rejects embedded credentials", () => {
    expect(() => assertAllowedUrl("https://user:pass@example.com/")).toThrow(
      "embedded credentials",
    );
  });

  it("rejects a blocked host", () => {
    expect(() => assertAllowedUrl("http://127.0.0.1/")).toThrow("blocked host");
  });
});

describe("checkUrl (the Result form)", () => {
  it("classifies every rejection with a tagged reason", () => {
    const reasonOf = (url: string) =>
      Result.match(checkUrl(url), {
        onFailure: (error) => error.reason,
        onSuccess: () => "allowed",
      });
    expect(reasonOf("not a url at all")).toBe("invalid");
    expect(reasonOf("ftp://example.com/file")).toBe("scheme");
    expect(reasonOf("https://user:pass@example.com/")).toBe("credentials");
    expect(reasonOf("http://127.0.0.1/")).toBe("blocked-host");
    expect(reasonOf("https://example.com/")).toBe("allowed");
  });

  it("is a tagged error a caller can catch by tag", async () => {
    const tag = await Effect.runPromise(
      Effect.fromResult(checkUrl("http://localhost/")).pipe(
        Effect.map(() => "allowed"),
        Effect.catchTag("UnsafeUrl", (error) => Effect.succeed(error._tag)),
      ),
    );
    expect(tag).toBe("UnsafeUrl");
  });
});

/**
 * Runs `fn` with `globalThis.fetch` stubbed to `impl` (keyed on the request
 * URL), restoring the real fetch afterward. No `vi` dependency — the suite is
 * otherwise mock-free. Stubbing the global (rather than passing `fetch` in
 * the options) is deliberate: it proves the default resolves at call time.
 */
const withMockFetch = async (
  impl: (url: string) => Response,
  fn: () => Promise<void>,
): Promise<void> => {
  const original = globalThis.fetch;
  // SAFETY: the stub honours the one call shape the guard makes (`fetch(url, init)`) and ignores `init`; the cast widens it back to the global signature for the assignment.
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) =>
    Promise.resolve(impl(Predicate.isString(input) ? input : String(input)))) as typeof fetch;
  // oxlint-disable-next-line effect/avoid-try-catch -- try/**finally**, not try/catch: nothing is caught, so no error channel is being swallowed. `finally` is what restores the real `globalThis.fetch` when the assertion inside `fn` throws.
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

const redirectTo = (location: string, status = 302): Response =>
  new Response(null, { status, headers: { location } });

describe("fetchFollowingRedirects (SEC-SSRF-003)", () => {
  it("returns directly when there is no redirect", async () => {
    await withMockFetch(
      () => new Response("hi", { status: 200 }),
      async () => {
        const { response, finalUrl } = await fetchFollowingRedirects(
          "https://example.com/page",
          {},
        );
        expect(finalUrl).toBe("https://example.com/page");
        expect(response.status).toBe(200);
      },
    );
  });

  it("follows redirects through public hosts and returns the validated final URL", async () => {
    await withMockFetch(
      (url) =>
        url === "https://example.com/"
          ? redirectTo("https://example.org/final")
          : new Response("ok", { status: 200 }),
      async () => {
        const { finalUrl, response } = await fetchFollowingRedirects("https://example.com/", {});
        expect(finalUrl).toBe("https://example.org/final");
        expect(response.status).toBe(200);
      },
    );
  });

  it("rejects when the initial host is blocked, without making a request", async () => {
    let called = false;
    await withMockFetch(
      () => {
        called = true;
        return new Response("nope", { status: 200 });
      },
      async () => {
        await expect(fetchFollowingRedirects("http://127.0.0.1/", {})).rejects.toThrow(
          "blocked host",
        );
      },
    );
    expect(called).toBe(false);
  });

  it("rejects a redirect into a link-local / private host", async () => {
    await withMockFetch(
      (url) =>
        url === "https://example.com/"
          ? redirectTo("http://169.254.169.254/latest/meta-data")
          : new Response("should not be reached", { status: 200 }),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {})).rejects.toThrow(
          "blocked host",
        );
      },
    );
  });

  it("rejects a redirect to the trailing-dot spelling of a loopback host", async () => {
    await withMockFetch(
      (url) =>
        url === "https://example.com/"
          ? redirectTo("http://localhost./admin")
          : new Response("should not be reached", { status: 200 }),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {})).rejects.toThrow(
          "blocked host",
        );
      },
    );
  });

  it("rejects a redirect to a non-http(s) scheme", async () => {
    await withMockFetch(
      (url) =>
        url === "https://example.com/"
          ? redirectTo("ftp://example.com/x")
          : new Response("x", { status: 200 }),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {})).rejects.toThrow(
          "unsupported scheme",
        );
      },
    );
  });

  it("rejects a redirect into a credentialed URL", async () => {
    await withMockFetch(
      (url) =>
        url === "https://example.com/"
          ? redirectTo("https://user:pass@example.org/admin")
          : new Response("should not be reached", { status: 200 }),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {})).rejects.toThrow(
          "embedded credentials",
        );
      },
    );
  });

  it("rejects an unparsable initial URL without making a request", async () => {
    let called = false;
    await withMockFetch(
      () => {
        called = true;
        return new Response("nope", { status: 200 });
      },
      async () => {
        await expect(fetchFollowingRedirects("not a url at all", {})).rejects.toThrow(
          "invalid URL",
        );
      },
    );
    expect(called).toBe(false);
  });

  it("rejects a redirect whose Location cannot be resolved to a URL", async () => {
    await withMockFetch(
      (url) =>
        url === "https://example.com/"
          ? // A bare scheme+authority marker resolves to nothing, so the hop
            // target is unknowable — refused rather than guessed at.
            redirectTo("http://")
          : new Response("should not be reached", { status: 200 }),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {})).rejects.toThrow(
          "invalid redirect target",
        );
      },
    );
  });

  it("rejects a redirect with no Location header", async () => {
    await withMockFetch(
      () => new Response(null, { status: 302 }),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {})).rejects.toThrow(
          "no Location",
        );
      },
    );
  });

  it("rejects after exceeding the hop limit", async () => {
    let n = 0;
    await withMockFetch(
      () => redirectTo(`https://example.com/${n++}`),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/start", {}, 2)).rejects.toThrow(
          "too many redirects",
        );
      },
    );
  });

  it("refuses to follow any redirect when maxHops is 0", async () => {
    // `maxHops: 0` is the shape for a POST whose redirected replay must never
    // land at a host the caller's validation never covered.
    await withMockFetch(
      () => redirectTo("https://example.org/elsewhere"),
      async () => {
        await expect(fetchFollowingRedirects("https://example.com/", {}, 0)).rejects.toThrow(
          "too many redirects",
        );
      },
    );
  });

  it("surfaces a fetch rejection as-is", async () => {
    const failing: typeof fetch = () => Promise.reject(new Error("socket hang up"));
    await expect(fetchFollowingRedirects("https://example.com/", {}, 5, failing)).rejects.toThrow(
      "socket hang up",
    );
  });
});

describe("followRedirects (the Effect form)", () => {
  const stub =
    (impl: (url: string) => Response): typeof fetch =>
    (input) =>
      Promise.resolve(impl(Predicate.isString(input) ? input : String(input)));

  it("fails with UnsafeUrl on a blocked hop and RedirectRejected on a broken chain", async () => {
    const blocked = await Effect.runPromise(
      Effect.flip(
        followRedirects(
          "https://example.com/",
          {},
          {
            fetch: stub((url) =>
              url === "https://example.com/" ? redirectTo("http://10.0.0.1/") : new Response("x"),
            ),
          },
        ),
      ),
    );
    expect(blocked._tag).toBe("UnsafeUrl");

    const looping = await Effect.runPromise(
      Effect.flip(
        followRedirects(
          "https://example.com/",
          {},
          { maxHops: 1, fetch: stub(() => redirectTo("https://example.com/again")) },
        ),
      ),
    );
    expect(looping._tag).toBe("RedirectRejected");
    expect(looping._tag === "RedirectRejected" && looping.reason).toBe("too-many-hops");
  });

  it("fails with FetchFailed carrying the cause when fetch rejects", async () => {
    const cause = new Error("socket hang up");
    const failed = await Effect.runPromise(
      Effect.flip(
        followRedirects("https://example.com/", {}, { fetch: () => Promise.reject(cause) }),
      ),
    );
    expect(failed._tag).toBe("FetchFailed");
    expect(failed._tag === "FetchFailed" && failed.cause).toBe(cause);
  });

  it("passes the shared init (signal included) to every hop with redirect: manual", async () => {
    const seen: Array<RequestInit | undefined> = [];
    const controller = new AbortController();
    const { finalUrl } = await Effect.runPromise(
      followRedirects(
        "https://example.com/",
        { signal: controller.signal, headers: { "user-agent": "test" } },
        {
          fetch: (input, init) => {
            seen.push(init);
            return Promise.resolve(
              String(input) === "https://example.com/" ? redirectTo("/final") : new Response("ok"),
            );
          },
        },
      ),
    );
    expect(finalUrl).toBe("https://example.com/final");
    expect(seen).toHaveLength(2);
    for (const init of seen) {
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBe(controller.signal);
    }
  });
});
