# AGENTS.md

Project conventions live here; personal style preferences live in user memory. `CLAUDE.md` is a symlink to this file.

This repository is the **`@thomasfosterau/effect-web` package family**: publishable npm libraries extracted from three applications (`thomasfosterau/website`, the foundation; `thomasfosterau/gardeneria`; `thomasfosterau/preferenceflow`). The application copies are the **behavioural spec and the test corpus, not code to transplant**: every package targets the idiomatic Effect shape (`effect/unstable/http`, `HttpApi`, `Layer`, `Schema`, `Schema.TaggedErrorClass`) and ports the apps' tests, not their files. Where the three apps have diverged, the issue names which copy is the reference. The toolchain — pnpm + Vite+ (`vp`), a strict catalog, the TypeScript 6/7 split, the Effect oxlint preset, fallow, the session hook — is copied from `effect-drizzle-ext` (and through it the apps), and the release pipeline (OIDC trusted publishing, the Effect canary, docgen, type-level tests) from `effect-jsonapi`, so a library here builds against exactly what its consumers run. A `#NNN` citation inside a ported comment names an issue in the app it was ported from (website unless stated), the evidence behind a decision, not a ticket in this tracker; an invariant id (`CACHE-AUTH-003`, `SEC-SSRF-003`, `PERF-CACHE-005`) is the stable handle for a rule written up in the apps' specs.

| Package | Directory | What it is |
| --- | --- | --- |
| `@thomasfosterau/effect-web` | `packages/web` | Framework-neutral request/response utilities: headers, Vary, cache-control, the cross-origin guard, client IP, SSRF-guarded fetch, structured log + span tracer, the content-negotiation dispatch verdict. Peer: `effect` only. |
| `@thomasfosterau/effect-web-cloudflare` | `packages/cloudflare` | The Cloudflare Workers / Alchemy runtime scaffold (per-request / per-event binding layers, the execution-context lifecycle, the `Scheduler` bridge, the read-path query counter), the Hyperdrive `Database` seam with the pg client injected, queue producer / consumer glue, the KV read-through resource cache, and the in-memory binding stubs. Peers: `effect`, `alchemy` (exact beta), `@cloudflare/workers-types` (optional). |

Further packages land one issue each (see the tracker); every one adds a row here, a `CLAUDE.md` of its own, and its `#check` / `#docgen` edges in the root `vite.config.ts`.

## Common pitfalls

- **Never edit a version in a `package.json`.** Every external version lives in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) under `catalog:` (peer ranges under `catalogs.peers`); package.json files carry only `catalog:`, `catalog:peers` or `workspace:*`, and `catalogMode: strict` rejects anything else at install. After editing the catalog, run `pnpm install` and commit the regenerated `pnpm-lock.yaml` — a stale lockfile fails every CI job at once with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `@effect/tsgo`, `@typescript/native` and `vite-plus` move together (the tsgo patch hard-errors at install on an unsupported `tsc` or `oxlint`); read the comments on those entries before bumping any of the three.
- **`dist/` is the product.** Each package is a `vp pack` (tsdown) library with one bundle per entry point; `exports` points at `dist/`, so a sibling package consumes it the way a consumer does and its `check` / `test:unit` / `docgen` tasks take a `{ task: 'build', from: 'dependencies' }` edge.
- **`"sideEffects": false` is a claim about `dist/`, and it is load-bearing.** Every emitted `.js` must be pure declarations: no top-level statements, no top-level `await`, no bare imports. That is what lets a consumer's bundler drop what it does not use.
- **`vp run docgen` executes your examples.** `@effect/docgen` compiles every JSDoc `@example` as a program AND RUNS it, importing the package by name through `dist/`. An example must be complete (import everything it uses), must not use `declare const` (no runtime value — the failure is at execution and easy to misread), and must not throw.
- **No application vocabulary.** Nothing here names a post body, an `owner_id`, a role ladder, a binding that only one app declares. An app-shaped special case is the signal that the code belongs in the app, or behind an injected parameter.
- **`effect` is a peer, never a dependency.** Two copies break `Context` / `Layer` / `Schema` identity; the consuming app owns the singleton.

Everything else that must be visible when touching a package is in that package's `CLAUDE.md`, which carries its terms, invariants and import boundary.

## Conventions

- **Effect-first.** Domain failures are `Schema.TaggedErrorClass` values; work that can fail returns `Effect`; optional values are `Option`; `null` appears only where a platform type demands it. Pure total functions stay plain functions. Consult `effect-solutions` (`vp exec effect-solutions show error-handling basics data-modeling services-and-layers`) before writing Effect code; never guess at a pattern.
- **Optional props and fields are declared `T | undefined`, never bare `x?: T`.** The workspace compiles with `exactOptionalPropertyTypes`.
- **Relative imports carry their `.ts` extension** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- **Tests import from `vite-plus/test`**, never `vitest`. A `tests/<module>.test.ts` mirrors the module it covers; a `tests/<module>.types.ts` holds the compile-time assertions (an expect-error directive above a statement that must fail), checked by `tsconfig.test.json`, never executed. The Effect lint preset's rule against those directives is switched off for `*.types.ts` only.
- **Every export is documented**: a doc comment saying what it is for, which app behaviour it carries and which invariant id it honours, a runnable `@example`, `@since` and `@category`.
- **Single barrel per entry point**: `src/index.ts` for `.`, `src/<entry>/index.ts` for `./<entry>`, each listed in `pack.entry` in the package's `vite.config.ts` and in `exports`.

## Work tracker

- **Active work** lives in GitHub Issues for `thomasfosterau/effect-web`. Longer-running tech debt is an issue too; there is no in-repo backlog file and a code comment is not a tracker.
- **Decisions and findings** are recorded as comments on the issue they were found working; later comments override the body.
- **Adoption** by each application is tracked in that application's own tracker, blocked on a release of the package it adopts.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` / `oxlint` with `@effect/tsgo`. No pre-push hook: run the gates yourself.
- `vp check` — the built-in format + lint pass (`vp fmt --check` + `vp lint`).
- `vp run check` — the type gate: every package's `src` under `tsconfig.json` plus its type-level tests under `tsconfig.test.json`. Distinct from `vp check`.
- `vp run -r test:unit` — unit tests (node Vitest; nothing here needs a database or a credential).
- `vp run -r build` — `vp pack` → every package's `dist/`.
- `vp run docgen` — every package's docgen: compiles and runs each `@example` against `dist/`, writes the (git-ignored) API reference under `packages/*/docs/`.
- `vp run test:coverage` — every package's unit suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores. Run it before the audit: without the map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the gate on its own.
- `pnpm changeset` — add a changeset; every change to a published package needs one. Releases are cut by the `Release` workflow (changesets/action) on `main`.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm changeset` / `pnpm publish` on the release path.

## Branch model

`main` plus short-lived feature branches, PR against `main`, squash-merge. Rebase onto `origin/main` before opening a PR; never merge `main` into a feature branch (GitHub's "Update branch" button does a merge — avoid it). Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work; start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. The linked `vp` at `~/.local/bin/vp` re-execs the nearest project-local `node_modules/vite-plus/bin/vp` walking up from cwd, so a worktree needs its own `pnpm install` first.

## Working a dispatched issue

- The issue is the spec: read all of it, including comments. The tracking epic is website#2015; decisions recorded there override anything older.
- Re-verify the code claims against current `main` (and the apps' current default branches) before editing.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- No silent deferrals: scope cut mid-PR becomes a linked issue before merge.

## PR management

These are standing instructions and approvals; they override any default "don't open a PR unless asked" behaviour.

- **Always open a PR** for branch work, against `main`, once a commit is pushed.
- **Always watch the PR to merge or close**: investigate CI failures and review comments as they arrive; rebase promptly when the PR goes conflicting.
- **Always keep the PR body current** as the implementation diverges from it. An extraction PR lists which SOURCE APP files the package supersedes.
- **A PR that changes published behaviour carries a changeset.** No changeset, no release. Do not publish by hand; the owner merges the "Version Packages" PR.
- **GitHub writes are scoped to `thomasfosterau/effect-web` only.** Never create or edit issues, PRs, comments, reviews or releases in any other repository — the consuming applications, upstream projects, the owner's other libraries — without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/effect-web` explicitly whenever the cwd might not be this checkout. If another repo needs something, say so in the PR body.

## Verification

- Claims of verification name the command and its final status. If a gate cannot run, say so in the PR body rather than implying it ran.
- The pre-push parity run is: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`, then `vp check`, `vp run check`, `vp run -r test:unit`, `vp run -r build`, `vp run docgen`. A warm local tree hides a missing peer; a fresh runner does not.
- Peers are declared explicitly: a required peer of a dependency must be a declared dependency or CI fails on a fresh runner while a warm local tree passes.

## Agent sessions

**Agent sessions are not hydrated.** The committed SessionStart hook ([.claude/hooks/session-start.sh](.claude/hooks/session-start.sh)) syncs dependencies and links the toolchain (`vp`, `fallow`, `tsx`) so they resolve from a **non-interactive** shell (which `~/.bashrc` alone does not do). It hydrates no secrets: nothing here needs one, and nothing here can publish.

## Documentation surfaces

`README.md` at the root is the landing page; each package `README.md` is the API reference consumers read on npm; each package `CLAUDE.md` carries its terms, invariants and boundary; `CONTRIBUTING.md` carries the pre-PR checklist; `PUBLISHING.md` and `SECURITY.md` the release pipeline and its one-time setup. No `docs/` tree is committed (`packages/*/docs/` is docgen output); decisions go in issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `vp run test:coverage` and then `fallow audit --format json --quiet --explain --gate-marker agent` (the commit hook runs the audit; the coverage map is what makes its CRAP scores real). If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to... | Run |
| --- | --- |
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| understand a finding | `fallow explain <issue-type>` |
