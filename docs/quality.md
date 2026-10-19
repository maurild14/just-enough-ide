# Quality

> Purpose: what is built, what is not, and the known tech debt, per area · Status: current · Last reviewed: 2026-10-19

Update a row in the same commit that changes the area. `git log` is the history; this table is the current snapshot. States: `not built`, `partial`, `built`, `built (debt)`.

## Status by area

| Area | Claude Code | OpenCode | Planned for | Notes |
| --- | --- | --- | --- | --- |
| Repo scaffolding, CI scripts | built | built | 0.1 (Tasks 1, 2) | Bootstrap done; CI workflow, Dependabot, issue forms and PR template added (Claude Code CI job non-blocking). |
| `core/` foundations (Host, options, keys, paths, argv, fuzzy) | built | built | 0.1 (Task 3) | Shared by both hosts. Keys cover Files, Git and diff; Search and Symbols carry navigation only. |
| Git runner, status, diff parsing, commands | not built | not built | 0.1 (Tasks 4-6) | |
| Files model, activity, refresh guard, pane state | not built | not built | 0.1 (Tasks 7-9) | |
| Pane shell, tabs, hint line, `/jei` | not built | not built | 0.1 (Tasks 10, 15) | |
| Files tab (tree, status, shimmer, follow, preview, mention, open) | not built | not built | 0.1 (Tasks 11, 16) | |
| Git tab: repository row, Changes, commit, generated message | not built | not built | 0.1 (Tasks 12, 17) | |
| Diff view | not built | not built | 0.1 (Tasks 12, 17) | |
| Git tab: Graph, commit actions, agent markers | not built | not built | 0.2 | |
| Git tab: Branches | not built | not built | 0.2 | |
| Search tab and Quick Open | not built | not built | 0.3 | |
| Symbols tab | not built | not built | 0.4 | OpenCode approximate only until an LSP API exists. |
| File operations in Files | not built | not built | 0.5 | |
| Manual QA checklist, README, release pipeline | not built | not built | 0.1 (Task 18) | |

## Tech debt

Empty. Add one row per item, newest first, and delete the row when it is fixed.

| Date | Area | Issue | Severity (low, medium, high) |
| --- | --- | --- | --- |
