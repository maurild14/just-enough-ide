# 0007. release-please and npm trusted publishing

> Purpose: records the decision "release-please and npm trusted publishing" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

Releases must be reproducible, versioned in step across `package.json` and `.claude-plugin/plugin.json`, and must not depend on a stored token.

## Decision

Conventional Commits feed release-please, which opens one release PR, updates `CHANGELOG.md` and bumps both versions together. Publishing `opencode-jei` runs from GitHub Actions through npm trusted publishing (OIDC): no npm token exists and provenance is attached automatically.

## Consequences

Commit messages must follow Conventional Commits. The npm trusted publisher must be configured once by the owner on npmjs.com. Actions are pinned by SHA and use least-privilege permissions.
