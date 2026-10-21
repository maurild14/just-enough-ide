# Search inside Files

> Purpose: integrate explicit Search into Files while preserving keyboard navigation and retained state · Status: current · Last reviewed: 2026-10-20

Status: superseded by 0026

## Context

Search needs a clearly outlined input above the project name in Files. A separate tab and searches triggered by every keystroke make returning to the tree harder.

## Decision

- The tab bar is Files (`1`), Symbols (`2`), Git (`3`). Search, Quick Open and replacement review are nested Files views. `/jei search` remains an alias; retained Search-tab stacks migrate under Files. Legacy `defaultTab: search` falls back to Files.
- Files keeps an accent-colored search field above its project header. Tall panes draw a complete outline; short panes keep its side borders and prioritize a result/tree row. Files `s` focuses the field. Typing edits a draft; Enter commits the query and starts Search. Search flags and replacement safety remain available.
- Up/Down keeps the selected result visible; Enter previews its source line. Back returns to the selected result, then to the retained Files tree. Search `f` edits the query and `b` returns to Files; `q` retains Quick Open. Clear or an empty literal submission clears the query/results and restores Files. Native editing keys remain owned by the input.
- Previews from Search/Symbols no longer overwrite the Files selection. OpenCode keeps the Files component alive while its Search views are shown, retaining expanded folders, filter and viewport. Claude keeps its existing tree state and selection-anchored windows.
- This revises the four-tab layout and typing-triggered Search in the PRD and ADRs 0019, 0022 and 0024. Claude's host-reserved Esc and all destructive confirmations remain unchanged.

## Consequences

Both adapters share the three tab bindings and navigation reducer. Tests must submit queries explicitly. Native renderer/kit checks cover widths 24/40/80/120, short panes, streaming, stale replies, source preview, Clear and selection restoration; physical terminal focus and paint remain release QA.
