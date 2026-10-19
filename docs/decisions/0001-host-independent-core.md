# 0001. Host-independent core

> Purpose: records the decision "Host-independent core" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

JEI must run on Claude Code, whose mods have no Node, DOM, WebAssembly or eval, and on OpenCode, whose plugins run on Bun or Node. Only pure TypeScript runs in both.

## Decision

All logic that is not drawing or talking to a host lives in `core/`: parsers, layout, ranking, the key map, pane state and view models. `core/` imports nothing from either host and uses only ECMAScript built-ins. It receives a small `Host` interface (run a process, list/stat/read files, complete with a model) and returns plain data. UI actions stay in each adapter.

## Consequences

Most tests are fast pure specs under `bun test`. Adapters stay thin. Some code is more indirect than a direct host call would be. A lint-like review of imports in `core/` is part of every change.
