# 0007. release-please and npm trusted publishing

> Purpose: records the decision "release-please and npm trusted publishing" · Status: current · Last reviewed: 2026-10-22

Status: accepted

## Context

Releases must be reproducible, versioned in step across `package.json` and `.claude-plugin/plugin.json`, and must not depend on a stored token.

## Decision

Conventional Commits feed release-please, which opens one release PR, updates `CHANGELOG.md` and bumps both versions together. Publishing `opencode-jei` runs from GitHub Actions through npm trusted publishing (OIDC): no npm token exists and provenance is attached automatically. The workflow stages each version (`npm stage publish`); it reaches the registry only after the maintainer approves it on npmjs.com with 2FA, and the trusted publisher is not allowed to publish directly.

## Consequences

Commit messages must follow Conventional Commits. The npm trusted publisher must be configured once by the owner on npmjs.com, and each release needs one manual approval there. Actions are pinned by SHA and use least-privilege permissions.
