/**
 * Unit tests for `UriTemplate`: the uritemplate-test conformance suite
 * (`tests/fixtures/uritemplate-test`, Apache-2.0) — the RFC 6570 examples,
 * the extended tests and the negative tests — plus the parse positions,
 * `variables` and the schema.
 */

import { describe, expect, it } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { UriTemplate } from "@thomasfosterau/effect-uri-template";
import extendedTests from "./fixtures/uritemplate-test/extended-tests.json" with { type: "json" };
import negativeTests from "./fixtures/uritemplate-test/negative-tests.json" with { type: "json" };
import specExamplesBySection from "./fixtures/uritemplate-test/spec-examples-by-section.json" with { type: "json" };
import specExamples from "./fixtures/uritemplate-test/spec-examples.json" with { type: "json" };

/** The suite's JSON: groups of variables and `[template, expected]` cases. */
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
    // A string, any of several strings (an associative array's order is
    // free), or `false`: the template must fail.
    testcases: Schema.Array(
      Schema.Tuple([
        Schema.String,
        Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Literal(false)]),
      ]),
    ),
  }),
);

/** A template that must parse. */
const template = (source: string): UriTemplate.UriTemplate =>
  Schema.decodeUnknownSync(UriTemplate.UriTemplateFromString)(source);

/** Parses then expands: the expansion, or `false` when either step fails. */
const outcome = (template: string, variables: UriTemplate.Variables): string | false =>
  Result.match(
    Result.flatMap(UriTemplate.parse(template), (parsed) => UriTemplate.expand(parsed, variables)),
    { onSuccess: (expanded) => expanded, onFailure: () => false },
  );

const cases = (suite: unknown) =>
  Record.toEntries(Schema.decodeUnknownSync(Suite)(suite)).flatMap(
    ([group, { variables, testcases }]) =>
      testcases.map(([template, expected]) => ({
        group,
        template,
        acceptable: expected === false || Predicate.isString(expected) ? [expected] : expected,
        variables,
      })),
  );

describe.each([
  ["spec-examples.json", specExamples],
  ["spec-examples-by-section.json", specExamplesBySection],
  ["extended-tests.json", extendedTests],
  ["negative-tests.json", negativeTests],
] as const)("uritemplate-test %s", (_, suite) => {
  it.each(cases(suite))("$group: $template", ({ template, acceptable, variables }) => {
    expect(acceptable).toContain(outcome(template, variables));
  });
});

describe("UriTemplate.parse", () => {
  it.each([
    ["/search{?q", "UnmatchedBrace", 7],
    ["/search}", "UnmatchedBrace", 7],
    ["/a b{x}", "InvalidLiteral", 2],
    ["/100%{x}", "InvalidLiteral", 4],
    ["{x}{!y}", "ReservedOperator", 4],
    ["{x,y z}", "InvalidVariable", 3],
    ["{?a,b,}", "InvalidVariable", 6],
    ["{var:0}", "InvalidVariable", 1],
  ] as const)("rejects %j with %s at %i", (template, reason, position) => {
    const result = UriTemplate.parse(template);
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: "TemplateError",
      reason,
      position,
    });
  });

  it("splits a template into literals and expressions", () => {
    const parsed = template("/u{/id}{?f*,n:3}");
    expect(parsed.source).toBe("/u{/id}{?f*,n:3}");
    expect(parsed.parts.map((part) => part._tag)).toStrictEqual([
      "Literal",
      "Expression",
      "Expression",
    ]);
    expect(parsed.parts[2]).toMatchObject({
      operator: "?",
      position: 7,
      variables: [
        { name: "f", explode: true },
        { name: "n", explode: false },
      ],
    });
  });

  it("fails PrefixOnComposite at expansion, at the expression", () => {
    const parsed = template("/x{list:2}");
    const expanded = UriTemplate.expand(parsed, { list: ["a", "b"] });
    expect(Result.isFailure(expanded) && expanded.failure).toMatchObject({
      reason: "PrefixOnComposite",
      position: 2,
    });
  });
});

describe("UriTemplate.variables", () => {
  it("lists each variable once, in order of first use", () => {
    const parsed = template("{a}/{+b,a}{?c*,b}x");
    expect(UriTemplate.variables(parsed)).toStrictEqual(["a", "b", "c"]);
  });
});

describe("UriTemplate.expand", () => {
  it("stringifies numbers and booleans, and treats null and undefined as undefined", () => {
    const parsed = template("{?n,b,none,missing}");
    expect(UriTemplate.expand(parsed, { n: 1.5, b: false, none: null })).toStrictEqual(
      Result.succeed("?n=1.5&b=false"),
    );
  });

  it("pct-encodes literal characters a URI cannot hold", () => {
    const parsed = template("/café/{x}");
    expect(UriTemplate.expand(parsed, { x: "ü" })).toStrictEqual(
      Result.succeed("/caf%C3%A9/%C3%BC"),
    );
  });
});

describe("UriTemplate.UriTemplateFromString", () => {
  it("decodes a template, fails on a malformed one, and encodes the source", () => {
    const decoded = Schema.decodeUnknownSync(UriTemplate.UriTemplateFromString)("{/path*}");
    expect(decoded.parts).toHaveLength(1);
    expect(Schema.encodeSync(UriTemplate.UriTemplateFromString)(decoded)).toBe("{/path*}");
    expect(() => Schema.decodeUnknownSync(UriTemplate.UriTemplateFromString)("{/path*")).toThrow(
      /UnmatchedBrace|unmatched/,
    );
  });
});
