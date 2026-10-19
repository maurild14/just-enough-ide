# 0005. Zero runtime dependencies and no build step

> Purpose: records the decision "Zero runtime dependencies and no build step" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

Both hosts load TypeScript directly. Claude Code compiles the mod itself and OpenCode loads the TypeScript entries itself. Dependencies add supply-chain risk and install weight.

## Decision

JEI has no runtime dependencies and no bundler or build step. `@opencode/plugin`, `@opentui/core`, `@opentui/solid` and `solid-js` are optional peer dependencies and dev dependencies. Relative imports keep their `.ts` extension. TypeScript and `@types/bun` are dev only.

## Consequences

JEI writes small utilities itself (fuzzy ranking, CSV, argv splitting). Published files are the sources. Tree-sitter is out for v1 because mods have no WebAssembly.
