/**
 * Unit tests for `LinkHeader`: the RFC 8288 §3.5 examples, the Appendix B
 * parsing rules, serialising and the `rel` queries.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { LinkHeader } from "@thomasfosterau/effect-uri-template";

describe("LinkHeader.parse — RFC 8288 §3.5", () => {
  it("reads a target, rel and title", () => {
    const [link] = LinkHeader.parse(
      '<http://example.com/TheBook/chapter2>; rel="previous"; title="previous chapter"',
    );
    expect(link).toStrictEqual(
      LinkHeader.make("http://example.com/TheBook/chapter2", {
        rel: "previous",
        title: "previous chapter",
      }),
    );
  });

  it("keeps an extension relation type as written, resolving the target against a base", () => {
    const [link] = LinkHeader.parse('</>; rel="http://example.net/foo"', "https://example.org/a/b");
    expect(link?.target).toBe("https://example.org/");
    expect(link?.rel).toStrictEqual(["http://example.net/foo"]);
  });

  it("resolves an anchor like the target", () => {
    const [link] = LinkHeader.parse(
      '</terms>; rel="copyright"; anchor="#foo"',
      "https://example.org/doc",
    );
    expect(link?.anchor).toStrictEqual(Option.some("https://example.org/doc#foo"));
    expect(link?.target).toBe("https://example.org/terms");
  });

  it("decodes title* (RFC 8187), with its language, across several link-values", () => {
    const links = LinkHeader.parse(
      "</TheBook/chapter2>; rel=\"previous\"; title*=UTF-8'de'letztes%20Kapitel, </TheBook/chapter4>; rel=\"next\"; title*=UTF-8'de'n%c3%a4chstes%20Kapitel",
    );
    expect(links.map((link) => [link.target, link.rel, link.titleStar])).toStrictEqual([
      [
        "/TheBook/chapter2",
        ["previous"],
        Option.some({ value: "letztes Kapitel", language: Option.some("de") }),
      ],
      [
        "/TheBook/chapter4",
        ["next"],
        Option.some({ value: "nächstes Kapitel", language: Option.some("de") }),
      ],
    ]);
  });

  it("splits several relation types", () => {
    const [link] = LinkHeader.parse(
      '<http://example.org/>; rel="start http://example.net/relation/other"',
    );
    expect(link?.rel).toStrictEqual(["start", "http://example.net/relation/other"]);
  });
});

describe("LinkHeader.parse — Appendix B", () => {
  it("keeps the first rel, type, media and title; every hreflang; other params in order", () => {
    const [link] = LinkHeader.parse(
      '<a>; REL=Next; rel=prev; type=text/html; type=text/plain; hreflang=en; hreflang="de"; title="a, b; c"; title="x"; foo=bar; baz',
    );
    expect(link).toStrictEqual(
      LinkHeader.make("a", {
        rel: "next",
        type: "text/html",
        hreflang: ["en", "de"],
        title: "a, b; c",
        params: [
          ["foo", "bar"],
          ["baz", ""],
        ],
      }),
    );
  });

  it("unescapes quoted strings and skips malformed link-values", () => {
    const links = LinkHeader.parse('junk, <a>; title="say \\"hi\\"", not a link, <b>');
    expect(links.map((link) => [link.target, link.title])).toStrictEqual([
      ["a", Option.some('say "hi"')],
      ["b", Option.none()],
    ]);
    expect(LinkHeader.parse("")).toStrictEqual([]);
  });

  it("reads ISO-8859-1 extended values, and ignores an unknown charset or bad encoding", () => {
    const [latin, unknown, broken] = LinkHeader.parse(
      "<a>; title*=iso-8859-1''caf%E9, <b>; title*=UTF-16''x, <c>; title*=UTF-8''%E9",
    );
    expect(latin?.titleStar).toStrictEqual(Option.some({ value: "café", language: Option.none() }));
    expect(unknown?.titleStar).toStrictEqual(Option.none());
    expect(broken?.titleStar).toStrictEqual(Option.none());
  });

  it("leaves a relative target as written without a base", () => {
    expect(LinkHeader.parse("<../up>; rel=up")[0]?.target).toBe("../up");
  });
});

describe("LinkHeader.serialize", () => {
  it("quotes what is not a token and writes title* as UTF-8", () => {
    expect(
      LinkHeader.serialize([
        LinkHeader.make("https://example.org/?page=2", { rel: "next" }),
        LinkHeader.make("/", {
          rel: ["first", "prev"],
          anchor: "#top",
          type: "text/html",
          hreflang: ["en"],
          media: "screen, print",
          title: 'the "start"',
          titleStar: { value: "€ rates", language: Option.some("en") },
          params: [["x-custom", "a b"]],
        }),
      ]),
    ).toBe(
      '<https://example.org/?page=2>; rel=next, </>; rel="first prev"; anchor="#top"; type="text/html"; media="screen, print"; hreflang=en; title="the \\"start\\""; title*=UTF-8\'en\'%E2%82%AC%20rates; x-custom="a b"',
    );
  });

  it("round-trips through parse", () => {
    const header = '</a>; rel="describedby"; type="application/csvm+json", </b>; rel=next';
    const links = LinkHeader.parse(header);
    expect(LinkHeader.parse(LinkHeader.serialize(links))).toStrictEqual(links);
  });
});

describe("LinkHeader rel queries", () => {
  const links = LinkHeader.parse(
    '<meta.json>; rel="describedby", <a.fr.html>; rel=alternate; hreflang=fr, <a.de.html>; rel="Alternate"; hreflang=de',
  );

  it("finds the first link with a relation type, ignoring case for registered types", () => {
    expect(
      Option.map(LinkHeader.findRel(links, "DescribedBy"), (link) => link.target),
    ).toStrictEqual(Option.some("meta.json"));
    expect(LinkHeader.findRel(links, "next")).toStrictEqual(Option.none());
    expect(LinkHeader.filterRel(links, "alternate").map((link) => link.hreflang)).toStrictEqual([
      ["fr"],
      ["de"],
    ]);
  });

  it("compares an extension relation type exactly", () => {
    const [link] = LinkHeader.parse('<a>; rel="http://example.net/Rel"');
    expect(link !== undefined && LinkHeader.hasRel(link, "http://example.net/Rel")).toBe(true);
    expect(link !== undefined && LinkHeader.hasRel(link, "http://example.net/rel")).toBe(false);
  });
});

describe("LinkHeader.LinkHeaderFromString", () => {
  it("decodes and encodes a header value", () => {
    const links = Schema.decodeUnknownSync(LinkHeader.LinkHeaderFromString)(
      '<https://example.org/>; rel="up"',
    );
    expect(links[0]?.rel).toStrictEqual(["up"]);
    expect(Schema.encodeSync(LinkHeader.LinkHeaderFromString)(links)).toBe(
      "<https://example.org/>; rel=up",
    );
  });
});
