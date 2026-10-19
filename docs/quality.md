# Quality

> Purpose: what is built, what is not, and the known tech debt, per area · Status: current · Last reviewed: 2026-10-19

Update a row in the same commit that changes the area. `git log` is the history; this table is the current snapshot. States: `not built`, `partial`, `built`, `built (debt)`.

## Status by area

| Area | Claude Code | OpenCode | Planned for | Notes |
| --- | --- | --- | --- | --- |
| Repo scaffolding, CI scripts | built | built | 0.1 (Tasks 1, 2) | Bootstrap done; CI workflow, Dependabot, issue forms and PR template added (Claude Code CI job non-blocking). |
| `core/` foundations (Host, options, keys, paths, argv, fuzzy) | built | built | 0.1 (Task 3) | Shared by both hosts. Keys cover Files, Git and diff; Search and Symbols carry navigation only. |
| Git runner, status parser | built | built | 0.1 (Task 4) | `core/git/run.ts` (runner, `GitError`), `core/git/status.ts` (porcelain v2 parser, folder roll-up, `isRepo`). Fixtures in `test/fixtures/git/`. |
| Git diff parsing, commands | built | built | 0.1 (Tasks 5, 6) | Diff parsing (`core/git/diff.ts`, fixtures in `test/fixtures/diff/`); commands, sync, hook detection, sensitive paths and commit-message helpers (`commands.ts`, `sync.ts`, `hooks.ts`, `sensitive.ts`, `message.ts`). `readHookSignals` is specced with an in-memory host and with real git (Task 9). |
| Files model: tree rows, preview, CSV, open, icons, mention, `fit` helpers | built | built | 0.1 (Task 7) | `core/files/*` and `core/shared/fit.ts`. `glyphs: auto` is plain until Nerd Font detection exists. |
| Activity, refresh guard, pane state, `/jei` argument | built | built | 0.1 (Task 8) | `core/activity/*`, `core/latest.ts`, `core/pane.ts`, `core/command.ts`. Host wiring (hooks, timers, `relativeTo` on raw paths) comes with the adapters. |
| Core services: Files and Git over a Host | built | built | 0.1 (Task 9) | `core/files/service.ts`, `core/git/service.ts`, spec-only `test/fake-host.ts` (real git in temp repos, including a bare-remote divergence). Adapters call these and own refresh guards. |
| Pane shell, tabs, hint line, `/jei` | built | not built | 0.1 (Tasks 10, 15) | Claude Code: `hooks/register.tsx`, `hosts/claude-code/{host.ts,state.ts,pane.tsx}`, `types/index.d.ts`. Files and Git bodies are header rows until Tasks 11 and 12; Search and Symbols say "Coming in a later version." Tab-bar breakpoints are in `core/shared/tabs.ts` (`tabBar`, chrome width a parameter) for both hosts. |
| Files tab (tree, status, shimmer, follow, preview, mention, open) | built | not built | 0.1 (Tasks 11, 16) | Claude Code: `hosts/claude-code/{files.tsx,activity.ts,theme.ts}`. Listings, the file list and the current preview are read-through caches in the adapter; tool writes, shell commands (a full refresh) and `classic.FileChanged` on the watched git index and HEAD drop them, after 300 ms of quiet and at most 1.5 s into a burst. Shimmer uses the 16-color 3-step form (theme keys cannot be mixed). Esc is the host's (ADR 0009). |
| Git tab: repository row, Changes, commit, generated message | not built | not built | 0.1 (Tasks 12, 17) | |
| Diff view | not built | not built | 0.1 (Tasks 12, 17) | |
| Git tab: Graph, commit actions, agent markers | not built | not built | 0.2 | |
| Git tab: Branches | not built | not built | 0.2 | |
| Search tab and Quick Open | not built | not built | 0.3 | |
| Symbols tab | not built | not built | 0.4 | OpenCode approximate only until an LSP API exists. |
| File operations in Files | not built | not built | 0.5 | |
| Manual QA checklist, README, release pipeline | not built | not built | 0.1 (Task 18) | |

## Tech debt

Add one row per item, newest first, and delete the row when it is fixed.

| Date | Area | Issue | Severity (low, medium, high) |
| --- | --- | --- | --- |
| 2026-10-19 | Files (Claude Code) | Whether arrow keys raise `ui.scroll` or walk the focus ring in a pane whose tree fits is unverified (the kit never paints); both are handled. Check in manual QA (Task 18). | low |
| 2026-10-19 | Files (Claude Code) | The preview's `Can't read this file: …` state has no kit test: every host read fails closed before it, so no fixture reaches it. | low |
