import { defineConfig } from "vite-plus";

/**
 * Tests import the package by name, exactly as a consumer would (and as
 * tsconfig.test.json's `paths` type-checks them), so the runner resolves that
 * name to `src/` rather than to the built `dist/` that `exports` points at —
 * a unit run never needs a build first. One entry per `exports` subpath. The
 * sibling `@thomasfosterau/effect-web` is consumed the way a consumer does,
 * through its `exports` and therefore its `dist/` — hence the build edge.
 */
const srcDir = new URL("./src/", import.meta.url).pathname;

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

/** The sibling's `dist/` must exist before anything here resolves it. */
const siblingBuild = { task: "build", from: "dependencies" as const };

export default defineConfig({
  run: {
    tasks: {
      check: {
        command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
        dependsOn: [siblingBuild],
        input: cacheInputs,
        output: [],
      },
      build: {
        command: "vp pack",
        dependsOn: [siblingBuild],
        input: cacheInputs,
        output: ["dist/**"],
      },
      "test:unit": {
        command: "vp test run tests",
        dependsOn: [siblingBuild],
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: [],
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        dependsOn: [siblingBuild],
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: ["coverage/**"],
      },
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
      hyperdrive: "src/hyperdrive/index.ts",
      queues: "src/queues/index.ts",
      cache: "src/cache/index.ts",
      testing: "src/testing/index.ts",
    },
    format: "esm",
    platform: "neutral",
    dts: true,
    outDir: "dist",
    clean: true,
  },
  resolve: {
    alias: [
      { find: /^@thomasfosterau\/effect-web-cloudflare$/, replacement: `${srcDir}index.ts` },
      {
        find: /^@thomasfosterau\/effect-web-cloudflare\/(hyperdrive|queues|cache|testing)$/,
        replacement: `${srcDir}$1/index.ts`,
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    ...(process.env.VITEST_MAX_WORKERS
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
