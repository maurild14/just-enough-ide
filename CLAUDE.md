# JEI — agent guide

JEI ("Just Enough IDE") is a pane docked beside a Claude Code or OpenCode session with three tabs: Files, Search and Git (live filename search above the file tree, content search and a Source Control panel). Both hosts ship the same features, keys and behavior from one repository. The repo root is the Claude Code plugin and the `opencode-jei` npm package. Layout: `core/` (pure TypeScript logic), `hosts/claude-code/` (a Claude Code mod drawn with `$.ui`), `hosts/opencode/` (an OpenCode 2.x plugin: server entry, RPC, Solid + OpenTUI views).

## Commands

```
bun install                # install dev dependencies
bun run test               # all *.spec.ts(x) in core/ and hosts/opencode/
bun test <file>            # one spec file
bun run typecheck          # tsc over core + the OpenCode adapter
bun run validate           # claude plugin validate .
bun run test:claude        # claude plugin test . (the *.test.ts(x) files)
bun run check:docs         # lint this file and docs/ (links, index, headers)
bun run sync:agents        # copy AGENTS.md over CLAUDE.md
```

Before finishing any change, run `bun run test`, `bun run typecheck` and `bun run check:docs`. If you touched `hosts/claude-code/` or `hooks/`, also run `bun run validate` and `bun run test:claude`. `bun run typecheck:claude` needs `.claude-plugin/types/`, which only Claude Code lays; it is optional locally.

## Map: if you are doing X, read Y

| If you are doing... | Read |
| --- | --- |
| Anything new (start here) | `docs/README.md`, then `PRD.md` for behavior |
| Adding or moving code, or deciding where it goes | `docs/architecture.md` |
| Writing TypeScript, errors, git calls, UI copy, commits | `docs/conventions.md` |
| Writing or running tests, fixtures, the fake host | `docs/testing.md` |
| Drawing a view, colors, glyphs, widths, resize, empty states | `docs/design.md` |
| Touching a host API (Claude Code mod or OpenCode plugin) | `docs/hosts.md` |
| Handling files, secrets, the network or releases | `docs/security.md` |
| Changing sensitive commit approval | `docs/decisions/0010-exact-sensitive-path-approval.md` |
| Git history, graph cells or tool commit attribution | `docs/decisions/0012-git-history-evidence-and-state.md` |
| Branches, commit actions or remote URLs/errors | `docs/decisions/0013-safe-branch-and-commit-actions.md` |
| Native history UI or tool attribution integration | `docs/decisions/0014-native-history-views-and-attribution.md` |
| OpenCode history RPC, schema validation or native history dialogs | `docs/decisions/0015-opencode-history-rpc-and-native-dialogs.md` |
| Host graph budgets, contextual Sync or URL opening | `docs/decisions/0016-history-cell-budgets-and-action-reachability.md` |
| Colored history, right-aligned hashes or shared Back navigation | `docs/decisions/0017-colored-history-and-shared-back-navigation.md` |
| Claude Sync missing-review recovery or shell permission guidance | `docs/decisions/0018-safe-sync-review-recovery.md` |
| Search streaming, fallback, replace safety or preview origins | `docs/decisions/0019-search-streams-and-safe-replace.md` |
| Native Search filenames or zero-width fallback verification | `docs/decisions/0020-native-search-paths-and-zero-width-fallback.md` |
| Native Search/Symbols controls, LSP permission checks or ambiguous roots | `docs/decisions/0021-native-search-symbol-controls-and-path-evidence.md` |
| OpenCode Search/Symbols RPC, stored replacement plans or source targets | `docs/decisions/0022-opencode-search-symbols-and-review-state.md` |
| Search retention budgets, complete replacement review or shared replacement Ask text | `docs/decisions/0023-bounded-search-and-complete-replacement-review.md` |
| Live filename search, content Search tab, control spacing or retained tree navigation | `docs/decisions/0026-filename-and-content-search.md` |
| Commit mode, input blur or repeated focus/arrow navigation | `docs/decisions/0024-focus-and-arrow-navigation.md` |
| Checking what is built and known debt | `docs/quality.md` |
| Preparing a release (manual QA, release pipeline) | `docs/qa.md`, `CONTRIBUTING.md` |
| Changing a rule or a past decision | `docs/decisions/README.md` |
| Picking up planned work | `docs/plans/` |
| Product behavior, keys, options, milestones | `PRD.md` |

## Hard rules

- `core/` is pure: no imports from `claude-code`, `@opencode/*`, `solid-js`, `@opentui/*`, `node:*` or `bun:*`, only ECMAScript built-ins. Specs (`*.spec.ts`) may use `bun:test` and `node:*`.
- Every process is an argv array, never a shell string (`sh -c`, `cmd /c`). Every git call is `['git', '--no-optional-locks', '-C', root, ...]` with env `GIT_OPTIONAL_LOCKS=0`.
- Test naming: `*.spec.ts(x)` run under `bun test` (`core/`, `hosts/opencode/`); `*.test.ts(x)` run under `claude plugin test` (`hosts/claude-code/` only). Never mix them.
- Relative imports keep their extension (`./status.ts`, `./pane.tsx`). Zero runtime dependencies.
- A feature lands on both hosts or on neither. Keys are one lowercase letter or digit (plus `enter`, `esc`, arrows), defined only in `core/keys.ts`.
- Every view renders without breaking at 24, 40, 80 and 120 columns and survives a live resize. Destructive actions always confirm.
- No secrets, tokens, personal paths, usernames or real names in code, fixtures or docs. Fixtures use the sample repo `acme-app` and Ana Rivera / Leo Park `@example.com`.
- Do not mention other projects, their authors or repositories anywhere.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`). Everything is written in English.

## Workflow

- Implementation plans live in `docs/plans/`. A plan's checkboxes are not a status tracker; `git log` is.
- Any decision that changes a rule gets an ADR in `docs/decisions/` in the same change.
- Update the matching doc in the same commit as the code. Mark unbuilt parts `Status: draft`.
- Edit `AGENTS.md`, then run `bun run sync:agents`. `CLAUDE.md` must stay byte-identical; `bun run check:docs` fails if it is not.
- Keep this file under 150 lines. Put detail in `docs/`, not here.

Docs are the source of truth. If code and docs disagree, fix one of them in the same change.
