# 0030: Native editing and activity rows

> Purpose: retain native keyboard ownership and make recent agent activity visible on selected Files rows · Status: current · Last reviewed: 2026-10-21

Status: accepted

Date: 2026-10-21

## Context

Claude's native focus ring survives independently of pane selection. Returning to Files can place it on the first input. Asynchronous state redraws can also overwrite newer native typing with an older controlled value. Short editor lists lack the overflow needed to route arrows through JEI. The previous selected-row shimmer rule leaves only a small gutter dot visible when followAgent selects the active file.

## Decision

Restore native Files focus to the retained selected row after Back, tab return and inline operation completion/cancel. While a filename or Search editor has results, keep native arrow routing active even when the list fits. Keep each native input's rendered seed stable during editing; persist whole input events separately and use the submitted native text as authoritative. Blur/submit and programmatic clear/generation release or replace that seed. Apply this to commit, filename, Search, replacement and branch inputs. OpenCode's synchronous reactive native inputs retain their existing behavior.

Files activity colors the complete name area, including icon, indentation and padding, on selected and unselected rows. The Git status letter keeps its status color. Active descendants give their containing folders a softer tint, using the most recent eligible touch. Read is purple, write orange and Git green, resolved in the host theme layer. The existing two-second fade and session gutter marker remain; inherited folder tints expire entirely. Selection remains visible through the native focus indicator/background and bold text. This supersedes the selected-row exception in the design guide. Activity filtering and followAgent navigation remain independent.

Known path operands carry active tool counts from start through completion; overlapping tools keep the glow until the last completion, then the two-second fade begins. OpenCode carries optional active counts in snapshots and start/finish flags in activity events, retaining old touch-only events. Claude resets stale active counts at session/root entry. Result-only paths begin glowing when reported. Explicit Git file operands are classified without treating branch names or commit messages as paths.

Read-only directory metadata failures keep successfully read entries. Failed listings are eligible for the next refresh rather than every drawing. Rejected history promises are evicted; recognized process/transport cancellations are silent, while ordinary Git failures remain visible.

## Verification

Native kit regressions cover input seeds, selected-row focus targets, short-editor arrow routing and canceled history recovery. Core checks exercise real Git hook overrides and aborted ignore checks. OpenTUI checks cover equivalent keyboard flows, cancellation recovery and activity styling across widths and themes. Physical terminal focus and paint still supplement these checks.
