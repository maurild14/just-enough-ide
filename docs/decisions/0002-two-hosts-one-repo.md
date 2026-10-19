# 0002. Two hosts in one repository

> Purpose: records the decision "Two hosts in one repository" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

Developers use Claude Code or OpenCode. Shipping them as separate projects would let features and behavior drift apart.

## Decision

Claude Code and OpenCode ship from the first release, from one repository with the same features, keys and behavior. The repo root is both the Claude Code plugin and the `opencode-jei` npm package. A feature lands on both hosts or on neither. Keys are the same single letters and digits on both, in one key map.

## Consequences

Every feature costs two adapters and two sets of views. The release checklist covers both hosts. Where a host lacks an API, the difference is recorded in `docs/hosts.md` and `PRD.md` rather than diverging silently.
