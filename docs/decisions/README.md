# Decisions

> Purpose: the format and index of JEI's architecture decision records (ADRs) · Status: current · Last reviewed: 2026-10-21

An ADR records one decision that changes a rule or a structure, so a later reader (human or agent) knows why. Source: `PRD.md` §13 (decisions log).

## Rules

- File name `NNNN-kebab-title.md`, numbered in order and never reused.
- Each file has the standard docs header line, then a `Status:` line (`proposed`, `accepted` or `superseded by NNNN`), then `Context`, `Decision` and `Consequences`.
- ADRs are append-only. To change a decision, write a new ADR and mark the old one `superseded by NNNN`; do not rewrite history.
- Any change to a rule in `AGENTS.md` or `docs/` needs an ADR in the same commit.

## Index

| No. | File | Decision |
| --- | --- | --- |
| 0001 | `0001-host-independent-core.md` | Host-independent core |
| 0002 | `0002-two-hosts-one-repo.md` | Two hosts in one repository |
| 0003 | `0003-opencode-2x-only.md` | OpenCode 2.x only |
| 0004 | `0004-bun-toolchain-and-test-split.md` | Bun toolchain and the spec/test split |
| 0005 | `0005-zero-runtime-deps-no-build.md` | Zero runtime dependencies and no build step |
| 0006 | `0006-hooks-aware-commit-on-claude-code.md` | Hooks-aware commit on Claude Code |
| 0007 | `0007-release-please-and-npm-trusted-publishing.md` | release-please and npm trusted publishing |
| 0008 | `0008-agents-index-and-docs-system-of-record.md` | AGENTS.md and CLAUDE.md as an index over docs/ |
| 0009 | `0009-esc-is-host-reserved-on-claude-code.md` | Esc is reserved by the host on Claude Code |
| 0010 | `0010-exact-sensitive-path-approval.md` | Sensitive commit approval names exact paths and is enforced by the server |
| 0011 | `0011-git-history-core-contracts.md` | History reads, conservative tool attribution, graph cell budgets and contextual branch keys |
| 0012 | `0012-git-history-evidence-and-state.md` | Stable graph lanes, verified empty history, creation actions and retained diff migration |
| 0013 | `0013-safe-branch-and-commit-actions.md` | Fresh action confirmation, exact branch refs, comparison counts and credential-free URLs/errors |
| 0014 | `0014-native-history-views-and-attribution.md` | Native history paging, contextual action visibility, full-interval attribution guards and host API limits |
| 0015 | `0015-opencode-history-rpc-and-native-dialogs.md` | OpenCode session-aware RPC, pinned comparisons, native dialogs and installed schema/clipboard limits |
| 0016 | `0016-history-cell-budgets-and-action-reachability.md` | Actual graph cell budgets, reachable Sync and established URL-opener semantics |
| 0017 | `0017-colored-history-and-shared-back-navigation.md` | Semantic history colors, final aligned hashes, Graph-first order and shared Back navigation |
| 0018 | `0018-safe-sync-review-recovery.md` | Prompt-only recovery for a missing Claude Sync review, retaining hooks, permissions and pending work |
| 0019 | `0019-search-streams-and-safe-replace.md` | Streaming search, bounded first-occurrence fallback, safe replacement and preview origins |
| 0020 | `0020-native-search-paths-and-zero-width-fallback.md` | Native literal filename boundaries and verified zero-width fallback matches |
| 0021 | `0021-native-search-symbol-controls-and-path-evidence.md` | Native Search controls, marked previews and canonical path evidence; Symbols portions superseded by ADR 0027 |
| 0022 | `0022-opencode-search-symbols-and-review-state.md` | Session-scoped OpenCode streams, stored replacement review and marked source targets; Symbols portions superseded by ADR 0027 |
| 0023 | `0023-bounded-search-and-complete-replacement-review.md` | Estimated retention budgets and complete replacement review |
| 0024 | `0024-focus-and-arrow-navigation.md` | Arrow-safe commit mode, input blur and unchanged selection handling |
| 0025 | [Search inside Files](0025-search-inside-files.md) | Superseded by ADR 0026: earlier Search-inside-Files placement. |
| 0026 | [Separate filename and content search](0026-filename-and-content-search.md) | Live filename search, content Search tab, spaced controls and Symbols retirement. |
| 0027 | [Remove Symbols and exact replacement](0027-remove-symbols-and-exact-replacement.md) | Remove compatibility, use ordinary unknown-value defaults, replace exact literal text and correct minimum history-editor heights. |
| 0028 | [Safe Files operations](0028-safe-files-operations.md) | Literal mutations, captured canonical evidence, fixed PowerShell programs, server-owned plans and native confirmation. |
| 0029 | [Canonical filesystem identity](0029-canonical-path-identity.md) | Separate lexical aliases from exact canonical metadata containment across Files, preview, Search and Replace. |
