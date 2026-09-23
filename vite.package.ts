/**
 * The one Vite+ configuration every package in this workspace shares: the
 * task graph (`check`, `build`, `test:unit`, `test:coverage`, `docgen`), the
 * `vp pack` (tsdown) settings, the alias that lets tests import the package
 * by name and resolve to `src/`, and the vitest / coverage settings. Each
 * `packages/<name>/vite.config.ts` is a one-call instantiation of it.
 */
import { defineConfig } from "vite-plus";

/** What differs per package. */
export interface PackageConfigOptions {
  /** The package's `import.meta.url`, so paths resolve relative to it. */
  readonly url: string;
  /** The published name (`@thomasfosterau/effect-web-cloudflare`), for the test alias. */
  readonly name: string;
  /** `pack.entry`: `index` → `src/index.ts`, every other key → `src/<key>/index.ts`. */
  readonly entries: ReadonlyArray<string>;
}

/**
 * Input fingerprint for a package's cached tasks: auto tracking minus
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

/**
 * A sibling package is consumed the way a consumer does — through its
 * `exports`, so its `dist/` — hence the build edge on every task that
 * resolves one. A package with no workspace dependency gets an empty edge.
 */
const siblingBuild = { task: "build", from: "dependencies" as const };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export const packageConfig = ({ url, name, entries }: PackageConfigOptions) => {
  const srcDir = new URL("./src/", url).pathname;
  const subpaths = entries.filter((entry) => entry !== "index");
  const entry = Object.fromEntries(
    entries.map((one) => [one, one === "index" ? "src/index.ts" : `src/${one}/index.ts`]),
  );
  const maxWorkers = process.env.VITEST_MAX_WORKERS;
  return defineConfig({
    run: {
      tasks: {
        // `src` under the native, Effect-patched `tsc`, then the type-level
        // tests (`tests/*.types.ts`, whose expect-error directives are the
        // assertions) under tsconfig.test.json, which resolves the package
        // name to `src/` so this package's own build is never needed first.
        check: {
          command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
          dependsOn: [siblingBuild],
          input: cacheInputs,
          output: [],
        },
        // The published artifact: one ESM bundle + declaration file per entry
        // point (`vp pack` → tsdown, `platform: neutral`). `sideEffects:
        // false` is a claim about this output: no top-level statements.
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
      entry,
      format: "esm",
      platform: "neutral",
      dts: true,
      outDir: "dist",
      clean: true,
    },
    resolve: {
      // Tests import the package by name, exactly as a consumer would (and as
      // tsconfig.test.json's `paths` type-checks them), so the runner resolves
      // that name to `src/` rather than to the built `dist/` that `exports`
      // points at — a unit run never needs a build first.
      alias: [
        { find: new RegExp(`^${escapeRegExp(name)}$`), replacement: `${srcDir}index.ts` },
        ...(subpaths.length === 0
          ? []
          : [
              {
                find: new RegExp(
                  `^${escapeRegExp(name)}/(${subpaths.map(escapeRegExp).join("|")})$`,
                ),
                replacement: `${srcDir}$1/index.ts`,
              },
            ]),
      ],
    },
    test: {
      include: ["tests/**/*.test.ts"],
      testTimeout: 30_000,
      ...(maxWorkers === undefined ? {} : { maxWorkers: Number(maxWorkers) }),
      coverage: {
        provider: "istanbul",
        // `json` writes coverage-final.json, the Istanbul map `fallow audit`
        // reads for exact per-function CRAP scores (`health.coverage` in
        // .fallowrc.json); without it every function scores as uncovered.
        reporter: ["text-summary", "json-summary", "json"],
        reportsDirectory: "./coverage",
        include: ["src/**/*.ts"],
        exclude: ["**/*.d.ts"],
        thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  });
};
