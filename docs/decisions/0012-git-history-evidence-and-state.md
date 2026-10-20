# Git history evidence and retained state

> Purpose: preserve graph topology, verify empty attribution baselines and retain working diffs across v0.2 reloads · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

Review found that compacting a middle graph lane could draw a passing continuation as a parent junction, while a crossing and an extra parent could produce identical cells. A supplied null HEAD was also treated as proof of unborn history without reading Git. Retained v0.1 working diffs have no source discriminant, standard merge/completion reflog forms were omitted, and ordinary apostrophes were parsed as quote delimiters.

## Decision

This supersedes ADR `docs/decisions/0011-git-history-core-contracts.md`; its other contracts remain in force.

- Keep middle lane vacancies until reused; remove only trailing vacancies so unrelated live lanes never shift through a parent stem. `GraphRow.lanes` includes vacant columns, drawn as spaces. A horizontal line passing a live vertical continuation without an edge endpoint uses `╳` (ASCII `x`); an actual parent junction uses the existing box junction (ASCII `+`). Both crossing glyphs occupy one terminal cell. This makes the reviewed octopus parent sets and an added parent at an intermediate crossing distinguishable.
- An empty reflog boundary requires a symbolic local-branch HEAD, an unresolved HEAD, and no HEAD reflog. Recheck HEAD after the history check to reject a commit racing capture. Failure or unavailable evidence returns null; a caller's stale null is never sufficient proof. Ordinary full-hash boundaries retain their existing rules.
- Expand creation actions to Git's `commit (merge)`, `commit (cherry-pick)`, `commit (rebase)` and `merge <targets>: Merge made by ...` forms. Fast-forward merge movement remains excluded. Real-Git regressions cover direct and manually completed merges, manual cherry-pick completion, rebase continuation and fast-forward refusal; pure grammar tests cover every added form. Git 2.52.0 `builtin/commit.c`, `cmd_commit()`, lines 1725-1766 (reflog action selection), defines the completion forms.
- `normalizePane` is a pure shared migration from v0.1 `{ path, staged, untracked }` diffs to working sources. It preserves the stack, tab, selections and flags, keeps modern states unchanged and does not mutate stored input. Claude reads and updates normalize before consumption; OpenCode normalizes memory reads at panel load and command handling. Migration does not write during drawing.
- Quotes delimit values only in supported `author:`, `path:` and `branch:` tokens. Ordinary message words retain their punctuation, including apostrophes; the remaining words still join with spaces into a literal fixed-string filter.

## Consequences

Graph width can retain vacant columns longer, but fitting still clips by real terminal cells. Crossing glyphs need a documented distinction from parent junctions. Verified unborn baselines require additional bounded local reads. Existing working diffs survive reload without a session-state version or new configuration. Attribution remains conservative about custom actions, concurrent tools and unavailable evidence; live-host and cross-platform QA remain separate checks.
