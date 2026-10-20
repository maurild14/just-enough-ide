# Colored history and shared back navigation

> Purpose: revise history row anatomy, section order and one-level navigation on both hosts · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

The single accent, hash-first history rows and Graph below working changes made history hard to scan. Claude Code reserves Esc for returning focus to the prompt, and its previous clickable path headers disappeared at short heights. Comparisons shared the Branches view, so returning from them could lose the parent selection or skip a level.

## Decision

- Graph precedes Staged and Changes in the existing scroll window. Its header remains selectable and collapsible, including with a full 200-commit page. Existing commit controls and working-file actions keep their behavior; empty or failed history retains the working selection by default.
- Shared `graphLine` returns fitted semantic spans, using the existing actual-cell lane budget and `fitGraph`'s source offset. Lane colors follow the original stable lane column through connector rows and clipping. Shared `branchLine` gives Branches names the same current/local/remote roles while retaining the current marker and muted tracking counts. Host theme mappings provide the palette; views add no RGB or ANSI literals. The quiet single-accent rule has this history-only exception.
- Rows show lanes, an optional agent marker, explicit `[HEAD]`, `[local name]`, `[remote name]` and `[tag name]` badges when space permits, subject, optional author/time, and a seven-character hash aligned to the final content column. Badge fitting reserves subject space; metadata appears only when the complete subject fits. Narrow rows truncate the subject and retain the hash. Display spans sanitize control characters without changing commit data used by actions. Selected rows use the host's readable selection foreground rather than colored labels. Text and glyphs retain meaning when colors are unavailable.
- `q` is the shared Back key from `core/keys.ts`. OpenCode retains Esc as an alias; Claude Code keeps Esc reserved for the prompt. Each pane shell supplies a visible Back control using the same action as the shortcut, with its own row so short panes retain tab and action keys. Inline name editors and confirmations retain their explicit Cancel control; modal cancellation keeps host semantics. Editable filters and messages receive a typed `q` without navigation.
- Comparison files use `git.compare` on the existing pane stack. Back returns diff → comparison → Branches → Git one level at a time, retaining each view's selection. Files preview returns to its existing filtered list; backing out of that filter closes it. Filters remain editable at five rows, and width changes recompute the viewport.

This supersedes ADR 0014's graph anatomy/order and header-only return, and ADR 0009's header-or-tab-only JEI return. Their attribution and host-reserved Esc decisions remain in force. ADR 0016's cell budget, Sync and opener contracts are unchanged.

## Consequences

Back consumes one body row in nested panes while tab and hint controls remain available. At five rows, historical diffs retain a path row and one content row. Low-priority badges and metadata can disappear as the pane narrows. The palette cycles through a finite set of existing host tokens; unrelated lanes may share a color, while topology and ref-kind words remain explicit. No new option, dependency, Git operation, network action or external configuration is introduced. Renderer and kit assertions cover widths 24/40/80/120 and five rows; live themes, clipboard, agent hooks and other operating systems still require release QA.

Final follow-up clarification: the observed OpenCode default action-primary foreground equals base text. Lanes therefore cycle feedback info/success/warning, with info for HEAD/current/agent, success for local and warning for remote; tags retain primary and explicit labels. Claude retains its existing semantic palette. Equivalent role intent does not guarantee distinct hues in every custom theme. Selected rows retain the normal selection foreground. Working mutations keep selection in remaining working rows rather than jumping above them into history. Claude's separate Back row is suppressed below four total rows to bound the layout while retaining tabs/hints; an active Files filter may occupy the entire body at three/four rows, and its visible f Button still closes filtering. Five-row Back and result coverage remains mandatory.
