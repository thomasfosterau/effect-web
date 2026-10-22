/**
 * Unit tests for `UriTemplate.matcher` / `UriTemplate.match`: the
 * round-trip over the uritemplate-test suite (every case inside the
 * matchable subset), the refusals, and the reading rules.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { UriTemplate } from "@thomasfosterau/effect-uri-template";
import extendedTests from "./fixtures/uritemplate-test/extended-tests.json" with { type: "json" };
import specExamplesBySection from "./fixtures/uritemplate-test/spec-examples-by-section.json" with { type: "json" };
import specExamples from "./fixtures/uritemplate-test/spec-examples.json" with { type: "json" };

const Primitive = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
const Suite = Schema.Record(
  Schema.String,
  Schema.Struct({
    variables: Schema.Record(
      Schema.String,
      Schema.Union([
        Primitive,
        Schema.Array(Primitive),
        Schema.Record(Schema.String, Primitive),
        Schema.Null,
      ]),
    ),
    testcases: Schema.Array(
      Schema.Tuple([
        Schema.String,
        Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Literal(false)]),
      ]),
    ),
  }),
);

const template = (source: string): UriTemplate.UriTemplate =>
  Schema.decodeUnknownSync(UriTemplate.UriTemplateFromString)(source);

const matcherOf = (source: string): UriTemplate.Matcher =>
  Result.match(UriTemplate.matcher(template(source)), {
    onSuccess: (compiled) => compiled,
    onFailure: (error) => {
      throw error;
    },
  });

/** Every suite case whose template compiles for matching and whose expected expansion is one string. */
const matchable = Record.toEntries(
  Schema.decodeUnknownSync(Suite)({ ...specExamples, ...specExamplesBySection, ...extendedTests }),
).flatMap(([group, { testcases }]) =>
  testcases.flatMap(([source, expected]) => {
    const parsed = UriTemplate.parse(source);
    const compiles =
      Predicate.isString(expected) &&
      Result.isSuccess(parsed) &&
      Result.isSuccess(UriTemplate.matcher(parsed.success));
    return compiles ? [{ group, source, expected }] : [];
  }),
);

describe("UriTemplate.match — round trip over uritemplate-test", () => {
  it("covers a meaningful share of the suite", () => {
    expect(matchable.length).toBeGreaterThan(60);
  });

  it.each(matchable)("$group: $source", ({ source, expected }) => {
    const compiled = matcherOf(source);
    const recovered = UriTemplate.match(compiled, expected);
    expect(Option.isSome(recovered)).toBe(true);
    const back = Option.flatMap(recovered, (values) =>
      Result.getSuccess(UriTemplate.expand(compiled.template, values)),
    );
    expect(back).toStrictEqual(Option.some(expected));
  });
});

describe("UriTemplate.matcher refusals", () => {
  it.each([
    ["/x{var:3}", 2, "prefix"],
    ["{x,y}", 0, "several unnamed"],
    ["/a{/b,c}", 2, "several unnamed"],
    ["{;list*}", 0, "explode"],
    ["{keys*}", 0, "explode"],
    ["{x}{y}", 3, "no literal"],
    ["{x}{.ext}", 3, "no literal"],
    ["{#frag}{/x}", 7, "no literal"],
    ["{?q}/x", 0, "query expression"],
    ["{a}/{b}/{a}", 0, "used twice"],
  ] as const)("refuses %j at %i (%s)", (source, position, detail) => {
    const result = UriTemplate.matcher(template(source));
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "TemplateError",
      reason: "Unmatchable",
      position,
    });
    expect(Result.isFailure(result) && result.failure.message).toContain(detail);
  });

  it.each(["{/id}{?q}", "{x}{/y}", "{+path}{?q}", "{.a}{.b}", "{x}{#frag}"])(
    "accepts %j: its first value cannot hold the next one's lead",
    (source) => {
      expect(Result.isSuccess(UriTemplate.matcher(template(source)))).toBe(true);
    },
  );
});

describe("UriTemplate.match reading rules", () => {
  it("decodes U values, splits a raw comma into a list, and keeps + values as written", () => {
    const compiled = matcherOf("/search/{term}{/tags}/r{+rest}");
    expect(UriTemplate.match(compiled, "/search/caf%C3%A9/a,b/r/x%2Fy;z")).toStrictEqual(
      Option.some({ term: "café", tags: ["a", "b"], rest: "/x%2Fy;z" }),
    );
  });

  it("gives an exploded query variable the parameters no other variable names, as a record", () => {
    const compiled = matcherOf("/q{?id,keys*}");
    expect(UriTemplate.match(compiled, "/q?b=2&id=7&a=1")).toStrictEqual(
      Option.some({ id: "7", keys: { b: "2", a: "1" } }),
    );
  });

  it("reads query variables by name, in any order, ignoring unnamed parameters", () => {
    const compiled = matcherOf("/users{/id}{?fields*,lang}");
    expect(
      UriTemplate.match(compiled, "/users/42?utm=x&lang=en&fields=name&fields=email"),
    ).toStrictEqual(Option.some({ id: "42", lang: "en", fields: ["name", "email"] }));
    expect(UriTemplate.match(compiled, "/users")).toStrictEqual(Option.some({}));
  });

  it("reads path-style parameters by name, with an empty value for a bare name", () => {
    const compiled = matcherOf("/map{;x,y,empty}");
    expect(UriTemplate.match(compiled, "/map;x=1024;empty")).toStrictEqual(
      Option.some({ x: "1024", empty: "" }),
    );
  });

  it("reads an exploded path as a list, and a query continuation after a literal ?", () => {
    expect(UriTemplate.match(matcherOf("{/path*}"), "/a/b/c")).toStrictEqual(
      Option.some({ path: ["a", "b", "c"] }),
    );
    expect(UriTemplate.match(matcherOf("/s?fixed=1{&q}"), "/s?fixed=1&q=x")).toStrictEqual(
      Option.some({ q: "x" }),
    );
  });

  it("misses a URL that does not match, or that holds a malformed pct-encoding", () => {
    const compiled = matcherOf("/users/{id}");
    expect(UriTemplate.match(compiled, "/teams/42")).toStrictEqual(Option.none());
    expect(UriTemplate.match(compiled, "/users/a/b")).toStrictEqual(Option.none());
    expect(UriTemplate.match(compiled, "/users/%E9")).toStrictEqual(Option.none());
  });
});
