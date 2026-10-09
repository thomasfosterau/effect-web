/**
 * Unit tests for the content-negotiation dispatch verdict: which requests
 * dispatch to the JSON:API surface, the normalized cache-key representation
 * token (PERF-CACHE-005), the JSON:API §6 negotiation statuses
 * (JSONAPI-NEG-001/002), the path-match that keeps a page-only URL out of
 * the JSON:API namespace, and the Markdown representation (DISC-009).
 *
 * The route table a consuming application derives from its `HttpApi` groups
 * is a literal path list here (collections, `:id`, the §7.4 related-resource
 * fetches), and the Markdown segments are a fixed fixture list.
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
      site: { path: "/web-pages/:id/site" },
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

/**
 * Assert a non-read verdict (a write, `OPTIONS`, …) is a clean fall-through:
 * no dispatch, no Markdown, no §6 error. `representation` is not pinned, as
 * for {@link expectWriteDispatch}: `Negotiation` documents the token as
 * meaningful for `GET`/`HEAD` only.
 */
const expectFallthrough = (n: Negotiation): void => {
  expect(n.dispatch).toBe(false);
  expect(n.markdown ?? false).toBe(false);
  expect(n.error).toBeUndefined();
};

/** Assert a read verdict is a clean fall-through, keyed as HTML. */
const expectHtmlFallthrough = (n: Negotiation): void => {
  expectFallthrough(n);
  expect(n.representation).toBe("text/html");
};

/**
 * Assert a write verdict dispatches to the JSON:API (no Markdown, no §6
 * error). `representation` is not pinned: `Negotiation` documents the token
 * as meaningful for `GET`/`HEAD` only.
 */
const expectWriteDispatch = (n: Negotiation): void => {
  expect(n.dispatch).toBe(true);
  expect(n.markdown ?? false).toBe(false);
  expect(n.error).toBeUndefined();
};

/** Assert a read verdict dispatches to the JSON:API, keyed under its media type. */
const expectDispatch = (n: Negotiation): void => {
  expectWriteDispatch(n);
  expect(n.representation).toBe(JSONAPI_MEDIA_TYPE);
};

/** Assert a verdict serves the Markdown representation (no dispatch, no §6 error). */
const expectMarkdown = (n: Negotiation): void => {
  expect(n.dispatch).toBe(false);
  expect(n.representation).toBe(MARKDOWN_MEDIA_TYPE);
  expect(n.markdown).toBe(true);
  expect(n.error).toBeUndefined();
};

/**
 * Assert a write verdict is the given §6 refusal: no dispatch, no Markdown.
 * `representation` is not pinned, as for {@link expectWriteDispatch}. The
 * error is compared structurally: no doc comment promises that the verdict
 * carries the exported constant itself.
 */
const expectWriteRefusal = (n: Negotiation, error: NonNullable<Negotiation["error"]>): void => {
  expect(n.dispatch).toBe(false);
  expect(n.markdown ?? false).toBe(false);
  expect(n.error).toStrictEqual(error);
};

/** Assert a read verdict is the given §6 refusal, keyed as HTML. */
const expectRefusal = (n: Negotiation, error: NonNullable<Negotiation["error"]>): void => {
  expectWriteRefusal(n, error);
  expect(n.representation).toBe("text/html");
};

describe("makeApiPathMatcher / endpointPaths", () => {
  it("matches known endpoint paths", () => {
    expect(isApiPath("/posts")).toBe(true);
    expect(isApiPath("/posts/")).toBe(true);
    expect(isApiPath(`/posts/${UUID}`)).toBe(true);
    expect(isApiPath(`/notes/${UUID}`)).toBe(true);
    expect(isApiPath("/search")).toBe(true);
    // Every served endpoint family must match: a family the matcher misses
    // never dispatches, so its JSON:API requests fall through to HTML.
    expect(isApiPath("/consumption-log-entries")).toBe(true);
    expect(isApiPath(`/consumption-log-entries/${UUID}`)).toBe(true);
    expect(isApiPath("/comments")).toBe(true);
  });

  it("matches the §7.4 related-resource fetch paths", () => {
    expect(isApiPath(`/lists/${UUID}/items`)).toBe(true);
    expect(isApiPath(`/list-items/${UUID}/list`)).toBe(true);
  });

  it("matches a family under its advertised segment only", () => {
    expect(isApiPath("/web-pages")).toBe(true);
    expect(isApiPath(`/web-pages/${UUID}`)).toBe(true);
    expect(isApiPath(`/web-pages/${UUID}/site`)).toBe(true);
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
    expectDispatch(negotiate(get("/posts", JSONAPI_MEDIA_TYPE)));
  });

  it("dispatches a vnd.api+json request to a resource's self URL under its advertised segment", () => {
    expectDispatch(negotiate(get(`/web-pages/${UUID}`, JSONAPI_MEDIA_TYPE)));
  });

  it("falls through to HTML for a browser navigation Accept", () => {
    expectHtmlFallthrough(
      negotiate(get("/posts", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")),
    );
  });

  it("normalizes distinct browser Accept strings to one cache-key token", () => {
    const a = negotiate(get("/posts", "text/html,*/*;q=0.8"));
    const b = negotiate(get("/posts", "text/html,application/xml;q=0.9"));
    expectHtmlFallthrough(a);
    expectHtmlFallthrough(b);
    expect(b.representation).toBe(a.representation);
  });

  it("never matches application/json or the wildcard range", () => {
    // Neither names the JSON:API media type, so neither is a §6 refusal.
    expectHtmlFallthrough(negotiate(get("/posts", "application/json")));
    expectHtmlFallthrough(negotiate(get("/posts", "*/*")));
  });

  it("falls through to HTML when the path is not an API resource", () => {
    expectHtmlFallthrough(negotiate(get("/about", JSONAPI_MEDIA_TYPE)));
  });

  it("treats no Accept header as HTML", () => {
    expectHtmlFallthrough(negotiate(get("/posts")));
  });

  it("allows profile and a supported ext parameter (clean instance)", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x"`)));
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};ext="atomic"`)));
  });

  it("§5 (adopted from effect-jsonapi): an ext the api does not declare is not a clean instance", () => {
    // effect-jsonapi checks the `ext` URIs against `options.extensions`, per
    // the spec, so an undeclared extension is refused rather than accepted.
    expectRefusal(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};ext="https://example.com/unknown"`)),
      NOT_ACCEPTABLE,
    );
  });

  it("§6: 406 when every JSON:API instance is parameterised", () => {
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1`));
    expectRefusal(n, NOT_ACCEPTABLE);
    expect(n.error?.status).toBe(406);
    expect(NOT_ACCEPTABLE.code).toBe("not_acceptable");
  });

  it("does not 406 on a page-only path even if parameterised", () => {
    expectHtmlFallthrough(negotiate(get("/about", `${JSONAPI_MEDIA_TYPE};version=1`)));
  });

  it("loses to a higher-q competitor, wins on a tie", () => {
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5, text/html;q=0.9`)));
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE}, text/html`)));
  });

  it("treats a q=0 clean instance as a refusal (HTML), not a §6 parameterisation (406)", () => {
    const n = negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0, text/html`));
    expectHtmlFallthrough(n);
  });
});

describe("negotiateRepresentation — writes (Content-Type)", () => {
  it("dispatches a JSON:API write on an API path", () => {
    expectWriteDispatch(negotiate(write("POST", "/posts", JSONAPI_MEDIA_TYPE)));
  });

  it("dispatches a bodyless DELETE carrying the media type", () => {
    expectWriteDispatch(negotiate(write("DELETE", `/posts/${UUID}`, JSONAPI_MEDIA_TYPE)));
  });

  it("falls through for an application/json write (no 415)", () => {
    // The surface is selected by its media type (JSONAPI-NEG-001): a write
    // that does not carry it is outside the JSON:API, not refused by it. The
    // 415 is only for a JSON:API Content-Type with a disallowed parameter.
    expectFallthrough(negotiate(write("POST", "/posts", "application/json")));
  });

  it("§6: 415 when the write Content-Type carries a disallowed parameter", () => {
    const n = negotiate(write("PATCH", `/posts/${UUID}`, `${JSONAPI_MEDIA_TYPE};charset=utf-8`));
    expectWriteRefusal(n, UNSUPPORTED_MEDIA_TYPE);
    expect(n.error?.status).toBe(415);
    expect(UNSUPPORTED_MEDIA_TYPE.code).toBe("unsupported_media_type");
  });

  it("allows profile and a supported ext on a write Content-Type", () => {
    expectWriteDispatch(negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE};ext="atomic"`)));
    expectWriteDispatch(
      negotiate(write("POST", "/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x"`)),
    );
  });

  it("falls through for a JSON:API write to a non-API path", () => {
    expectFallthrough(negotiate(write("POST", "/about", JSONAPI_MEDIA_TYPE)));
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
    expectDispatch(negotiateRepresentation(read, options));
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

  it("matches a hand-built route segment that diverges from the JSON:API type", () => {
    expect(isMarkdownPath(`/consumption-log/${UUID}`)).toBe(true);
    expect(isMarkdownPath(`/consumption-log-entries/${UUID}`)).toBe(false);
  });

  it("does not match collections, non-content routes, or pages", () => {
    expect(isMarkdownPath("/posts")).toBe(false);
    expect(isMarkdownPath("/posts/")).toBe(false);
    expect(isMarkdownPath("/about")).toBe(false);
    expect(isMarkdownPath(`/posts/${UUID}/edit`)).toBe(false);
  });

  it("matches nothing while the segment list is empty (no Markdown routes yet)", () => {
    expect(makeMarkdownPathMatcher([])(`/posts/${UUID}`)).toBe(false);
  });
});

describe("Markdown negotiation (DISC-009)", () => {
  it("serves Markdown when text/markdown wins on a content detail page", () => {
    expectMarkdown(negotiate(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE)));
  });

  it("keys Markdown as its own cache representation (≤3 entries/URL)", () => {
    const html = negotiate(get(`/posts/${UUID}`, "text/html"));
    const md = negotiate(get(`/posts/${UUID}`, MARKDOWN_MEDIA_TYPE));
    const api = negotiate(get(`/posts/${UUID}`, JSONAPI_MEDIA_TYPE));
    expectHtmlFallthrough(html);
    expectMarkdown(md);
    expectDispatch(api);
    expect(new Set([html.representation, md.representation, api.representation]).size).toBe(3);
  });

  it("falls through to HTML for a browser Accept (html outranks markdown)", () => {
    const n = negotiate(get(`/posts/${UUID}`, "text/html,application/xhtml+xml,*/*;q=0.8"));
    expectHtmlFallthrough(n);
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
    expectFallthrough(negotiate(write("POST", `/posts/${UUID}`, "text/markdown")));
  });
});

describe("negotiateRepresentation — non-read, non-write methods", () => {
  it("falls through for OPTIONS even on an API path", () => {
    expectFallthrough(negotiate(new Request(`${ORIGIN}/posts`, { method: "OPTIONS" })));
  });
});

describe("quality parsing — malformed q values", () => {
  it("treats an unparseable Accept q= as the default 1 (still wins on a tie)", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=abc`)));
  });

  it("treats an unparseable markdown q= as the default 1", () => {
    expectMarkdown(negotiate(get(`/posts/${UUID}`, "text/markdown;q=xyz")));
  });
});

describe("the Accept q split is positional (RFC 9110 §12.4.2)", () => {
  it("ignores accept-extension parameters after q (;q=…;foo=bar is clean)", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.8;foo=bar`)));
    expectDispatch(
      negotiate(
        get("/posts", `${JSONAPI_MEDIA_TYPE};profile="https://x";q=0.9;foo=bar, text/html;q=0.5`),
      ),
    );
  });

  it("still 406s a disallowed media-type parameter positioned before q", () => {
    expectRefusal(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};version=1;q=0.9`)),
      NOT_ACCEPTABLE,
    );
  });

  it("reads the weight from the first q, not from what follows it", () => {
    expectHtmlFallthrough(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5;foo=bar, text/html;q=0.9`)),
    );
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0;foo=bar, text/html`)));
    expectHtmlFallthrough(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0;q=1, text/html`)));
    expectHtmlFallthrough(
      negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};q=0.5;q=1, text/html;q=0.9`)),
    );
  });

  it("tolerates whitespace and empty parts around the parameters", () => {
    expectDispatch(negotiate(get("/posts", `${JSONAPI_MEDIA_TYPE};`)));
    expectDispatch(negotiate(get("/posts", ` ${JSONAPI_MEDIA_TYPE} ; ; q=0.8 ; foo=bar`)));
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
