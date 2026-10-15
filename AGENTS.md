# AGENTS.md

`CLAUDE.md` is a symlink to this file. Project conventions live here; personal style preferences live in user memory.

This repo publishes the `@thomasfosterau/effect-web` package family, extracted from the `website`, `gardeneria` and `preferenceflow` applications. Those apps are the behavioural spec and test corpus, not code to transplant: port their tests and write the idiomatic Effect shape; where the apps diverge, the issue names the reference copy. An invariant id (`CACHE-AUTH-003`) names a rule from the apps' specs, defined for this repo in [SECURITY.md](SECURITY.md#invariant-ids).

| Package | Directory | Entries |
| --- | --- | --- |
| `@thomasfosterau/effect-web` | `packages/web` | `.`, `./net`, `./observability`, `./negotiate`, `./service-worker`, `./browser`, `./testing` |
| `@thomasfosterau/effect-robots` | `packages/robots` | `.` |
| `@thomasfosterau/effect-sitemap` | `packages/sitemap` | `.` |
| `@thomasfosterau/effect-rss-feed` | `packages/rss-feed` | `.` |
| `@thomasfosterau/effect-atom-feed` | `packages/atom-feed` | `.` |
| `@thomasfosterau/effect-json-feed` | `packages/json-feed` | `.` |

A new package adds a row here and in the root `README.md`, its own `CLAUDE.md`, a `.fallowrc.json` zone and rule, a root `package.json` devDependency, and its `#check` / `#docgen` / `#build` edges in the root `vite.config.ts` (`check`, `docgen`, `test:coverage`); a published package also joins the `check:dist` task's `dependsOn` and the `packages` list in `scripts/check-dist-imports.mjs`, or its `dist/` is never import-guarded.

## Common pitfalls

- **Never edit a version in a `package.json`.** Versions live in the `pnpm-workspace.yaml` catalog (`catalogMode: strict` rejects anything else). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or every CI job fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `@effect/tsgo`, `@typescript/native` and `vite-plus` move together (the tsgo patch hard-errors at install on an unsupported `tsc` or `oxlint`); read their catalog comments first.
- **`dist/` is the product.** Each package is a `vp pack` (tsdown) library with one bundle per entry point; `exports` points at `dist/`, so a sibling package consumes it the way a consumer does and its `check` / `test:unit` / `docgen` tasks take a `{ task: 'build', from: 'dependencies' }` edge.
- **`"sideEffects": false` is a claim about `dist/`, and it is load-bearing.** Every emitted `.js` must be pure declarations: no top-level statements, no top-level `await`, no bare imports. That is what lets a consumer's bundler drop what it does not use.
- **`vp run docgen` executes your examples.** `@effect/docgen` compiles every JSDoc `@example` as a program and runs it (docgen 4 runs examples only under `"runExamples": true` in each `packages/*/docgen.json`; it defaults to type-checking alone), importing the package by name through `dist/`. An example must be complete (import everything it uses), must not use `declare const` (no runtime value — the failure is at execution and easy to misread), and must not throw.
- **No application vocabulary.** Nothing here names a post body, an `owner_id`, a role ladder, a binding that only one app declares. An app-shaped special case is the signal that the code belongs in the app, or behind an injected parameter.
- **`effect` is a peer, never a dependency.** Two copies break `Context` / `Layer` / `Schema` identity; the consuming app owns the singleton.
- **Declare every required peer of a dependency.** A missing one passes on a warm local tree and fails CI on a fresh runner.

Package-local invariants, terms and import boundaries live only in each package's `CLAUDE.md` (`packages/<name>/CLAUDE.md`); read it before changing that package.

## Conventions

- **Effect-first.** Domain failures are tagged errors (see [Effect](#effect)); work that can fail returns `Effect`; optional values are `Option`; `null` appears only where a platform type demands it. Pure total functions stay plain functions.
- **Optional props and fields are declared `T | undefined`, never bare `x?: T`.** The workspace compiles with `exactOptionalPropertyTypes`.
- **Relative imports carry their `.ts` extension** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- **Tests import from `vite-plus/test`**, never `vitest`. A `tests/<module>.test.ts` mirrors the module it covers; a `tests/<module>.types.ts` holds the compile-time assertions (an expect-error directive above a statement that must fail), checked by `tsconfig.test.json`, never executed.
- **Every export has a doc comment** whose first sentence says what it is for. It documents defaults, units, the error channel and the reason for any non-obvious choice. It cites an invariant id only where the export enforces that rule. Functions, constructors and layers carry a runnable `@example` (docgen executes it); every export carries `@since` and `@category`. Provenance (which app file it replaces) goes in the extraction PR body, not in the hover.
- **One barrel per entry point**: `src/index.ts` for `.`, `src/<entry>/index.ts` for `./<entry>`. A new entry is added to `entries` in the package's `vite.config.ts`, to `exports`, to `paths` in `tsconfig.test.json` and to `entry` in `.fallowrc.json`.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` / `oxlint` with `@effect/tsgo`. No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint). `vp run check` — the type gate: every package's `src` under `tsconfig.json` plus its type-level tests under `tsconfig.test.json`. They are different commands.
- `vp run -r test:unit` — unit tests (node Vitest; nothing here needs a database or a credential).
- `vp run -r build` — `vp pack` → every package's `dist/`.
- `vp run check:dist` — the import guard: the built `dist/` of every published package imports no `effect/unstable/*`. Run after the build.
- `vp run docgen` — every public package's docgen: compiles and runs each `@example` against `dist/`, writes the (git-ignored) API reference under `packages/*/docs/`.
- `vp run test:coverage` — every package's unit suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores. Without the map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the gate on its own.
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm changeset` / `pnpm publish` on the release path. Single-check variants are in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `vp run check:dist`
7. `vp run docgen`
8. `pnpm audit --audit-level high` (network)
9. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent` (the fallow gate below; not a CI step). The PreToolUse fallow gate audits against `coverage/coverage-final.json` and never refreshes it, so run `test:coverage` first.

Steps 2–8 are CI's required `ci` job, in its order ([ci.yml](.github/workflows/ci.yml)). `CONTRIBUTING.md` and the PR template link here rather than restating the list.

## Branches and pull requests

- Branch off `main`; PR against `main`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/main` before opening or updating a PR; never merge `main` into your branch (GitHub's Update-branch button merges).
- Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work. Start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. A worktree needs its own `pnpm install`: the linked `vp` re-execs the nearest `node_modules/vite-plus/bin/vp` walking up from cwd.
- Every change to a published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` (TSDoc) take a `patch` changeset; other docs-only changes (READMEs, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)).
- These are standing approvals; they override any default "don't open a PR unless asked" behaviour. **Always open a PR** against `main` once a commit is pushed. **Watch it to merge or close**: investigate CI failures and review comments as they arrive, and rebase promptly when it goes conflicting. **Keep the PR body current** as the implementation diverges from it; an extraction PR lists which source-app files the package supersedes.
- GitHub writes go to `thomasfosterau/effect-web` only — never to the consuming applications, upstream projects or the owner's other libraries without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/effect-web` whenever the cwd might be another checkout. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available. If another repo needs something, say so in the PR body.

## Work tracker

- Issues in `thomasfosterau/effect-web` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file.
- The issue is the spec — read its comments; later comments override the body. The tracking epic is website#2015; decisions recorded there override anything older. Re-verify the issue's code claims against current `main` (and the apps' current default branches) before editing.
- Record decisions and findings as comments on the issue they were found working.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.
- Adoption by each application is tracked in that application's own tracker, blocked on a release of the package it adopts.

## Effect

Consult effect-solutions before writing Effect code (`vp exec effect-solutions list`, then `vp exec effect-solutions show <topic>…`: error-handling, basics, data-modeling, services-and-layers); never guess at an Effect pattern. If it isn't enough, read `node_modules/effect/dist/*.d.ts`.

- The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog; the published peer floor is under `catalogs.peers`. Raising the floor is a breaking change for every published package.
- Tagged errors are `Schema.TaggedError<Self>()(tag, fields)` classes (the rc spelling; `Schema.TaggedErrorClass` was the beta-line name).
- HTTP modules are `effect/http/*` and HttpApi `effect/http-api/*` (not `effect/unstable/*`) since rc.118.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile and puts `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`), `fallow` and `tsx` on PATH for non-interactive shells. It hydrates no secrets; none are needed, and nothing here can publish.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/main` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` needs the network.

## Documentation surfaces

`README.md` at the root is the landing page; each package `README.md` is the API reference consumers read on npm; each package `CLAUDE.md` carries its boundary, invariants and terms (it is not published); `CONTRIBUTING.md` carries human setup, CI expectations and single-check commands; `PUBLISHING.md` the release pipeline and its one-time owner setup; `SECURITY.md` the reporting channel, supply-chain posture and the invariant-id table. No `docs/` tree is committed (`packages/*/docs/` is docgen output); decisions go in issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to... | Run |
| --- | --- |
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| understand a finding | `fallow explain <issue-type>` |
