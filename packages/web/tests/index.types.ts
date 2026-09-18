/**
 * Type-level tests: the expect-error directives are the assertions, checked
 * by tsconfig.test.json (which resolves the package name to `src/`). Every
 * binding is exported so an unused-local error can never stand in for the
 * assertion a directive expects.
 */
import { packageName } from "@thomasfosterau/effect-web";

export const name: "@thomasfosterau/effect-web" = packageName;

// @ts-expect-error -- the name is a literal type, not a wider string
export const wrong: "something-else" = packageName;
