# 0006. Hooks-aware commit on Claude Code

> Purpose: records the decision "Hooks-aware commit on Claude Code" · Status: current · Last reviewed: 2026-10-19

Status: accepted

Permission-guidance amendment: ADR `0018-safe-sync-review-recovery.md` supersedes the broad shell-permission suggestion below. JEI explains normal host review and offers prompt-only recovery for Sync's verified missing-review refusal; hook routing stays accepted.

## Context

On Claude Code, `$.process.run` runs git with repository hooks off, so pre-commit, commit-msg and similar hooks do not fire. On OpenCode git is a normal process and hooks fire.

## Decision

JEI detects whether a repo uses hooks (`core.hooksPath`, non-sample files in `.git/hooks`, `.husky/`, `lefthook.yml`, `.pre-commit-config.yaml`, Git LFS). With no hooks, hook-firing operations run directly. With hooks, they run through Claude Code's shell tool via `$.tool.call`, after `$.tool.check`, and the pane says why. Read-only commands always run directly.

## Consequences

The Claude Code commit path has two modes and a hook marker in the repository row. A permission prompt may appear; the pane suggests allowing `Bash(git *)`. OpenCode needs nothing special.
