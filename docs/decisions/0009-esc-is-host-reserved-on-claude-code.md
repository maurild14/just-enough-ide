# 0009. Esc is reserved by the host on Claude Code

> Purpose: records the decision "Esc is reserved by the host on Claude Code" · Status: current · Last reviewed: 2026-10-19

Status: accepted

## Context

`core/keys.ts` gives every view an `esc` (back) key, and the rule is that keys are identical on both hosts. A Claude Code pane gets keys only through its `Button`s' hotkeys (one letter or digit), and Esc never reaches a pane: the host uses it to hand the keyboard back to the prompt. A letter key also works only while the Button carrying it is drawn.

## Decision

On Claude Code, Esc keeps the host's meaning (back to the prompt), and JEI does not list it in that host's hint line. Going back from a nested view (the Files preview, and later the diff view) uses the view's header row, a plain `Button` keyed `back` that Enter or a click presses, or the tab's digit (`1` returns to the Files tree). The letter keys are hotkeys on the hint line's Buttons. A view with letter actions therefore keeps its hint line, bare below 10 rows, and drops it only below 3 rows. OpenCode keeps `esc` as back.

## Consequences

This is the one key difference between the hosts, and `PRD.md` §13 lists it. The design rule "below 10 rows hide the hint" has a Claude Code exception for views with letter actions (`docs/design.md` §6). Manual QA checks back navigation by header and digit on Claude Code.
