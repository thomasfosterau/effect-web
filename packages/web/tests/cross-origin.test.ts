/**
 * Unit tests for the SEC-CSRF-001 cross-origin mutation guard: the Web
 * adapter, exactly as a front door applies it, the `HttpServerRequest` form,
 * and the centralised predicate an API applies to every route alike.
 *
 * `Origin` is a forbidden header name per the Fetch spec, so the test
 * environment's `Request`/`Headers` polyfill silently drops it when passed
 * via the `Request` constructor's `headers` init (it does not on a real
 * inbound Workers request, which is exactly what this guard reads in
 * production) — set it via `Headers#set` on the already-constructed request
 * instead, which the polyfill does not filter.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Headers from "effect/http/Headers";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  crossOriginMutationRejection,
  crossOriginMutationRejectionWeb,
  isCrossOrigin,
  isCrossOriginRejected,
} from "@thomasfosterau/effect-web";

const ORIGIN = "https://thomasfoster.au";

function requestWithOrigin(method: string, origin: Option.Option<string>): Request {
  const request = new Request(`${ORIGIN}/posts`, { method });
  if (Option.isSome(origin)) {
    request.headers.set("origin", origin.value);
  }
  return request;
}

describe("crossOriginMutationRejectionWeb", () => {
  it("rejects a cross-origin mutating JSON:API request with 403 CROSS_ORIGIN_REJECTED", async () => {
    const request = requestWithOrigin("POST", Option.some("https://evil.example"));

    const rejection = crossOriginMutationRejectionWeb(request, ORIGIN);

    expect(Option.isSome(rejection)).toBe(true);
    expect(Option.map(rejection, (response) => response.status)).toStrictEqual(Option.some(403));
    expect(
      Option.map(rejection, (response) => response.headers.get("cache-control")),
    ).toStrictEqual(Option.some("private, no-store"));
    // SAFETY: the guard's body is the JSON:API error document `jsonApiErrorDocument` emits; the cast names the two members read below.
    const body = (await Option.getOrElse(
      Option.map(rejection, (response) => response.json()),
      () => Promise.resolve({ errors: [] }),
    )) as { errors: Array<{ code: string }> };
    expect(body.errors[0]?.code).toBe("auth.forbidden");
  });

  it("derives the expected origin from the request URL by default", () => {
    const request = requestWithOrigin("POST", Option.some("https://evil.example"));
    expect(Option.isSome(crossOriginMutationRejectionWeb(request))).toBe(true);
    expect(
      crossOriginMutationRejectionWeb(requestWithOrigin("POST", Option.some(ORIGIN))),
    ).toStrictEqual(Option.none());
  });

  it("lets a same-origin mutating request through (None = forward)", () => {
    const request = requestWithOrigin("POST", Option.some(ORIGIN));

    expect(crossOriginMutationRejectionWeb(request, ORIGIN)).toStrictEqual(Option.none());
  });

  it("lets a mutating request with no Origin header through (non-browser clients)", () => {
    const request = requestWithOrigin("POST", Option.none());

    expect(crossOriginMutationRejectionWeb(request, ORIGIN)).toStrictEqual(Option.none());
  });

  it("lets a cross-origin read (non-mutating method) through untouched", () => {
    const request = requestWithOrigin("GET", Option.some("https://evil.example"));

    expect(crossOriginMutationRejectionWeb(request, ORIGIN)).toStrictEqual(Option.none());
  });
});

describe("crossOriginMutationRejection (HttpServerRequest)", () => {
  it("rejects a cross-origin mutation with a stamped 403 JSON:API response", async () => {
    const request = HttpServerRequest.fromWeb(
      requestWithOrigin("PATCH", Option.some("https://evil.example")),
    );

    const rejection = crossOriginMutationRejection(request, ORIGIN);

    expect(Option.isSome(rejection)).toBe(true);
    const response = Option.getOrThrow(rejection);
    expect(response.status).toBe(403);
    expect(Headers.get(response.headers, "cache-control")).toStrictEqual(
      Option.some("private, no-store"),
    );
    expect(Headers.get(response.headers, "content-type")).toStrictEqual(
      Option.some("application/vnd.api+json"),
    );
    // SAFETY: the same JSON:API error document as above, read through `toWeb`.
    const body = (await HttpServerResponse.toWeb(response).json()) as {
      errors: Array<{ code: string }>;
    };
    expect(body.errors[0]?.code).toBe("auth.forbidden");
  });

  it("passes same-origin, originless and non-mutating requests", () => {
    expect(
      crossOriginMutationRejection(
        HttpServerRequest.fromWeb(requestWithOrigin("POST", Option.some(ORIGIN))),
        ORIGIN,
      ),
    ).toStrictEqual(Option.none());
    expect(
      crossOriginMutationRejection(
        HttpServerRequest.fromWeb(requestWithOrigin("DELETE", Option.none())),
        ORIGIN,
      ),
    ).toStrictEqual(Option.none());
    expect(
      crossOriginMutationRejection(
        HttpServerRequest.fromWeb(requestWithOrigin("GET", Option.some("https://evil.example"))),
        ORIGIN,
      ),
    ).toStrictEqual(Option.none());
  });
});

describe("isCrossOriginRejected (the centralised per-route predicate)", () => {
  it("refuses a present, foreign Origin and passes an absent or own one", () => {
    expect(
      isCrossOriginRejected(
        HttpServerRequest.fromWeb(requestWithOrigin("POST", Option.some("https://evil.example"))),
        ORIGIN,
      ),
    ).toBe(true);
    expect(
      isCrossOriginRejected(
        HttpServerRequest.fromWeb(requestWithOrigin("POST", Option.some(ORIGIN))),
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      isCrossOriginRejected(
        HttpServerRequest.fromWeb(requestWithOrigin("POST", Option.none())),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("is method-agnostic: the caller decides which routes it guards", () => {
    expect(
      isCrossOriginRejected(
        HttpServerRequest.fromWeb(requestWithOrigin("GET", Option.some("https://evil.example"))),
        ORIGIN,
      ),
    ).toBe(true);
    expect(isCrossOrigin(Option.some("https://evil.example"), ORIGIN)).toBe(true);
    expect(isCrossOrigin(Option.none(), ORIGIN)).toBe(false);
  });
});
