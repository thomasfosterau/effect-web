/**
 * The tokens and component values of CSS Syntax Level 3 (§4, §5): what the
 * tokenizer produces and what the parser nests into functions and blocks.
 *
 * @since 0.1.0
 */

/**
 * A numeric token's payload: the value, its source representation
 * (`"12.0"`, `"+.5"`) and whether it was written as an integer.
 *
 * @since 0.1.0
 * @category models
 */
export interface NumericValue {
  readonly value: number;
  readonly representation: string;
  readonly isInteger: boolean;
}

/**
 * A token (§4). `Function` is a function-token (`name(`); the parser turns
 * it into a {@link Func}. The attribute matchers (`~=`, `|=`, `^=`, `$=`,
 * `*=`), `||` and `UnicodeRange` are the 2014 edition's tokens, kept
 * because the css-parsing-tests suite expects them. A `String` or `Url`
 * the input ended inside is `unterminated` (a parse error the tokenizer
 * recovered from).
 *
 * @since 0.1.0
 * @category models
 */
export type Token =
  | { readonly _tag: "Ident"; readonly value: string }
  | { readonly _tag: "Function"; readonly value: string }
  | { readonly _tag: "AtKeyword"; readonly value: string }
  | { readonly _tag: "Hash"; readonly value: string; readonly type: "id" | "unrestricted" }
  | { readonly _tag: "String"; readonly value: string; readonly unterminated: boolean }
  | { readonly _tag: "BadString" }
  | { readonly _tag: "Url"; readonly value: string; readonly unterminated: boolean }
  | { readonly _tag: "BadUrl" }
  | { readonly _tag: "Delim"; readonly value: string }
  | ({ readonly _tag: "Number" } & NumericValue)
  | ({ readonly _tag: "Percentage" } & NumericValue)
  | ({ readonly _tag: "Dimension"; readonly unit: string } & NumericValue)
  | { readonly _tag: "UnicodeRange"; readonly start: number; readonly end: number }
  | { readonly _tag: "Whitespace" }
  | { readonly _tag: "CDO" }
  | { readonly _tag: "CDC" }
  | { readonly _tag: "Colon" }
  | { readonly _tag: "Semicolon" }
  | { readonly _tag: "Comma" }
  | { readonly _tag: "IncludeMatch" }
  | { readonly _tag: "DashMatch" }
  | { readonly _tag: "PrefixMatch" }
  | { readonly _tag: "SuffixMatch" }
  | { readonly _tag: "SubstringMatch" }
  | { readonly _tag: "Column" }
  | { readonly _tag: "OpenSquare" }
  | { readonly _tag: "CloseSquare" }
  | { readonly _tag: "OpenParen" }
  | { readonly _tag: "CloseParen" }
  | { readonly _tag: "OpenCurly" }
  | { readonly _tag: "CloseCurly" };

/**
 * A function: its name and the component values between `name(` and `)`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Func {
  readonly _tag: "Func";
  readonly name: string;
  readonly value: ReadonlyArray<ComponentValue>;
}

/**
 * A simple block: `[…]`, `(…)` or `{…}`, by its opening token.
 *
 * @since 0.1.0
 * @category models
 */
export interface Block {
  readonly _tag: "Block";
  readonly associated: "[" | "(" | "{";
  readonly value: ReadonlyArray<ComponentValue>;
}

/**
 * A component value (§5): a preserved token (any token but a
 * function-token, `[`, `(` or `{`), a function or a simple block. An
 * unmatched `]`, `)` or `}` stays in the list as its token.
 *
 * @since 0.1.0
 * @category models
 */
export type ComponentValue =
  | Exclude<Token, { readonly _tag: "Function" | "OpenSquare" | "OpenParen" | "OpenCurly" }>
  | Func
  | Block;
