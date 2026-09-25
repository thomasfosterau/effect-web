/**
 * Type-level tests: the expect-error directives are the assertions, checked
 * by tsconfig.test.json (which resolves the package name to `src/`). Every
 * binding is exported so an unused-local error can never stand in for the
 * assertion a directive expects.
 */
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Result from "effect/Result";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  crossOriginMutationRejection,
  type RouteVaryClass,
  responseVary,
  securityHeaders,
} from "@thomasfosterau/effect-web";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import {
  checkUrl,
  type FetchFailed,
  followRedirects,
  type RedirectRejected,
  type UnsafeUrl,
} from "@thomasfosterau/effect-web/net";
import { type Negotiation, negotiateRepresentation } from "@thomasfosterau/effect-web/negotiate";
import { spanTracer } from "@thomasfosterau/effect-web/observability";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

// The redirect-following fetch names every failure it can produce, and needs
// no service.
export const followed = followRedirects("https://example.com/", {});
export type FollowedError = Effect.Error<typeof followed>;
export type FollowedServices = Effect.Services<typeof followed>;

// The URL check is a pure Result, never an Effect.
export const checked: Result.Result<URL, UnsafeUrl> = checkUrl("https://example.com/");

// A header policy is `Headers -> Headers`; a route class is the closed union.
export const policy: (headers: Headers.Headers) => Headers.Headers = securityHeaders;
export const varied = responseVary(Headers.empty, "negotiated");
// @ts-expect-error -- not a route class
export const misclassified = responseVary(Headers.empty, "html");

// The guard's rejection is an Option of an HttpServerResponse.
export const rejection: Option.Option<HttpServerResponse.HttpServerResponse> =
  crossOriginMutationRejection(
    HttpServerRequest.fromWeb(new Request("https://example.com/")),
    "https://example.com",
  );

// The verdict's optional members are absent-or-value, never null.
export const verdict: Negotiation = negotiateRepresentation(
  HttpServerRequest.fromWeb(new Request("https://example.com/posts")),
  { isApiPath: () => true },
);
const bare = HttpServerRequest.fromWeb(new Request("https://example.com/"));
// @ts-expect-error -- `isApiPath` is required: the verdict cannot know the api's routes
export const noRoutes = negotiateRepresentation(bare, {});

// The tracer takes the allow-list; it is not a constant.
// @ts-expect-error -- the allow-list is a required parameter
export const untracked = spanTracer();

export type Checks = [
  /** _followedErrorsAreTagged */ Assert<
    Equals<FollowedError, UnsafeUrl | RedirectRejected | FetchFailed>
  >,
  /** _followedNeedsNoService */ Assert<Equals<FollowedServices, never>>,
  /** _routeClassIsClosed */ Assert<
    Equals<RouteVaryClass, "locale-invariant" | "format-negotiated" | "negotiated">
  >,
  /** _verdictMarkdownIsOptionalBoolean */ Assert<
    Equals<Negotiation["markdown"], boolean | undefined>
  >,
];
