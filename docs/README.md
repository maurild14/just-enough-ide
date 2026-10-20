# JEI docs index

> Purpose: the map of everything written down about JEI; start here · Status: current · Last reviewed: 2026-10-20

These docs are JEI's persistent memory. `AGENTS.md` (identical to `CLAUDE.md`) is the short entry point; everything in depth lives here. If code and docs disagree, fix one of them in the same change. `bun run check:docs` verifies links, this index and the headers.

Every file starts with a `> Purpose … · Status: current|draft · Last reviewed: <date>` line. `draft` means the described part is designed but not built yet, and the doc says which milestone builds it.

| Doc | Purpose |
| --- | --- |
| `PRD.md` (repo root) | Product requirements and technical spec: behavior, keys, options, milestones, decisions log. Authoritative on behavior. |
| `docs/architecture.md` | Core/host split, the `Host` interface, data flow per host, dependency rules, file map. |
| `docs/conventions.md` | TypeScript style, imports, errors, the argv and git-invocation rules, UI copy, commits. |
| `docs/testing.md` | The two test runners and their naming split, fixtures, the fake host, width matrix, manual QA. |
| `docs/design.md` | Visual and responsive design guide: color roles, glyphs, layout grid, widths, resize, states. |
| `docs/hosts.md` | Verified API facts and limits of Claude Code mods and OpenCode 2.x plugins. |
| `docs/security.md` | Privacy model, secret handling, repository hygiene, how to report a problem. |
| `docs/quality.md` | Per-area status table and the tech-debt list. |
| `docs/qa.md` | The manual QA checklist run on both hosts before every release. |
| `docs/decisions/` | Architecture decision records (ADRs); see `docs/decisions/README.md` for the format and the list. |
| `docs/decisions/0010-exact-sensitive-path-approval.md` | Exact approved sensitive-path lists across the OpenCode commit RPC. |
| `docs/decisions/0011-git-history-core-contracts.md` | Git history reads, tool attribution, graph cell budgets and contextual branch keys. |
| `docs/decisions/0012-git-history-evidence-and-state.md` | Stable graph topology, verified empty history and retained working-diff state. |
| `docs/decisions/0013-safe-branch-and-commit-actions.md` | Fresh branch/action validation and confirmation, comparison counts and credential-free URLs/errors. |
| `docs/decisions/0014-native-history-views-and-attribution.md` | Native history presentation, contextual actions, mutation attribution guards and verified host limits. |
| `docs/decisions/0015-opencode-history-rpc-and-native-dialogs.md` | OpenCode session-aware history RPC, pinned comparisons, native dialogs and installed schema/clipboard limits. |
| `docs/plans/` | Implementation plans, one per body of work (`YYYY-MM-DD-slug.md`). Checkboxes in a plan are not a status tracker; `git log` is. |

## Keeping docs current

- Change code and its doc in the same commit.
- Adding a doc: add a row above, and add it to the map in `AGENTS.md` (then run `bun run sync:agents`).
- Changing a rule: write an ADR first or alongside; ADRs are append-only and are superseded, not edited.
- Bump `Last reviewed` only when you actually re-read the doc against the code.
