# Native history views and attribution

> Purpose: reconcile v0.2 presentation drafts and record Claude Code history integration limits · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

The approved v0.2 task defines a more specific row anatomy and explicit paging than the original PRD/design drafts. Claude Code letter keys work only while their Buttons are drawn. Its tool wrapper also sees shell calls issued by JEI's own hook-aware Git runner, so invalidating a tracker once before a mutation cannot exclude a new window opened inside that mutation.

## Decision

- Graph is a collapsible section below Staged and Changes in their existing selection and scroll window. Rows show fitted lanes, an optional session agent marker, a seven-character hash, accent ref labels, subject, and author/relative time from 60 columns when they fit. Ref labels drop before subject cells; below 24 columns only hash and subject remain. Connector rows contain only the glyph. The section ends in an explicit Load more row, adding `graphLimit` commits per activation. This supersedes the draft graph row/drop-order and automatic-on-scroll paging rules.
- Fetch and filter are explicit contextual actions. Pull/push retain the existing Sync and Commit & Push paths. Merge revert is refused; other checkout/revert actions always ask. Branches groups locals before remotes and compares against the shared default base with immutable hashes. Historical diff headers identify the commit or comparison; the file path stays above the diff body.
- Working-file selection retains its six existing action Buttons. Graph commit selection substitutes `y/a/b/f/t/n`; other graph selection exposes its applicable actions. Expanded commit files, Checkout, Revert and supported web links are ordinary selectable rows in the same Git window. The Graph header exposes `b/f/t`. Every contextual key is derived from `core/keys.ts`, and its Button remains visible at 24 columns and five rows. Branches retains `n/c/f`, with a header Button for back. No key is silently added to a hidden native binding.
- Attribution uses documented `session.id()` plus repository root, JSON hashes in per-repository session state, immutable from-HEAD/reflog evidence and a token captured by each `tool.call` wrapper invocation. Register pending overlap before async evidence reads. A nested mutation guard spans the whole JEI operation and the hook-aware runner, including its own shell hook. Suppress ambiguous windows until cleanup in `finally`; bookkeeping failures cannot replace a tool result or rerun a failed tool. If session identity itself is unavailable at a mutation boundary, suppress attribution conservatively until that operation ends.
- Installed Claude Code declarations expose `watchPaths: string[]` but do not promise directory/recursive support. Keep watching HEAD/index; refs change by other tools refreshes on next snapshot. Every snapshot and JEI mutation invalidates history caches. Installed `ui.copy` reports `isCopied` or a closed failure reason and accepts the render surface; an OSC 52 success cannot prove that a terminal actually accepted the clipboard write.
- Native kit calls have no real process implementation underneath plugins, and the runtime has no Node/Bun. Host interaction tests script the service wire formats; real Git remains covered by the existing `test/fake-host.ts` service specs. Neither proves live terminal clipboard, focus, paint, themes or repository hooks.

## Consequences

The milestone is temporarily available on Claude Code while OpenCode's matching task remains pending; release parity is unchanged. Contextual hints preserve working shortcuts and keep all graph actions reachable in narrow panes. Explicit paging takes a deliberate activation. Concurrent windows or missing evidence can omit a marker, while an unrelated external commit inside a valid shell window remains indistinguishable. Live-host and cross-platform QA remain required before release. No new dependency, option or public API is introduced.
