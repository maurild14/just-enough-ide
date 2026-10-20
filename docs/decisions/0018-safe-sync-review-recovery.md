# Safe Sync review recovery

> Purpose: recover a Claude Code Sync request refused for missing auto-mode review without weakening authorization · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

Claude Code can refuse a hook-aware UI shell call because the model request did not ask for a server-side auto-mode verdict. A permission query does not create that review. Repeating the call or allowing a broader shell rule is not a verified remedy, and direct process execution would disable repository hooks.

## Decision

- The shared Claude runner recognizes only the verified missing-request refusal on denied/error channels, preserving the rejected and remaining steps in a non-GitError. Core Sync propagates it; subsequent steps stop. Ordinary denials, Git divergence/errors, background tasks and interruptions retain their existing behavior.
- Sync shows a separate pinned question with Ask Claude and Cancel. It retains the repository root, pending steps and an explicit merge/rebase choice. Completed steps are excluded. The question appears only in Git; hidden question state cannot consume Back in Branches or a diff. Cancel also carries the shared `q` key.
- Only Ask Claude checks the current cwd's repository root afresh and inserts a separated request into the existing prompt draft. The request asks Claude to inspect current state and finish pending work while preserving local work and normal hooks/permissions. JEI never submits it, retries the shell, switches runners or changes configuration. Failed fills/root checks retain the question; Cancel does no work. A changed root prevents insertion.
- Replace ADR 0006's broad shell-permission suggestion with a neutral explanation of normal host review. Hook routing itself stays unchanged. OpenCode uses its existing process path and needs no classifier-specific recovery.

## Consequences

The user reviews and sends the prepared request as a normal model turn. Later approval remains the host's decision; this recovery does not repair or override its classifier. Native kit tests cover denial channels, partial completion, prompt draft/failure, root changes and both surfaces at 24/40/80/120 columns and five rows. Live server review, actual prompt paint/focus and real hooks still require disposable-session QA.
