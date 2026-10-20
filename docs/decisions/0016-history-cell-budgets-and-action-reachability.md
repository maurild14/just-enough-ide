# History cell budgets and action reachability

> Purpose: correct host graph width units and preserve existing actions and opener semantics · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

The v0.2 host plan mixed lane counts and terminal cells. Passing `lanes` directly to `fitGraph` clips two-lane commits and even a single-lane merge's wider fork connector. Claude Code's contextual Graph hints also removed Sync below the 60-column repository Button threshold on a clean tree. Both URL adapters treated returned opener exit codes as failures, contradicting the established file-opener contract.

## Decision

- Both hosts pass `min(max(cellWidth(row.glyph), cellWidth(row.connector ?? '')), max(3, floor(inner / 4)))` cells to the shared `fitGraph`. Preserve the quarter-width cap; include the connector because fork rows can extend beyond the commit glyph. This corrects the plan/design lane-count formula while retaining ADR 0011's cell contract. Real merge-shaped host regressions use `M -> [A, B]`, `A -> P`, `B -> P`, asserting fork and side-lane content at 80 columns and fitting at 24.
- Claude non-commit Graph contexts (header, Load more, expanded files and actions) retain `b/f/t/e`. Commit rows retain `y/a/b/f/t/n`, and working rows retain their existing six actions. This supersedes ADR 0014's Graph-header hint list, keeping Sync reachable at 24/40 columns and five rows. OpenCode working hints omit commit-only copy/Ask/new-branch keys; its permanent key layer is unchanged.
- URL opening follows `openFile`: ignore a returned OS-opener exit code, but surface a thrown spawn failure. Windows Explorer can return nonzero after successful handoff. OpenCode still derives the credential-free supported URL on the server from the validated hash; no arbitrary URL RPC is added.
- History errors use the semantic error token with one trailing period; empty/loading copy is muted. Pending OpenCode commit details have one nonselectable static Loading row, preserving existing actions and navigation.

## Consequences

Correct topology occupies more cells, reducing subject space under the existing cap. Non-commit Claude hints add one Button while all applicable keys still fit at the required sizes. Nonzero-only opener failures cannot be distinguished from successful handoff; thrown spawn errors remain visible. Automated host regressions do not launch a browser and do not replace live clipboard, real hooks, focus/themes, terminal resize or cross-platform release QA. No dependency, option, process cache, attribution lifecycle change or release configuration is introduced.
