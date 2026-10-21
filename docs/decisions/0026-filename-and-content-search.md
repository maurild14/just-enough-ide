# Separate filename and content search

> Purpose: replace Symbols with content Search and make the Files field a live filename finder · Status: current · Last reviewed: 2026-10-21

Status: accepted. Supersedes ADR 0025's tab placement and filename-field behavior.

## Decision

- Tabs are Files (1), Search (2), Git (3). Both native Symbols views are retired. Old Symbols tab/config/command values migrate to Search; retained Search-under-Files stacks migrate to the Search tab. The core symbol and existing RPC contracts remain compatible.
- Files reuses its existing all-files filter. Input changes update results immediately, with basename prefixes first and forgiving fuzzy path matches afterward. Empty input shows the tree. s/f focuses the field; arrows leave editing and navigate results; Enter previews. Back restores query/selection. Clear restores original tree selection, expansion and viewport. Cancel leaves editing without clearing the query.
- Search keeps explicit Enter submission, streaming, include/exclude globs, one/all hand-off, Quick Open and reviewed replacement. Matching is always literal and case-insensitive, including retained sessions with old flags. Case/regex/word controls and shortcuts are removed. Clear stays on Search; b returns to Files.
- Both fields keep an accent outline above the project name, padded Cancel/Clear labels and a visible separator. Compact height uses side borders. Editors own letters/digits; list arrows and preview Back retain their current targets.

## Verification

Shared reducer/options/key/filter tests cover migration, tabs, fixed matching and prefix order. Native Claude kit and OpenTUI tests cover dynamic results without Enter, text ownership, separated controls, widths 24/40/80/120, compact heights, offscreen navigation, preview Back and original-tree restoration. Existing stream, wire validation and replacement checks remain required. Physical host focus/paint remains release QA.
