/**
 * Root workspace config. Owns the repo-wide format/lint/staged passes (read
 * statically by `vp fmt` / `vp lint` / `vp staged`) and the root aggregates
 * (`check`, `docgen`, `check:dist`, `alchemy`, `test:coverage`). Every
 * package's own tasks are defined once in `vite.package.ts` and instantiated
 * by each package's `vite.config.ts`; this file compiles nothing, but a new
 * package adds itself to the aggregate lists below.
 *
 * Copied from the effect-drizzle-ext library's root config (and through it
 * the gardeneria application's): every comment that explains a load-bearing
 * decision is part of the standard and travels with the config.
 *
 * @copyright Thomas Foster
 */

import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@mpsuesser/oxlint-plugin-effect";

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**"],
    overrides: [
      {
        files: ["**/*.md"],
        options: {
          proseWrap: "never",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    categories: {
      correctness: "error",
    },
    rules: {
      "eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "eslint/prefer-const": "warn",
      // The `Buffer` global is typed `any` wherever a consumer loads
      // @cloudflare/workers-types next to @types/node (every application this
      // family serves), so every call on it is unchecked there. Use
      // Uint8Array / TextEncoder / DataView instead.
      "eslint/no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "The `Buffer` global is typed `any` wherever @cloudflare/workers-types is loaded. Use Uint8Array / TextEncoder / DataView.",
        },
      ],
      // `casting-awareness` is an awareness prompt, not a defect rule — it
      // fires on every `as`, including the narrowings the Fetch / Workers
      // types structurally require. Stays visible as a warning.
      "effect/casting-awareness": "warn",
      // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options, so it is
      // unsatisfiable under the full-name convention (`import * as Option from
      // "effect/Option"`) this family shares with its consumers.
      "effect/prefer-namespace-imports": "off",

      // ---- Effect preset: ported-code allowances ---------------------------
      // The modules under packages/*/src are ports of behaviour the
      // applications carry today, which predates the Effect oxlint preset. The
      // rules below sit at `warn` so a port stays committable while each site
      // stays reported; a new site is a defect, not headroom.
      "effect/imperative-loops": "warn",
      "effect/avoid-native-object-helpers": "warn",
      "effect/avoid-non-null-assertion": "warn",
      "effect/avoid-any": "warn",
      "effect/avoid-untagged-errors": "warn",
      "effect/avoid-direct-json": "warn",
      "effect/prefer-arr-match": "warn",
      "effect/no-length-comparison": "warn",
      "effect/prefer-arr-sort": "warn",
      "effect/avoid-try-catch": "warn",
      "effect/yield-in-for-loop": "warn",
      "effect/prefer-effect-is": "warn",
      "effect/avoid-expect-in-if": "warn",
      "effect/effect-run-in-body": "warn",
      "effect/prefer-effect-fn": "warn",
      "effect/avoid-direct-tag-checks": "warn",
      "effect/avoid-option-getorthrow": "warn",
      "effect/no-barrel-imports": "warn",
      "effect/throw-in-effect-gen": "warn",
      // ---- Effect preset: rules this workspace's conventions cut across ----
      // `prefer-option-over-null` also fires on `?: T | undefined`, which is
      // the ONLY spelling of an optional member `exactOptionalPropertyTypes`
      // lets a caller forward an optional of its own into (AGENTS.md). A bare
      // `null` / `undefined` in a return type is still a finding to read; the
      // options-object members are not.
      "effect/prefer-option-over-null": "warn",
      // `unknown` is the honest type at the two boundaries these libraries
      // sit on: a caught failure handed to an error tracker or a log line
      // (`describeError`, `describeSessionDegraded`), and the free-form
      // fields of a structured log event. Parsing them would change the
      // applications' log shape.
      "effect/no-unknown-parameters": "warn",
      // Same boundaries, other direction: a KV `get` resolves whatever was
      // stored, an R2 `json()` whatever was archived, a queue message carries
      // whatever the producer sent. The platform contracts return `unknown`
      // and the caller decodes (`decodeQueueMessage`, the cache's schema).
      "effect/no-unknown-returns": "warn",
      "effect/no-unsafe-dictionary-type": "warn",
      "effect/no-runtime-typeof": "warn",
      "typescript/no-explicit-any": "off",
      "typescript/no-empty-object-type": "off",
      "typescript/ban-ts-comment": "off",
      "unicorn/no-empty-file": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The Effect preset's
      // service rules have no satisfiable fix in these files.
      {
        files: ["**/vite.config.ts", "**/vitest.config.ts", "vite.package.ts", "scripts/**"],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/avoid-process-env": "off",
          // Plain Node build tooling (the task-graph builder, the dist guard):
          // native loops, `.length` and `Object.fromEntries` are the idiom.
          "effect/imperative-loops": "off",
          "effect/no-length-comparison": "off",
          "effect/prefer-arr-match": "off",
          "effect/avoid-native-object-helpers": "off",
          "effect/use-console-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/avoid-native-fetch": "off",
          "effect/effect-promise-vs-trypromise": "off",
          // `...(process.env.X ? { x } : {})` is how a vitest option is left
          // unset under `exactOptionalPropertyTypes`.
          "effect/no-conditional-empty-object-spread": "off",
        },
      },
      // Type-level tests: the expect-error directives ARE the assertions
      // (a statement that must fail to compile), and every binding exists to
      // be asserted against, never to be read.
      {
        files: ["**/tests/**/*.types.ts"],
        rules: {
          "eslint/no-unused-vars": "off",
          "effect/avoid-ts-ignore": "off",
        },
      },
      // Test fixtures are the seams under test, not domain code: a cast that
      // drops alchemy's deploy-time provider tags after `Effect.provide`, a
      // wall-clock `Date` standing in for a publication stamp, a `CI`
      // variable toggled to drive a reporter. Each stays visible as a
      // warning; none can be written another way in a fixture.
      {
        files: ["**/tests/**/*.ts"],
        rules: {
          "effect/require-safety-comment-for-type-assertion": "warn",
          "effect/use-clock-service": "warn",
          "effect/avoid-process-env": "warn",
          "effect/require-effect-concurrency": "warn",
        },
      },
    ],
    // Type-aware linting is intentionally disabled: type checking stays the
    // `check` tasks' job (native tsc, Effect-patched).
    options: {
      typeAware: false,
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  run: {
    tasks: {
      // The CI typecheck gate, as one task: every package's `check` (`src`
      // under tsconfig.json, the type-level tests under tsconfig.test.json).
      // A pure graph node. The packages are named explicitly — a `from:
      // "dependencies"` edge does not traverse the workspace root's own
      // devDependencies — so a new package adds itself to EVERY list here
      // (`check`, `docgen`, `test:coverage`).
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: [
          "@thomasfosterau/effect-web#check",
          "@thomasfosterau/effect-web-cloudflare#check",
          "@thomasfosterau/effect-web-posthog#check",
          "@thomasfosterau/effect-web-robots#check",
          "@thomasfosterau/effect-web-sitemap#check",
        ],
        cache: false,
      },
      // Every package's docgen: compiles AND RUNS each JSDoc `@example`
      // against the built `dist/`, then writes the API reference under that
      // package's (git-ignored) `docs/`. Same pure-graph-node shape.
      docgen: {
        command: "echo 'docgen: every example compiled and ran'",
        dependsOn: [
          "@thomasfosterau/effect-web#docgen",
          "@thomasfosterau/effect-web-robots#docgen",
          "@thomasfosterau/effect-web-sitemap#docgen",
        ],
        cache: false,
      },
      // Import guard (effect-web#31): the built dist of the three packages
      // that publish on rc.118 imports no `effect/unstable/*`, alchemy or
      // `@distilled.cloud/*`. Reads `dist/`, hence the build edges.
      "check:dist": {
        command: "node scripts/check-dist-imports.mjs",
        dependsOn: [
          "@thomasfosterau/effect-web#build",
          "@thomasfosterau/effect-web-robots#build",
          "@thomasfosterau/effect-web-sitemap#build",
        ],
        cache: false,
      },
      // The alchemy-bound work of the two packages held private until alchemy
      // ships an rc.118 build (effect-web#33): cloudflare's whole suite and
      // docgen, posthog's `alchemy.test.ts` and docgen. RED until then, so it is NOT in
      // `check`, `docgen` or `test:coverage`; the non-required `alchemy` CI
      // job runs it. Nothing is skipped.
      alchemy: {
        command: "echo 'alchemy: every alchemy-bound suite and example green'",
        dependsOn: [
          "@thomasfosterau/effect-web-cloudflare#test:alchemy",
          "@thomasfosterau/effect-web-cloudflare#docgen",
          "@thomasfosterau/effect-web-posthog#test:alchemy",
          "@thomasfosterau/effect-web-posthog#docgen",
        ],
        cache: false,
      },
      // Every package's unit suite under one Istanbul coverage map
      // (`coverage/coverage-final.json`), which `fallow audit` reads for exact
      // per-function CRAP scores (`health.coverage` in .fallowrc.json).
      // Without it fallow estimates every function as uncovered, and any
      // function with cyclomatic complexity ≥ 5 fails the gate on its own.
      // Run this before `fallow audit` (the Claude Code PreToolUse fallow gate
      // runs the audit on `git commit` / `git push` but never refreshes this map).
      //
      // Unlike each package's own `test:unit`, this one vitest process runs
      // every package's suite, so no `{ from: "dependencies" }` edge builds
      // the siblings a suite imports through `exports` (→ `dist/`); on a
      // clean tree those suites fail to resolve. Every package's `build` is
      // named explicitly (cached, so a warm tree pays nothing) — a new
      // package adds itself to this list as well.
      "test:coverage": {
        command: "vp test run --coverage",
        dependsOn: [
          "@thomasfosterau/effect-web#build",
          "@thomasfosterau/effect-web-cloudflare#build",
          "@thomasfosterau/effect-web-posthog#build",
          "@thomasfosterau/effect-web-robots#build",
          "@thomasfosterau/effect-web-sitemap#build",
        ],
        cache: false,
      },
    },
  },
  test: {
    // One entry per package: each package's own vite.config.ts is a vitest
    // project, so the root run and the root coverage map cover them all.
    projects: ["packages/*/vite.config.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
