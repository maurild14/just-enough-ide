# 0010. Bind sensitive commit approval to exact paths

> Purpose: records the decision to enforce sensitive commit approval at the server boundary · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

The OpenCode TUI can confirm a commit while the agent continues changing the repository. Rechecking a plan in the TUI cannot prevent another sensitive path from appearing before the server reads its fresh status. An approval flag cannot tell the server which paths the user actually saw.

## Decision

The commit RPC requires `approvedSensitive: string[]`, containing the exact paths approved in the confirmation dialog. The server validates the list, creates its fresh commit plan and refuses before any `runSteps` call unless every current sensitive path occurs in that list. Comparison is literal: no trimming, case folding, glob matching or normalization expands an approval.

On refusal, the TUI requests a fresh plan and shows its complete sensitive list. It may send one retry only after the required confirmation; cancel sends no retry. The existing busy guard covers the complete sequence. A new refusal stops the attempt with an error and preserves the draft.

## Consequences

This changes an unreleased RPC input, so the schema, TUI, registered server and fixtures change together. Normal commits send an empty list. Core Git planning and Claude Code remain unchanged. A real registered-server/temp-repository regression verifies that approval for `.env` cannot authorize a newly arriving `id_rsa`, and that refusal neither stages nor creates a commit.
