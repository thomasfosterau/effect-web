/**
 * Unit tests for the content-negotiation dispatch verdict, ported from
 * website's `packages/api/tests/negotiate.test.ts`: which requests dispatch
 * to the JSON:API surface, the normalized cache-key representation token
 * (PERF-CACHE-005), the JSON:API §6 negotiation statuses
 * (JSONAPI-NEG-001/002), the path-match that keeps a page-only URL out of
 * the JSON:API namespace, and the Markdown representation (DISC-009).
 *
 * The route table the application derived from its `HttpApi` groups is a
 * literal path list here (the same shapes: collections, `:id`, the §7.4
 * related-resource fetches); the Markdown segments are website's.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { ApiError } from "@thomasfosterau/effect-jsonapi";
import {
  CROSS_ORIGIN_REJECTED,
  isMutatingMethod,
  JSONAPI_MEDIA_TYPE,
  jsonApiErrorResponseWeb,
  SERVICE_UNAVAILABLE,
} from "@thomasfosterau/effect-web";
import {
  chooseNegotiatedResponse,
  endpointPaths,
  makeApiPathMatcher,
  makeMarkdownPathMatcher,
  MARKDOWN_MEDIA_TYPE,
  type Negotiation,
  negotiateRepresentation,
  negotiateWebRequest,
  NOT_ACCEPTABLE,
  requestForRouter,
  requestForRouterWeb,
  UNSUPPORTED_MEDIA_TYPE,
} from "@thomasfosterau/effect-web/negotiate";

const ORIGIN = "https://thomasfoster.au";
const UUID = "0b9aab8a-3d24-4b85-a3a6-046cba9856ce";

const groups = [
  { endpoints: { list: { path: "/posts" }, get: { path: "/posts/:id" } } },
  { endpoints: { list: { path: "/notes/" }, get: { path: "/notes/:id" } } },
  { endpoints: { search: { path: "/search" } } },
  {
    endpoints: {
      list: { path: "/consumption-log-entries" },
      get: { path: "/consumption-log-entries/:id" },
    },
  },
  { endpoints: { list: { path: "/comments" } } },
  { endpoints: { items: { path: "/lists/:id/items" }, list: { path: "/list-items/:id/list" } } },
  {
    endpoints: {
      list: { path: "/web-pages" },
      get: { path: "/web-pages/:id" },
      website: { path: "/web-pages/:id/website" },
    },
  },
  { endpoints: { root: { path: "/" } } },
];
const isApiPath = makeApiPathMatcher(endpointPaths(groups));
const isMarkdownPath = makeMarkdownPathMatcher([
  "posts",
  "notes",
  "questions",
  "books",
  "consumption-log",
]);
const options = { isApiPath, isMarkdownPath, extensions: ["atomic"] };

const get = (path: string, accept?: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: accept === undefined ? {} : { accept },
  });

const write = (method: string, path: string, contentType?: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: contentType === undefined ? {} : { "content-type": contentType },
  });

const negotiate = (request: Request): Negotiation => negotiateWebRequest(request, options);

/** Assert a verdict is a clean HTML fall-through (no dispatch, no §6 error). */
const expectHtmlFallthrough = (n: Negotiation): void => {
  expect(n.dispatch).toBe(false);
  expect(n.representation).toBe("text/html");
  expect(n.error).toBeUndefined();
};

describe("makeApiPathMatcher / endpointPaths", () => {
  it("matches known endpoint paths", () => {
    expect(isApiPath("/posts")).toBe(true);
    expect(isApiPath("/posts/")).toBe(true);
    expect(isApiPath(`/posts/${UUID}`)).toBe(true);
    expect(isApiPath(`/notes/${UUID}`)).toBe(true);
    expect(isApiPath("/search")).toBe(true);
    // #1206: these two families were served but unmatched, so every
    // browser-issued request for them 404'd at the web front door.
    expect(isApiPath("/consumption-log-entries")).toBe(true);
    expect(isApiPath(`/consumption-log-entries/${UUID}`)).toBe(true);
    expect(isApiPath("/comments")).toBe(true);
  });

  it("matches the §7.4 related-resource fetch paths", () => {
    expect(isApiPath(`/lists/${UUID}/items`)).toBe(true);
    expect(isApiPath(`/list-items/${UUID}/list`)).toBe(true);
  });

  it("matches a family under its advertised segment only (#1423)", () => {
    expect(isApiPath("/web-pages")).toBe(true);
    expect(isApiPath(`/web-pages/${UUID}`)).toBe(true);
    expect(isApiPath(`/web-pages/${UUID}/website`)).toBe(true);
    expect(isApiPath("/webpages")).toBe(false);
    expect(isApiPath(`/webpages/${UUID}`)).toBe(false);
  });

  it("rejects page-only and non-endpoint paths", () => {
    expect(isApiPath("/about")).toBe(false);
    // A root endpoint path would over-match every URL and is ignored.
    expect(isApiPath("/")).toBe(false);
    // An edit page under an API segment is not itself an endpoint.
    expect(isApiPath(`/posts/${UUID}/edit`)).toBe(false);
    // An auth namespace is not part of this surface.
    expect(isApiPath("/api/auth/session")).toBe(false);
  });

  it("reads every group's endpoint paths structurally", () => {
    expect(endpointPaths(groups.slice(0, 1))).toStrictEqual(["/posts", "/posts/:id"]);
  });
});

describe("negotiateRepresentation — reads (Accept)", () => {
  it("dispatches when the JSON:API media type wins on an API path", () => {
    const n = negotiate(get("/posts", JSONAPI_MEDIA_TYPE));
    expect(n.dispatch).toBe(true);
    expect(n.representation).toBe(JSONAPI_MEDIA_TYPE);
    expect(n.error).toBeUndefined();
  });

  it("dispatches a vnd.api+json request to a resource's advertised self URL (#1423)", () => {
    const n = negotiate(get(`/web-pages/${UUID}`, JSONAPI_MEDIA_TYPE));
    expect(n.dispatch).toBe(true);
    expect(n.representation).toBe(JSONAPI_MEDIA_TYPE);
  });

  it("falls through to HTML for a browser navigation Accept", () => {
    expectHtmlFallthrough(
      negotiate(get("/posts", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")),
    );
  });

  it("normalizes distinct browser Accept strings to one cache-key token", () => {
    const a = negotiate(get("/posts", "text/html,*/*;q=0.8"));
    const b = negotiate(get("/posts", "text/html,application/xml;q=0.9"));
    expect(a.representation).toBe("text/html");
    expect(b.representation).toBe(a.representation);
  });

  it("never matches application/json or the wildcard range", () => {
    expect(negotiate(get("/posts", "application/json")).dispatch).toBe(false);
    expect(negotiate(get("/posts", "*/*")).dispatch).toBe(false);
  });

  it("falls through to HTML when the path is not an API resource", () => {
    expectHtmlFallthrough(negotiate(get("/about", JSONAPI_MEDIA_TYPE)));
  });

  it("treats no Accept header as HTML", () => {
    expectHtmlFallthrough(negotiate(get("/posts")));
  });

  it("allows profile and a supported ext parameter (clean instance)", () => {
    expect(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x"`)).dispatch).toBe(
      true,
    );
    expect(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};ext="atomic"`)).dispatch).toBe(true);
  });

  it("§5 (adopted from effect-jsonapi): an ext the api does not declare is not a clean instance", () => {
    // The applications' parser accepted any `ext`; effect-jsonapi checks the
    // URIs against `options.extensions`, per the spec.
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};ext="https://example.com/unknown"`));
    expect(n.dispatch).toBe(false);
    expect(n.error?.status).toBe(406);
  });

  it("§6: 406 when every JSON:API instance is parameterised", () => {
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1`));
    expect(n.dispatch).toBe(false);
    expect(n.error?.status).toBe(406);
    expect(n.error).toBe(NOT_ACCEPTABLE);
    expect(NOT_ACCEPTABLE.code).toBe("not_acceptable");
  });

  it("does not 406 on a page-only path even if parameterised", () => {
    const n = negotiate(get("/about", `${JSONAPI_MEDIA_TYPE};version=1`));
    expect(n.error).toBeUndefined();
    expect(n.dispatch).toBe(false);
  });

  it("loses to a higher-q competitor, wins on a tie", () => {
    expect(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5, text/html;q=0.9`)).dispatch).toBe(
      false,
    );
    expect(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE}, text/html`)).dispatch).toBe(true);
  });

  it("treats a q=0 clean instance as a refusal (HTML), not a §6 parameterisation (406)", () => {
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0, text/html`));
    expectHtmlFallthrough(n);
  });
});

describe("negotiateRepresentation — writes (Content-Type)", () => {
  it("dispatches a JSON:API write on an API path", () => {
    expect(negotiate(write("POST", "/posts", JSONAPI_MEDIA_TYPE)).dispatch).toBe(true);
  });

  it("dispatches a bodyless DELETE carrying the media type", () => {
    expect(negotiate(write("DELETE", `/posts/${UUID}`, JSONAPI_MEDIA_TYPE)).dispatch).toBe(true);
  });

  it("does not dispatch an application/json write", () => {
    expect(negotiate(write("POST", "/posts", "application/json")).dispatch).toBe(false);
  });

  it("§6: 415 when the write Content-Type carries a disallowed parameter", () => {
    const n = negotiate(write("PATCH", `/posts/${UUID}`, `${JSONAPI_MEDIA_TYPE};charset=utf-8`));
    expect(n.dispatch).toBe(false);
    expect(n.error?.status).toBe(415);
    expect(n.error).toBe(UNSUPPORTED_MEDIA_TYPE);
    expect(UNSUPPORTED_MEDIA_TYPE.code).toBe("unsupported_media_type");
  });

  it("allows profile and a supported ext on a write Content-Type", () => {
    expect(negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE};ext="atomic"`)).dispatch).toBe(
      true,
    );
    expect(
      negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x"`)).dispatch,
    ).toBe(true);
  });

  it("falls through for a JSON:API write to a non-API path", () => {
    expect(negotiate(write("POST", "/about", JSONAPI_MEDIA_TYPE)).dispatch).toBe(false);
  });
});

describe("isMutatingMethod", () => {
  it("classifies mutating methods", () => {
    for (const m of ["POST", "put", "Patch", "DELETE"]) expect(isMutatingMethod(m)).toBe(true);
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isMutatingMethod(m)).toBe(false);
  });
});

describe("requestForRouter", () => {
  it("relabels a JSON:API write Content-Type to application/json (Web)", () => {
    const router = requestForRouterWeb(write("POST", "/posts", JSONAPI_MEDIA_TYPE));
    expect(router.headers.get("content-type")).toBe("application/json");
  });

  it("leaves reads unchanged (Web)", () => {
    const original = get("/posts", JSONAPI_MEDIA_TYPE);
    expect(requestForRouterWeb(original)).toBe(original);
  });

  it("does the same over an HttpServerRequest", () => {
    const router = requestForRouter(
      HttpServerRequest.fromWeb(write("POST", "/posts", JSONAPI_MEDIA_TYPE)),
    );
    expect(router.headers["content-type"]).toBe("application/json");
    const read = HttpServerRequest.fromWeb(get("/posts", JSONAPI_MEDIA_TYPE));
    expect(requestForRouter(read)).toBe(read);
    expect(negotiateRepresentation(read, options).dispatch).toBe(true);
  });
});

describe("jsonApiErrorResponseWeb", () => {
  it("serialises a JSON:API error document with the media type", async () => {
    const response = jsonApiErrorResponseWeb({
      status: 415,
      code: "unsupported-media-type",
      title: "Unsupported Media Type",
      detail: "nope",
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe(JSONAPI_MEDIA_TYPE);
    // SAFETY: `jsonApiErrorResponseWeb` serialises `jsonApiErrorDocument`, whose shape this names.
    const body = (await response.json()) as {
      errors: ReadonlyArray<{ status: string; code: string }>;
      jsonapi: { version: string };
    };
    expect(body.jsonapi.version).toBe("1.1");
    expect(body.errors[0]?.status).toBe("415");
    expect(body.errors[0]?.code).toBe("unsupported-media-type");
  });
});

describe("makeMarkdownPathMatcher", () => {
  it("matches content detail pages", () => {
    expect(isMarkdownPath(`/posts/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/notes/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/posts/${UUID}/`)).toBe(true);
    expect(isMarkdownPath(`/books/${UUID}`)).toBe(true);
  });

  it("matches a hand-built route segment that diverges from the JSON:API type (#1574)", () => {
    expect(isMarkdownPath(`/consumption-log/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/consumption-log-entries/${UUID}`)).toBe(false);
  });

  it("does not match collections, non-content routes, or pages", () => {
    expect(isMarkdownPath("/posts")).toBe(false);
    expect(isMarkdownPath("/posts/")).toBe(false);
    expect(isMarkdownPath("/about")).toBe(false);
    expect(isMarkdownPath(`/posts/${UUID}/edit`)).toBe(false);
  });

  it("matches nothing while the segment list is empty (gardeneria's Phase 0b)", () => {
    expect(makeMarkdownPathMatcher([])(`/posts/${UUID}`)).toBe(false);
  });
});

describe("Markdown negotiation (DISC-009)", () => {
  it("serves Markdown when text/markdown wins on a content detail page", () => {
    const n = negotiate(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE));
    expect(n.markdown).toBe(true);
    expect(n.representation).toBe(MARKDOWN_MEDIA_TYPE);
    expect(n.dispatch).toBe(false);
  });

  it("keys Markdown as its own cache representation (≤3 entries/URL)", () => {
    const html = negotiate(get(`/posts/${UUID}`, "text/html"));
    const md = negotiate(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE));
    const api = negotiate(get(`/posts/${UUID}`, JSONAPI_MEDIA_TYPE));
    expect(new Set([html.representation, md.representation, api.representation]).size).toBe(3);
  });

  it("falls through to HTML for a browser Accept (html outranks markdown)", () => {
    const n = negotiate(get(`/posts/${UUID}`, "text/html,application/xhtml+xml,*/*;q=0.8"));
    expectHtmlFallthrough(n);
    expect(n.markdown).toBeUndefined();
  });

  it("falls through to HTML when markdown is offered below html", () => {
    expectHtmlFallthrough(negotiate(get(`/posts/${UUID}`, "text/html, text/markdown;q=0.5")));
  });

  it("does not serve Markdown on a non-content route even when requested", () => {
    expectHtmlFallthrough(negotiate(get("/about", MARKDOWN_MEDIA_TYPE)));
  });

  it("does not serve Markdown at all when no matcher is configured", () => {
    expectHtmlFallthrough(
      negotiateWebRequest(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE), { isApiPath }),
    );
  });

  it("ignores text/markdown on writes (negotiates on Content-Type only)", () => {
    expectHtmlFallthrough(negotiate(write("POST", `/posts/${UUID}`, "text/markdown")));
  });
});

describe("negotiateRepresentation — non-read, non-write methods", () => {
  it("falls through to HTML for OPTIONS even on an API path", () => {
    const n = negotiate(new Request(`${ORIGIN}/posts`, { method: "OPTIONS" }));
    expect(n.dispatch).toBe(false);
    expect(n.representation).toBe("text/html");
  });
});

describe("quality parsing — malformed q values", () => {
  it("treats an unparseable Accept q= as the default 1 (still wins on a tie)", () => {
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=abc`));
    expect(n.dispatch).toBe(true);
  });

  it("treats an unparseable markdown q= as the default 1", () => {
    const n = negotiate(get(`/posts/${UUID}`, "text/markdown;q=xyz"));
    expect(n.markdown).toBe(true);
    expect(n.representation).toBe(MARKDOWN_MEDIA_TYPE);
  });
});

describe("the §6 errors are effect-jsonapi's, on the wire", () => {
  it("carries ApiError.NotAcceptable's and ApiError.UnsupportedMediaType's status / code / title", () => {
    const [notAcceptable] = ApiError.toDocument(new ApiError.NotAcceptable()).errors;
    expect([notAcceptable.status, notAcceptable.code, notAcceptable.title]).toStrictEqual([
      String(NOT_ACCEPTABLE.status),
      NOT_ACCEPTABLE.code,
      NOT_ACCEPTABLE.title,
    ]);
    const [unsupported] = ApiError.toDocument(new ApiError.UnsupportedMediaType()).errors;
    expect([unsupported.status, unsupported.code, unsupported.title]).toStrictEqual([
      String(UNSUPPORTED_MEDIA_TYPE.status),
      UNSUPPORTED_MEDIA_TYPE.code,
      UNSUPPORTED_MEDIA_TYPE.title,
    ]);
  });
});

describe("exported seam guard errors", () => {
  it("serialises the cross-origin rejection as a 403 JSON:API document", async () => {
    const response = jsonApiErrorResponseWeb(CROSS_ORIGIN_REJECTED);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe(JSONAPI_MEDIA_TYPE);
    // SAFETY: the JSON:API error document `jsonApiErrorDocument` emits.
    const body = (await response.json()) as { errors: ReadonlyArray<{ code: string }> };
    expect(body.errors[0]?.code).toBe("auth.forbidden");
  });

  it("serialises the service-unavailable guard as a 503 JSON:API document", async () => {
    const response = jsonApiErrorResponseWeb(SERVICE_UNAVAILABLE);
    expect(response.status).toBe(503);
    // SAFETY: the JSON:API error document `jsonApiErrorDocument` emits.
    const body = (await response.json()) as { errors: ReadonlyArray<{ code: string }> };
    expect(body.errors[0]?.code).toBe("unavailable");
  });
});

describe("chooseNegotiatedResponse", () => {
  it("picks the Markdown response and never calls the HTML thunk", () => {
    let rendered = 0;
    expect(
      chooseNegotiatedResponse(Option.some("# md"), () => {
        rendered += 1;
        return "<html>";
      }),
    ).toBe("# md");
    expect(rendered).toBe(0);
  });

  it("falls through to the HTML thunk on None", () => {
    expect(chooseNegotiatedResponse(Option.none(), () => "<html>")).toBe("<html>");
  });
});
