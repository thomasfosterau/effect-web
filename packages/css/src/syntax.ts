/**
 * CSS Syntax Level 3 parsing (§5): the entry points a consumer calls on
 * CSS text — a `style` attribute's declarations, a stylesheet, a single
 * rule, declaration or component value. Errors are recovered from as the
 * specification requires and reported in place as {@link SyntaxError}
 * items carrying the offset (in code points) they were found at.
 *
 * @since 0.1.0
 */
/* oxlint-disable effect/imperative-loops, effect/avoid-direct-tag-checks, effect/prefer-match-over-switch, effect/no-length-comparison, effect/prefer-arr-match -- the specification's consume-* algorithms over a token cursor, transcribed step for step: one token-type dispatch per token, on the hot path every parse takes. */
import * as Option from "effect/Option";
import { tokenize, type Located } from "./internal/tokenizer.ts";
import type { Block, ComponentValue, Func, Token } from "./token.ts";

/**
 * A declaration (`name: value !important`). `value` keeps its whitespace,
 * `!important` removed.
 *
 * @since 0.1.0
 * @category models
 */
export interface Declaration {
  readonly _tag: "Declaration";
  readonly name: string;
  readonly value: ReadonlyArray<ComponentValue>;
  readonly important: boolean;
}

/**
 * An at-rule (`@media screen { … }`, `@import "x";`): its name, prelude and
 * block contents (`None` for a statement at-rule).
 *
 * @since 0.1.0
 * @category models
 */
export interface AtRule {
  readonly _tag: "AtRule";
  readonly name: string;
  readonly prelude: ReadonlyArray<ComponentValue>;
  readonly block: Option.Option<ReadonlyArray<ComponentValue>>;
}

/**
 * A qualified rule (`div > p { … }`): its prelude and block contents.
 *
 * @since 0.1.0
 * @category models
 */
export interface QualifiedRule {
  readonly _tag: "QualifiedRule";
  readonly prelude: ReadonlyArray<ComponentValue>;
  readonly block: ReadonlyArray<ComponentValue>;
}

/**
 * A parse error the parser recovered from: `empty` (nothing to parse),
 * `invalid` (input that is not what was asked for: a declaration without a
 * colon, a rule without a block) or `extra-input` (something after the one
 * item asked for). `offset` is the code-point offset, in the preprocessed
 * input, of the token where it was found (the input length at its end).
 *
 * @since 0.1.0
 * @category models
 */
export interface SyntaxError {
  readonly _tag: "SyntaxError";
  readonly kind: "empty" | "invalid" | "extra-input";
  readonly offset: number;
}

/** A token cursor with the input's end offset for errors at EOF. */
const cursor = (input: string) => {
  const tokens = tokenize(input);
  const end = tokens.length > 0 ? (tokens.at(-1)?.offset ?? 0) + 1 : 0;
  let index = 0;
  return {
    peek: (): Token | undefined => tokens[index]?.token,
    offset: (): number => tokens[index]?.offset ?? end,
    next: (): Token | undefined => {
      const located: Located | undefined = tokens[index];
      index += 1;
      return located?.token;
    },
    back: (): void => {
      index -= 1;
    },
  };
};
type Cursor = ReturnType<typeof cursor>;

const closer = {
  OpenSquare: "CloseSquare",
  OpenParen: "CloseParen",
  OpenCurly: "CloseCurly",
} as const;
const associated = { OpenSquare: "[", OpenParen: "(", OpenCurly: "{" } as const;

/**
 * A function or simple block being consumed: what closes it, and how to
 * build it from its contents.
 */
interface Frame {
  readonly closer: "CloseSquare" | "CloseParen" | "CloseCurly";
  readonly value: Array<ComponentValue>;
  readonly build: (value: ReadonlyArray<ComponentValue>) => Func | Block;
}

/** A token that opens a function or a simple block. */
type Opener = Extract<
  Token,
  { readonly _tag: "Function" | "OpenSquare" | "OpenParen" | "OpenCurly" }
>;

const isOpener = (token: Token): token is Opener =>
  token._tag === "Function" ||
  token._tag === "OpenSquare" ||
  token._tag === "OpenParen" ||
  token._tag === "OpenCurly";

/** The frame an opening token starts. */
const frameFor = (token: Opener): Frame => {
  switch (token._tag) {
    case "OpenSquare":
    case "OpenParen":
    case "OpenCurly": {
      const open = token._tag;
      return {
        closer: closer[open],
        value: [],
        build: (value) => ({ _tag: "Block", associated: associated[open], value }),
      };
    }
    case "Function":
      return {
        closer: "CloseParen",
        value: [],
        build: (value) => ({ _tag: "Func", name: token.value, value }),
      };
  }
};

/**
 * §5.4.8 to §5.4.10: one component value, consuming a simple block or a
 * function to its closing token (or EOF). Nesting is kept on an explicit
 * stack rather than the call stack, so arbitrarily deep input such as
 * `((((…` cannot overflow it. The cursor is not at EOF.
 */
const consumeComponentValue = (input: Cursor): ComponentValue => {
  const first: Token = input.next() ?? { _tag: "Whitespace" };
  if (!isOpener(first)) return first;
  const root = frameFor(first);
  const stack: Array<Frame> = [root];
  for (;;) {
    const top = stack[stack.length - 1] ?? root;
    const token = input.next();
    if (token === undefined || token._tag === top.closer) {
      stack.pop();
      const node = top.build(top.value);
      const parent = stack[stack.length - 1];
      if (parent === undefined) return node;
      parent.value.push(node);
      continue;
    }
    if (isOpener(token)) {
      stack.push(frameFor(token));
    } else {
      top.value.push(token);
    }
  }
};

/** §5.4.9: a simple block, after its opening token. */
const consumeBlock = (input: Cursor, open: keyof typeof closer): Block => {
  input.back();
  const block = consumeComponentValue(input);
  return block._tag === "Block"
    ? block
    : { _tag: "Block", associated: associated[open], value: [] };
};

const skipWhitespace = (input: Cursor): void => {
  while (input.peek()?._tag === "Whitespace") input.next();
};

/** §5.4.2: an at-rule, after its at-keyword. */
const consumeAtRule = (input: Cursor, name: string): AtRule => {
  const prelude: Array<ComponentValue> = [];
  for (;;) {
    const token = input.next();
    if (token === undefined || token._tag === "Semicolon") {
      return { _tag: "AtRule", name, prelude, block: Option.none() };
    }
    if (token._tag === "OpenCurly") {
      return {
        _tag: "AtRule",
        name,
        prelude,
        block: Option.some(consumeBlock(input, "OpenCurly").value),
      };
    }
    input.back();
    prelude.push(consumeComponentValue(input));
  }
};

/** §5.4.3: a qualified rule, or an `invalid` error if the input ends before its block. */
const consumeQualifiedRule = (input: Cursor): QualifiedRule | SyntaxError => {
  const prelude: Array<ComponentValue> = [];
  for (;;) {
    const offset = input.offset();
    const token = input.next();
    if (token === undefined) return { _tag: "SyntaxError", kind: "invalid", offset };
    if (token._tag === "OpenCurly") {
      return { _tag: "QualifiedRule", prelude, block: consumeBlock(input, "OpenCurly").value };
    }
    input.back();
    prelude.push(consumeComponentValue(input));
  }
};

/** §5.4.1: a list of rules; CDO and CDC are skipped only at the top level. */
const consumeRules = (
  input: Cursor,
  topLevel: boolean,
): Array<AtRule | QualifiedRule | SyntaxError> => {
  const rules: Array<AtRule | QualifiedRule | SyntaxError> = [];
  for (;;) {
    const token = input.next();
    if (token === undefined) return rules;
    if (token._tag === "Whitespace") continue;
    if (topLevel && (token._tag === "CDO" || token._tag === "CDC")) continue;
    if (token._tag === "AtKeyword") {
      rules.push(consumeAtRule(input, token.value));
    } else {
      input.back();
      rules.push(consumeQualifiedRule(input));
    }
  }
};

const isImportantIdent = (value: ComponentValue | undefined): boolean =>
  value?._tag === "Ident" && value.value.replace(/[A-Z]/g, (c) => c.toLowerCase()) === "important";

/** §5.4.6: a declaration from an ident and the component values after it. */
const consumeDeclaration = (
  name: string,
  rest: ReadonlyArray<ComponentValue>,
): Option.Option<Declaration> => {
  let index = 0;
  while (rest[index]?._tag === "Whitespace") index += 1;
  if (rest[index]?._tag !== "Colon") return Option.none();
  const value = rest.slice(index + 1);
  const significant = value
    .map((component, at) => [component, at] as const)
    .filter(([component]) => component._tag !== "Whitespace");
  const last = significant.at(-1);
  const beforeLast = significant.at(-2);
  if (
    last !== undefined &&
    beforeLast !== undefined &&
    isImportantIdent(last[0]) &&
    beforeLast[0]._tag === "Delim" &&
    beforeLast[0].value === "!"
  ) {
    return Option.some({
      _tag: "Declaration",
      name,
      value: value.slice(0, beforeLast[1]),
      important: true,
    });
  }
  return Option.some({ _tag: "Declaration", name, value, important: false });
};

/** Component values up to (not including) the next `;` or EOF. */
const consumeUntilSemicolon = (input: Cursor): Array<ComponentValue> => {
  const values: Array<ComponentValue> = [];
  while (input.peek() !== undefined && input.peek()?._tag !== "Semicolon") {
    values.push(consumeComponentValue(input));
  }
  return values;
};

/**
 * Parses a list of declarations (§5.3.8): what a `style` attribute holds.
 * At-rules are kept; a malformed declaration becomes an `invalid`
 * {@link SyntaxError} and parsing resumes after the next `;`.
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * const [color] = Syntax.parseDeclarationList("color: red !important; margin: 0")
 * console.log(color?._tag === "Declaration" && color.important) // true
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseDeclarationList = (
  css: string,
): ReadonlyArray<Declaration | AtRule | SyntaxError> => {
  const input = cursor(css);
  const items: Array<Declaration | AtRule | SyntaxError> = [];
  for (;;) {
    const offset = input.offset();
    const token = input.next();
    if (token === undefined) return items;
    if (token._tag === "Whitespace" || token._tag === "Semicolon") continue;
    if (token._tag === "AtKeyword") {
      items.push(consumeAtRule(input, token.value));
    } else if (token._tag === "Ident") {
      const declaration = consumeDeclaration(token.value, consumeUntilSemicolon(input));
      items.push(
        Option.getOrElse(declaration, (): SyntaxError => ({
          _tag: "SyntaxError",
          kind: "invalid",
          offset,
        })),
      );
    } else {
      input.back();
      consumeUntilSemicolon(input);
      items.push({ _tag: "SyntaxError", kind: "invalid", offset });
    }
  }
};

/**
 * Parses one declaration (§5.3.6): `empty` for blank input, `invalid` for
 * anything that is not `ident: …`. The value runs to the end of the input.
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * const parsed = Syntax.parseDeclaration("width: 10px")
 * console.log(parsed._tag === "Declaration" && parsed.name) // "width"
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseDeclaration = (css: string): Declaration | SyntaxError => {
  const input = cursor(css);
  skipWhitespace(input);
  const offset = input.offset();
  const token = input.next();
  if (token === undefined) return { _tag: "SyntaxError", kind: "empty", offset };
  const invalid: SyntaxError = { _tag: "SyntaxError", kind: "invalid", offset };
  if (token._tag !== "Ident") return invalid;
  const rest: Array<ComponentValue> = [];
  while (input.peek() !== undefined) rest.push(consumeComponentValue(input));
  return Option.getOrElse(consumeDeclaration(token.value, rest), () => invalid);
};

/**
 * Parses a stylesheet (§5.3.3): its top-level rules, with `<!--` and `-->`
 * skipped between them.
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * const rules = Syntax.parseStylesheet("p { color: red } @media print { p { color: black } }")
 * console.log(rules.map((rule) => rule._tag)) // ["QualifiedRule", "AtRule"]
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseStylesheet = (css: string): ReadonlyArray<AtRule | QualifiedRule | SyntaxError> =>
  consumeRules(cursor(css), true);

/**
 * Parses a list of rules (§5.3.4): as {@link parseStylesheet}, but `<!--`
 * and `-->` are ordinary tokens (the contents of an at-rule's block).
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * console.log(Syntax.parseRuleList("a {} b {}").length) // 2
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseRuleList = (css: string): ReadonlyArray<AtRule | QualifiedRule | SyntaxError> =>
  consumeRules(cursor(css), false);

/**
 * Parses exactly one rule (§5.3.5), with whitespace around it.
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * console.log(Syntax.parseRule("@import 'a.css';")._tag) // "AtRule"
 * console.log(Syntax.parseRule("a {} b {}")._tag) // "SyntaxError"
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseRule = (css: string): AtRule | QualifiedRule | SyntaxError => {
  const input = cursor(css);
  skipWhitespace(input);
  const offset = input.offset();
  const token = input.next();
  if (token === undefined) return { _tag: "SyntaxError", kind: "empty", offset };
  let rule: AtRule | QualifiedRule | SyntaxError;
  if (token._tag === "AtKeyword") {
    rule = consumeAtRule(input, token.value);
  } else {
    input.back();
    rule = consumeQualifiedRule(input);
  }
  if (rule._tag === "SyntaxError") return { ...rule, offset };
  skipWhitespace(input);
  return input.peek() === undefined
    ? rule
    : { _tag: "SyntaxError", kind: "extra-input", offset: input.offset() };
};

/**
 * Parses a list of component values (§5.3.10): the whole input, tokenized
 * and nested into functions and blocks.
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * const [value] = Syntax.parseComponentValueList("rgb(0 0 0)")
 * console.log(value?._tag === "Func" && value.name) // "rgb"
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseComponentValueList = (css: string): ReadonlyArray<ComponentValue> => {
  const input = cursor(css);
  const values: Array<ComponentValue> = [];
  while (input.peek() !== undefined) values.push(consumeComponentValue(input));
  return values;
};

/**
 * Parses exactly one component value (§5.3.9), with whitespace around it.
 *
 * @example
 * ```ts
 * import { Syntax } from "@thomasfosterau/effect-css"
 *
 * console.log(Syntax.parseComponentValue(" 4px ")._tag) // "Dimension"
 * ```
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseComponentValue = (css: string): ComponentValue | SyntaxError => {
  const input = cursor(css);
  skipWhitespace(input);
  const offset = input.offset();
  if (input.peek() === undefined) return { _tag: "SyntaxError", kind: "empty", offset };
  const value = consumeComponentValue(input);
  skipWhitespace(input);
  return input.peek() === undefined
    ? value
    : { _tag: "SyntaxError", kind: "extra-input", offset: input.offset() };
};
