import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";

/**
 * An `A` built from every one of its members, absent ones as `undefined`,
 * with those keys dropped: the caller lists each member once (the mapped
 * parameter type makes a forgotten one a compile error), and the result
 * carries only the present ones.
 */
export const compact = <A>(record: { readonly [K in keyof A]-?: A[K] | undefined }): A =>
  // SAFETY: `Record.filter` only removes keys, and only `undefined`-valued ones; every member that can be `undefined` is optional in `A`, so what remains is an `A`. The assertion restores the key set `filter` widens to `string`.
  Record.filter(record, Predicate.isNotUndefined) as A;
