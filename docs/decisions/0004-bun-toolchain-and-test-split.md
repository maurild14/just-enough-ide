# 0004. Bun toolchain and the spec/test split

> Purpose: records the decision "Bun toolchain and the spec/test split" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

Claude Code's `claude plugin test` loads every `*.test.ts` in the plugin folder. OpenCode and `core/` tests need a general runner with a fast loop.

## Decision

Bun is the dev toolchain and runs `*.spec.ts(x)` for `core/` and `hosts/opencode/`. `*.test.ts(x)` are reserved for `hosts/claude-code/` and run by `claude plugin test`. The two patterns are never mixed. Specs may import `bun:test` and `node:*`.

## Consequences

Contributors need Bun and, for the Claude Code half, the `claude` CLI. A misnamed file silently moves to the wrong runner, so the naming rule is in `AGENTS.md` and `docs/testing.md`.
