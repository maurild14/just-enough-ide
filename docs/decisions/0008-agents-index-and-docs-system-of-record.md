# 0008. AGENTS.md and CLAUDE.md as an index over docs/

> Purpose: records the decision "AGENTS.md and CLAUDE.md as an index over docs/" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

Agents work better from a short map than from a long instruction file, and each Claude Code session starts without memory. Tools read `CLAUDE.md` (Claude Code) or `AGENTS.md` (others). Symlinks break on Windows clones.

## Decision

`AGENTS.md` and `CLAUDE.md` are two real, byte-identical files of at most 150 lines that index into `docs/`, where all in-depth documentation lives and is the system of record. `AGENTS.md` is edited and copied with `bun run sync:agents`. `bun run check:docs` fails on a difference, a broken link, an unindexed doc or a missing header. `@imports` are not used, so docs load on demand.

## Consequences

Every change that alters structure, commands or conventions updates the matching doc in the same commit. Docs carry a `Last reviewed` date and a `Status` so unbuilt parts are visible. Contributors must remember to run `sync:agents`; the check catches a miss.
