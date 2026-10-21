# Focus and arrow navigation

> Purpose: keep pane navigation reachable after mode changes and input blur · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

Claude Code's focused Select owns Up/Down and keeps focus after a pick. The inline commit selector therefore traps the arrows above Graph and working changes. Search and Symbols retain an editing flag after focus moves to a tab, leaving tab hotkeys disabled. Repeated focus and boundary scroll also rewrite unchanged list selections, and Git/Branches can use a selection from the previous drawing.

## Decision

- Claude uses a Button for commit mode. Click or Enter cycles Only, & Push and Amend without committing. Arrows retain list navigation; Tab reaches message and action controls. Mobile keeps the full commit title. OpenCode retains its native modal chooser, which returns control to the message editor and exits through Esc or an arrow.
- Search and Symbols clear editing when focus leaves their input. Typed letters and digits remain text while the input holds focus; tab shortcuts resume on blur. Queries and results are retained.
- Files, Git and Branches skip unchanged selection writes. Files/Git request a redraw only when the focus indicator changes, and avoid refocusing the same row. Git selects only actual list IDs, so its graph-filter input cannot overwrite the selected row. Git and Branches read the current valid pane selection before moving, falling back to the displayed selection when a file disappears.
- Existing keys, Git validation, confirmation and host-reserved Esc behavior remain in force. This revises the inline commit-menu presentation described in the PRD and host guide.

## Native virtual-window boundary

A real Windows Claude Code 2.1.305 run reproduced the remaining failure: Down moved from the last drawn commit to Copy hash while more commits existed. Native arrows enter `ui.scroll` only when the rendered tree is taller than the host viewport. JEI's sliced lists fit that viewport, allowing the native focus ring to reach footer actions before a delayed selection redraw. Calling `ui.scroll` directly in the kit did not reproduce that routing decision.

Each view now reports whether its list, source or diff has undisplayed content. For those views only, the shared pane shell keeps its visible frame at exactly `bodyRows` and adds one empty, nonfocusable row outside that frame. The native scroll range therefore remains active while header, tabs and hints stay pinned. All JEI scroll events are consumed, including ignored editor/wheel events, so native offsets cannot move the frame. Lists that fit keep their natural inline height. Tab, clicks, letter shortcuts and host-reserved Esc retain their behavior. This applies to Files, previews, Search, Quick Open, replacement review, Symbols, Git, Branches, comparison and diffs; OpenCode already routes arrows through its shared key layer.

Search/Quick Open/Symbols editors also suppress the separate Back row at every height, matching OpenCode's existing behavior. Their own Cancel remains visible. Inserting Back above an input on focus shifted it under a live terminal mouse press and could leave the keyboard on Back instead of in the field.

## Verification

Native Claude tests cover mode cycling without commits, reaching working changes, tab hotkey recovery, repeated focus and boundary scroll, selection styling and the existing width/height matrix. Windowing regressions assert the host scroll-range contract, the fixed visible frame, crossings beyond the last drawn row, clickable hints and natural short inline height. OpenTUI tests click between tabs while editing and check restored shortcuts and arrow routing. Real-host verification supplements the kits; other operating systems, themes and release flows remain in `docs/qa.md`.
