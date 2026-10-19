# 0003. OpenCode 2.x only

> Purpose: records the decision "OpenCode 2.x only" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

OpenCode's 1.x line has no `session.panel` slot, only a narrow sidebar slot, so it cannot host JEI's pane. The 2.x plugin API is new and evolving.

## Decision

JEI targets OpenCode 2.x, minimum 2.0.32 (the verified version). The 1.x line is out of scope. The package's exported types are the contract; CI type-checks against the latest release.

## Consequences

Users on 1.x cannot use JEI. The adapter stays thin so API changes in 2.x stay local. The minimum version is raised only when a needed API appears.
