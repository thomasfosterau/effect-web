/**
 * Compile-time assertions for the template variables, the link model and
 * the well-known suffixes. Every binding is exported so an unused-local
 * error can never stand in for the assertion a directive expects.
 */
import type * as Option from "effect/Option";
import type * as Result from "effect/Result";
import { LinkHeader, UriTemplate, WellKnown } from "@thomasfosterau/effect-uri-template";

export declare const template: UriTemplate.UriTemplate;

// A value is a primitive, a list of primitives or a flat record of them.
export const expanded: Result.Result<string, UriTemplate.TemplateError> = UriTemplate.expand(
  template,
  {
    id: 1,
    list: ["a", 2, true],
    keys: { a: "b" },
    missing: undefined,
  },
);
// @ts-expect-error — a nested list is not a value
export const nested = UriTemplate.expand(template, { list: [["a"]] });
// @ts-expect-error — an object is not a list member
export const deep = UriTemplate.expand(template, { keys: { a: { b: "c" } } });

// Parsed links expose optional members as Options.
export const anchor: Option.Option<string> = LinkHeader.make("/").anchor;
// @ts-expect-error — not a link option
export const bad = LinkHeader.make("/", { relation: "next" });

// Every registered suffix is a string.
export const suffix: string = WellKnown.registeredSuffixes[0] ?? "csvm";
// @ts-expect-error — not a registered suffix
export const unregistered: WellKnown.RegisteredSuffix = "robots.txt";
