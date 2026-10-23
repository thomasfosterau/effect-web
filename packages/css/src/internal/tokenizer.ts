/**
 * The CSS Syntax Level 3 tokenizer (§3.3 preprocessing, §4 tokenization),
 * transcribed from the specification as a code-point cursor. It follows
 * the edition css-parsing-tests checks (the 2021 candidate recommendation
 * plus the `unicode-range` and attribute-matcher tokens of the 2014 one).
 */
/* oxlint-disable effect/imperative-loops, effect/no-length-comparison, effect/prefer-arr-match, effect/prefer-match-over-switch, effect/no-known-value-widening -- a transcription of the specification's tokenizer state machine: a cursor over code points, consumed one at a time, is the algorithm as written. */
import * as Str from "effect/String";
import type { Token } from "../token.ts";

/** A token and the code-point offset in the preprocessed input it starts at. */
export interface Located {
  readonly token: Token;
  readonly offset: number;
}

const LF = 0x0a;
const EOF = -1;

/** §3.3: CR, FF and CRLF become LF; NUL and lone surrogates become U+FFFD. */
const preprocess = (input: string): ReadonlyArray<number> => {
  const out: Array<number> = [];
  const points = Array.from(input, (char) => char.codePointAt(0) ?? 0xfffd);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index] ?? 0;
    if (point === 0x0d) {
      out.push(LF);
      if (points[index + 1] === LF) index += 1;
    } else if (point === 0x0c) {
      out.push(LF);
    } else if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) {
      out.push(0xfffd);
    } else {
      out.push(point);
    }
  }
  return out;
};

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isHex = (c: number): boolean =>
  isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isNameStart = (c: number): boolean => isLetter(c) || c >= 0x80 || c === 0x5f;
const isName = (c: number): boolean => isNameStart(c) || isDigit(c) || c === 0x2d;
const isWhitespace = (c: number): boolean => c === LF || c === 0x09 || c === 0x20;
const isNonPrintable = (c: number): boolean =>
  (c >= 0 && c <= 0x08) || c === 0x0b || (c >= 0x0e && c <= 0x1f) || c === 0x7f;

/** §4.3.8: whether two code points start a valid escape. */
const isValidEscape = (first: number, second: number): boolean => first === 0x5c && second !== LF;

/** §4.3.9: whether three code points would start an ident sequence. */
const startsIdent = (first: number, second: number, third: number): boolean => {
  if (first === 0x2d) return isNameStart(second) || second === 0x2d || isValidEscape(second, third);
  if (isNameStart(first)) return true;
  if (first === 0x5c) return isValidEscape(first, second);
  return false;
};

/** §4.3.10: whether three code points would start a number. */
const startsNumber = (first: number, second: number, third: number): boolean => {
  if (first === 0x2b || first === 0x2d) {
    return isDigit(second) || (second === 0x2e && isDigit(third));
  }
  if (first === 0x2e) return isDigit(second);
  return isDigit(first);
};

/** Tokenizes CSS text into tokens with their offsets, ending before EOF. */
export const tokenize = (text: string): ReadonlyArray<Located> => {
  const input = preprocess(text);
  let position = 0;
  const at = (offset: number): number => input[position + offset] ?? EOF;
  const next = (): number => {
    const point = input[position] ?? EOF;
    position += 1;
    return point;
  };

  /** §4.3.7: an escaped code point, after the backslash. */
  const consumeEscaped = (): number => {
    const first = next();
    if (first === EOF) return 0xfffd;
    if (!isHex(first)) return first;
    let hex = String.fromCodePoint(first);
    while (hex.length < 6 && isHex(at(0))) hex += String.fromCodePoint(next());
    if (isWhitespace(at(0))) next();
    const value = Number.parseInt(hex, 16);
    return value === 0 || (value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff ? 0xfffd : value;
  };

  /** §4.3.11: a name (ident sequence). */
  const consumeName = (): string => {
    let name = "";
    for (;;) {
      const point = at(0);
      if (isName(point)) {
        name += String.fromCodePoint(next());
      } else if (isValidEscape(point, at(1))) {
        next();
        name += String.fromCodePoint(consumeEscaped());
      } else {
        return name;
      }
    }
  };

  /** The run of digits at the cursor. */
  const consumeDigits = (): string => {
    let digits = "";
    while (isDigit(at(0))) digits += String.fromCodePoint(next());
    return digits;
  };

  /** Whether an exponent (`e`, an optional sign, a digit) starts at the cursor. */
  const startsExponent = (): boolean =>
    (at(0) === 0x45 || at(0) === 0x65) &&
    (isDigit(at(1)) || ((at(1) === 0x2b || at(1) === 0x2d) && isDigit(at(2))));

  /** A fraction or an exponent: its two leading code points, then digits. */
  const consumeTail = (): string => String.fromCodePoint(next(), next()) + consumeDigits();

  /** §4.3.12: a number's representation, value and type. */
  const consumeNumber = () => {
    const sign = at(0) === 0x2b || at(0) === 0x2d ? String.fromCodePoint(next()) : "";
    const integer = sign + consumeDigits();
    const fraction = at(0) === 0x2e && isDigit(at(1)) ? consumeTail() : "";
    const exponent = startsExponent() ? consumeTail() : "";
    const representation = integer + fraction + exponent;
    return {
      representation,
      value: Number(representation),
      isInteger: Str.isEmpty(fraction) && Str.isEmpty(exponent),
    };
  };

  /** §4.3.3: a number, percentage or dimension. */
  const consumeNumeric = (): Token => {
    const number = consumeNumber();
    if (startsIdent(at(0), at(1), at(2))) {
      return { _tag: "Dimension", ...number, unit: consumeName() };
    }
    if (at(0) === 0x25) {
      next();
      return { _tag: "Percentage", ...number };
    }
    return { _tag: "Number", ...number };
  };

  /** §4.3.14: the remnants of a bad URL. */
  const consumeBadUrlRemnants = (): void => {
    for (;;) {
      const point = next();
      if (point === 0x29 || point === EOF) return;
      if (isValidEscape(point, at(0))) consumeEscaped();
    }
  };

  const badUrl = (): Token => {
    consumeBadUrlRemnants();
    return { _tag: "BadUrl" };
  };

  /** Whether a code point inside an unquoted URL makes it a bad URL. */
  const isBadUrlPoint = (point: number): boolean =>
    point === 0x22 || point === 0x27 || point === 0x28 || isNonPrintable(point);

  /** Whitespace inside a URL: only `)` or the end may follow it. */
  const consumeUrlWhitespace = (value: string): Token => {
    while (isWhitespace(at(0))) next();
    if (at(0) === 0x29 || at(0) === EOF) {
      return { _tag: "Url", value, unterminated: next() === EOF };
    }
    return badUrl();
  };

  /** §4.3.6: a URL token, after `url(` and its whitespace. */
  const consumeUrl = (): Token => {
    let value = "";
    while (isWhitespace(at(0))) next();
    for (;;) {
      const point = next();
      if (point === 0x29) return { _tag: "Url", value, unterminated: false };
      if (point === EOF) return { _tag: "Url", value, unterminated: true };
      if (isWhitespace(point)) return consumeUrlWhitespace(value);
      if (isBadUrlPoint(point)) return badUrl();
      if (point === 0x5c && !isValidEscape(point, at(0))) return badUrl();
      value += String.fromCodePoint(point === 0x5c ? consumeEscaped() : point);
    }
  };

  /** §4.3.4: an ident, function, URL or bad URL. */
  const consumeIdentLike = (): Token => {
    const name = consumeName();
    if (name.toLowerCase() === "url" && at(0) === 0x28) {
      next();
      while (isWhitespace(at(0)) && isWhitespace(at(1))) next();
      const quote = (c: number) => c === 0x22 || c === 0x27;
      if (quote(at(0)) || (isWhitespace(at(0)) && quote(at(1)))) {
        return { _tag: "Function", value: name };
      }
      return consumeUrl();
    }
    if (at(0) === 0x28) {
      next();
      return { _tag: "Function", value: name };
    }
    return { _tag: "Ident", value: name };
  };

  /** A backslash inside a string, after it: the code points it adds. */
  const consumeStringEscape = (): string => {
    if (at(0) === EOF) return "";
    if (at(0) === LF) {
      next();
      return "";
    }
    return String.fromCodePoint(consumeEscaped());
  };

  /** §4.3.5: a string, after its opening quote. */
  const consumeString = (ending: number): Token => {
    let value = "";
    for (;;) {
      const point = next();
      if (point === ending) return { _tag: "String", value, unterminated: false };
      if (point === EOF) return { _tag: "String", value, unterminated: true };
      if (point === LF) {
        position -= 1;
        return { _tag: "BadString" };
      }
      value += point === 0x5c ? consumeStringEscape() : String.fromCodePoint(point);
    }
  };

  /** The 2014 edition's unicode-range token, after `U+`. */
  const consumeUnicodeRange = (): Token => {
    let digits = "";
    while (digits.length < 6 && isHex(at(0))) digits += String.fromCodePoint(next());
    let wildcards = 0;
    while (digits.length + wildcards < 6 && at(0) === 0x3f) {
      next();
      wildcards += 1;
    }
    if (wildcards > 0) {
      return {
        _tag: "UnicodeRange",
        start: Number.parseInt(digits + "0".repeat(wildcards), 16),
        end: Number.parseInt(digits + "F".repeat(wildcards), 16),
      };
    }
    const start = Number.parseInt(digits, 16);
    if (at(0) === 0x2d && isHex(at(1))) {
      next();
      let endDigits = "";
      while (endDigits.length < 6 && isHex(at(0))) endDigits += String.fromCodePoint(next());
      return { _tag: "UnicodeRange", start, end: Number.parseInt(endDigits, 16) };
    }
    return { _tag: "UnicodeRange", start, end: start };
  };

  const delim = (point: number): Token => ({ _tag: "Delim", value: String.fromCodePoint(point) });

  /** `token`, if the next code point is `=` (consumed), else a delim for `point`. */
  const matcher =
    (tag: "IncludeMatch" | "DashMatch" | "PrefixMatch" | "SuffixMatch" | "SubstringMatch") =>
    (point: number): Token => {
      if (at(0) !== 0x3d) return delim(point);
      next();
      return { _tag: tag };
    };

  /** A number if one starts at `point`, else a delim. */
  const numberOrDelim = (point: number): Token => {
    if (!startsNumber(point, at(0), at(1))) return delim(point);
    position -= 1;
    return consumeNumeric();
  };

  const fixed = (token: Token) => (): Token => token;

  /** §4.3.1's per-code-point rules, after the code point is consumed. */
  const RULES: Readonly<Record<number, (point: number) => Token>> = {
    0x22: consumeString,
    0x27: consumeString,
    0x23: (point) => {
      if (!isName(at(0)) && !isValidEscape(at(0), at(1))) return delim(point);
      const type = startsIdent(at(0), at(1), at(2)) ? "id" : "unrestricted";
      return { _tag: "Hash", value: consumeName(), type };
    },
    0x24: matcher("SuffixMatch"),
    0x28: fixed({ _tag: "OpenParen" }),
    0x29: fixed({ _tag: "CloseParen" }),
    0x2a: matcher("SubstringMatch"),
    0x2b: numberOrDelim,
    0x2e: numberOrDelim,
    0x2c: fixed({ _tag: "Comma" }),
    0x2d: (point) => {
      if (startsNumber(point, at(0), at(1))) return numberOrDelim(point);
      if (at(0) === 0x2d && at(1) === 0x3e) {
        position += 2;
        return { _tag: "CDC" };
      }
      if (!startsIdent(point, at(0), at(1))) return delim(point);
      position -= 1;
      return consumeIdentLike();
    },
    0x3a: fixed({ _tag: "Colon" }),
    0x3b: fixed({ _tag: "Semicolon" }),
    0x3c: (point) => {
      if (at(0) !== 0x21 || at(1) !== 0x2d || at(2) !== 0x2d) return delim(point);
      position += 3;
      return { _tag: "CDO" };
    },
    0x40: (point) =>
      startsIdent(at(0), at(1), at(2)) ? { _tag: "AtKeyword", value: consumeName() } : delim(point),
    0x5b: fixed({ _tag: "OpenSquare" }),
    0x5c: (point) => {
      if (!isValidEscape(point, at(0))) return delim(point);
      position -= 1;
      return consumeIdentLike();
    },
    0x5d: fixed({ _tag: "CloseSquare" }),
    0x5e: matcher("PrefixMatch"),
    0x7b: fixed({ _tag: "OpenCurly" }),
    0x7d: fixed({ _tag: "CloseCurly" }),
    0x7c: (point) => {
      if (at(0) === 0x7c) {
        next();
        return { _tag: "Column" };
      }
      return matcher("DashMatch")(point);
    },
    0x7e: matcher("IncludeMatch"),
  };

  /** The rules for a code point with no entry in {@link RULES}. */
  const consumeOther = (point: number): Token => {
    if (isWhitespace(point)) {
      while (isWhitespace(at(0))) next();
      return { _tag: "Whitespace" };
    }
    if (isDigit(point)) return numberOrDelim(point);
    if ((point === 0x55 || point === 0x75) && at(0) === 0x2b && (isHex(at(1)) || at(1) === 0x3f)) {
      next();
      return consumeUnicodeRange();
    }
    if (!isNameStart(point)) return delim(point);
    position -= 1;
    return consumeIdentLike();
  };

  /** §4.3.1: one token. */
  const consumeToken = (point: number): Token => (RULES[point] ?? consumeOther)(point);

  const tokens: Array<Located> = [];
  for (;;) {
    // §4.3.2: comments produce no token.
    while (at(0) === 0x2f && at(1) === 0x2a) {
      position += 2;
      while (at(0) !== EOF && !(at(0) === 0x2a && at(1) === 0x2f)) position += 1;
      position = Math.min(position + 2, input.length);
    }
    const offset = position;
    const point = next();
    if (point === EOF) return tokens;
    tokens.push({ token: consumeToken(point), offset });
  }
};
