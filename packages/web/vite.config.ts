import { defineConfig } from "vite-plus";

/**
 * Input fingerprint for this package's cached tasks: auto tracking minus
 * node_modules bookkeeping churn (pnpm rewrites `.modules.yaml` on every
 * install), with the lockfile back explicitly so a dependency upgrade still
 * invalidates a type-check or a test run.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  "!docs/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

export default defineConfig({
  run: {
    tasks: {
      // `src` under the native, Effect-patched `tsc`, then the type-level
      // tests (`tests/*.types.ts`, whose expect-error directives are the
      // assertions) under tsconfig.test.json, which resolves the package name
      // to `src/` so no build is needed first.
      check: {
        command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
        input: cacheInputs,
        output: [],
      },
      // The published artifact: one ESM bundle + declaration file per entry
      // point (`vp pack` → tsdown, `platform: neutral`). `sideEffects: false`
      // is a claim about this output: no top-level statements.
      build: {
        command: "vp pack",
        input: cacheInputs,
        output: ["dist/**"],
      },
      "test:unit": {
        command: "vp test run tests",
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: [],
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: ["coverage/**"],
      },
      // Compiles AND RUNS every JSDoc `@example` (see docgen.json). Examples
      // import the package by name exactly as a consumer would, which
      // resolves through `exports` to `dist/` — hence the build edge.
      docgen: {
        command: "docgen",
        dependsOn: ["build"],
        input: cacheInputs,
        output: ["docs/**"],
      },
    },
  },
  pack: {
    entry: {
      index: "src/index.ts",
    },
    format: "esm",
    platform: "neutral",
    dts: true,
    outDir: "dist",
    clean: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    ...(process.env.VITEST_MAX_WORKERS
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
