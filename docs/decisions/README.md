# Decisions

> Purpose: the format and index of JEI's architecture decision records (ADRs) · Status: current · Last reviewed: 2026-10-19

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
