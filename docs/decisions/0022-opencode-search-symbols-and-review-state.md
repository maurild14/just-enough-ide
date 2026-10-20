# OpenCode Search, Symbols and review state

> Purpose: record native OpenCode 0.3 RPC, review ownership and source-target behavior · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

OpenCode separates the TUI and server, and RpcCallContext has no session identity. A failed whole-batch replacement would discard already-written counts. Nullable outlines alone cannot distinguish unsupported files from a selected directory. Five-row Search/Symbols views require room for editors, source labels, selected rows and hints.

## Decision

- Stateful Search/replacement requests and search events carry sessionID. The server derives the root and scopes current runs/plans by session and root. Search publishes at 200 matches or 100 ms, cancels its predecessor in that scope and suppresses obsolete batches/done. Cleanup clears timers, cancels streams and awaits their completion before RPC disposal. A searchStart RPC signal is not the lifetime of its already-started stream.
- Every portable object and nested query is closed. Handlers independently validate fields, names, paths and complete replacement subsets before mutation. Recursive outlines use top-level `$defs`; unsupported JSON Schema patterns remain absent. TUI replies are narrowed and canonical relative paths are checked syntactically without guessing the remote OS. Native and realpath checks use the server Host's actual platform.
- replacePlan stores actual reviewed snapshots and returns planId/files/skipped. replaceApply accepts only that scope's planId and exact selected paths, applies them in requested order, and returns written/skipped plus optional error after a later operational failure. It stops at the first exception, retains unapplied files and emits changed even when a failed write may have altered data. Known written paths alone determine successful counts. Confirmation never silently rebuilds a different plan.
- outline returns required file:boolean with nullable nodes. A confined regular unsupported file remains selected with null nodes; a directory or missing file allows latest-touched fallback. Supported-file read failures are explicit. Outgoing accepts only rel/line and resolves the node from current server source.
- Installed plugin/client/protocol 2.0.32 exports no LSP query domain. Client `lsp` configuration is not a query API. OpenCode lists and call sections always say approximate; no tool-executor/configuration workaround is introduced.
- Search/Symbols retain fitted hints from five rows, superseding ADR 0015's Git-only exception. Active editors hide the extra Back row and expose Cancel, preserving a selected row. Submit/Cancel leaves editing; letters/digits remain text while editing. Session memory retains queries/results/selection through preview Back, while work is canceled on unmount/project/session changes.
- Native Search events must match the current location before data parsing, as serials can collide across project roots. Compact mention/Apply file controls retain their last selected data subject and resolve activation once. Quick Open retains candidates with their invalidation revision in session/project memory; each new Pane lifetime invalidates that scope once to cover changes missed while closed. Failed refreshes report an error even when cached candidates remain visible.
- Preview routing follows currentView and the shared rel/line target. Preview actions retain canonical wire paths, including POSIX colon names; reused server preview/open boundaries validate with the actual Host platform. Ordinary OpenCode previews keep native wrapping/tables. Explicit line targets use a bounded native source window without wrapping, with a gutter marker beside the actual clamped source line, including Markdown/CSV/TSV. This narrows the general wrapping rule only for explicit targets; scrolling and resize retain the source position.

## Consequences

No dependency, option, release or settings change is needed. SessionID provides state isolation, not authenticated caller proof. Replace retains the Host's non-atomic final check/write window. Renderer/service tests and a disposable live smoke cover distinct surfaces; broader live resize, themes, actual provider hand-off, Claude positive LSP and other operating systems remain release QA.
