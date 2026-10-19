# Conventions

> Purpose: the code, copy and commit conventions every change follows · Status: current · Last reviewed: 2026-10-19

The rules that bind everything are summarized in `AGENTS.md`. Behavior is in `PRD.md`; visuals are in `docs/design.md`.

## TypeScript

- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`). TSX uses the `h` factory for Claude Code; the OpenCode adapter has its own `tsconfig.json` for Solid.
- Zero runtime dependencies. Host packages are optional peer dependencies and also dev dependencies.
- Prefer small pure functions returning plain data. Types that cross the host boundary are exported from `core/`.
- `core/` uses only ECMAScript built-ins (see `docs/architecture.md`).

## Naming and files

- Files are lowercase, single words or `kebab-case` (`tree.ts`, `pane.tsx`). A spec sits beside its subject: `status.ts` and `status.spec.ts`.
- `*.spec.ts(x)` run under `bun test`; `*.test.ts(x)` run under `claude plugin test` and live only in `hosts/claude-code/`. See `docs/testing.md`.
- View ids are the `View` union in `core/keys.ts`; tab ids are the `Tab` union.

## Imports

Every relative import names its file with its extension: `./status.ts`, `./pane.tsx`. `tsconfig.json` sets `allowImportingTsExtensions`, and both hosts' loaders resolve them (decided and verified when the repo was bootstrapped).

## Errors

Status: draft — built in milestone 0.1 (plan Task 4).

- A failed git command raises `GitError` (in `core/git/run.ts`), carrying the argv, exit code and stderr, with `firstLine` for display.
- Functions that can fail in expected ways (missing file, not a repo) return `null` or a tagged result; they do not throw for control flow.
- User-facing failures show git's or the OS's first error line, never a stack trace. The copy is in `docs/design.md`.

## Processes

- **argv only.** Every process is an argv array. Never `sh -c`, `cmd /c` or string concatenation into a shell. Where an OS tool is unavoidable, each OS gets its own argv, both tested.
- **Git invocation.** Every git command is `['git', '--no-optional-locks', '-C', root, ...args]` run with env `GIT_OPTIONAL_LOCKS=0` and `LC_ALL=C`, so JEI never contends with the agent's own git and can match git's English stderr (for example divergence detection) in any locale. All git calls go through the one runner in `core/git/run.ts`. Read with porcelain or plumbing formats only (`status --porcelain=v2 -z`, `log --format=...`, `diff --numstat -z`).
- Paths are handled by `core/shared/paths.ts` (posix-style, case-insensitive on Windows). Every path JEI writes or deletes must resolve inside the project root.

## UI copy

- English only. Sentences end with a period; no exclamation marks. Labels are short and in sentence case.
- Agent-facing labels use the host's name: "Ask Claude" on Claude Code, "Ask OpenCode" on OpenCode.
- Keys are one lowercase letter or digit, plus `enter`, `esc` and arrows, identical on both hosts and defined only in `core/keys.ts`. Never bind `ctrl+n` or `ctrl+p`.
- Destructive actions (discard, discard all, delete) always show a confirmation.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`, with an optional scope (`feat(core): ...`). release-please reads them to cut releases. One logical change per commit, with docs in the same commit as the code they describe. Commits use the maintainer's GitHub noreply identity.

## Paths

Core paths are posix-relative: callers pass `toPosix` output and `/` is the only separator. `core/` has no platform, so `isInside` and `relativeTo` fold case only for Windows-style roots (a drive letter or a UNC prefix); posix and relative roots are case-sensitive. A path that keeps a leading `..` beyond its root is outside it.
