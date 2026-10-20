# JEI design guide

> Purpose: how every JEI view looks and behaves at any pane size · Status: current · Last reviewed: 2026-10-20

Status: Files and Git views are built on both hosts. Claude Code Search, Quick Open and Symbols are built for 0.3; OpenCode integration remains draft. The PRD is authoritative on behavior; this guide is authoritative on visuals and responsiveness.

JEI is drawn in character cells. There are no pixels and no fonts to pick, and the colors come from the host. This guide covers how every view looks and how it behaves at any pane size. If a view breaks one of these rules, treat it as a bug.

## 1. Principles

1. **Text first.** Show names, letters and numbers. Glyphs add meaning only where text would cost more columns.
2. **Quiet by default.** Use one accent color outside Git history. Graph lanes, reference kinds and Branches names use a small semantic host palette to make topology and provenance readable (ADR 0017). Everything else that isn't selected, changed or active is plain or muted. Draw no boxes.
3. **Never break.** At any width or height, every line fits, nothing wraps and the selected row stays visible.
4. **Color is never the only signal.** Every colored state also has a letter, glyph or word, so `NO_COLOR` still works.
5. **Motion only means "the agent just did this".** The activity shimmer is the only animation.

## 2. Color roles

Views use semantic tokens only. No view contains a literal RGB, hex or ANSI color. Both hosts supply theme colors (dark and light). Claude Code maps roles in `theme.ts`; OpenCode's activity accent mapping lives in `colors.ts` and uses the resolved context theme. When a host gives no value for a token, the fallback is the ANSI 16-color name shown below, so the terminal palette still applies.

| Token | Used for | Fallback |
| --- | --- | --- |
| `fg` | Default text | default |
| `muted` | Secondary text: folders, line numbers, authors, times, hint line, empty-state copy, rules | bright black |
| `accent` | Active tab, focused field, primary action (Commit), match highlight | blue |
| `selection` | Selected row: background and foreground pair, full row width | reverse video |
| `added` | `A`, `+` counts, added diff lines | green |
| `removed` | `D`, `−` counts, removed diff lines | red |
| `modified` | `M`, `R` | yellow |
| `untracked` | `U` | green, dim |
| `conflict` | `C` | magenta, bold |
| `warning` | Detached HEAD, no upstream, results truncated, hook mode | yellow |
| `error` | Failed operations | red |
| `activity.read` | Shimmer for reads (purple) | magenta |
| `activity.write` | Shimmer for writes (orange) | yellow |
| `activity.git` | Shimmer for git actions (green) | green |

Graph lane indices cycle through existing host accents, preserving the original lane column through connector fitting. Claude uses `suggestion/success/warning/autoAccept/merged/claude` for lanes and `suggestion/success/autoAccept/warning` for HEAD-or-agent/local/remote/tag. OpenCode uses feedback `info/success/warning` for lanes and `info/success/warning` for HEAD-or-agent/local/remote; tags use action `primary`. Its default primary can equal base text, so primary is reserved for tags rather than the main lane or current branch. These mappings share semantic intent; user themes control actual hues and need not distinguish every role. Badges explicitly say `[HEAD]`, `[local name]`, `[remote name]` and `[tag name]`, so theme colors and `NO_COLOR` never carry their meaning alone. Selected graph rows use the host selection foreground instead of colored spans. The short hash is muted and ends at the final content column.

Branches names reuse HEAD/current, local and remote roles; their `*` marker and Remote heading retain provenance without color. Counts and `gone` remain muted. Selected branch names use the normal readable selection foreground.

Bold is allowed only for the active tab and conflicts. Never use italic, blink or underline for meaning, because many terminals drop them.

## 3. Glyphs

Graph node and lane glyphs occupy one cell; the configured ellipsis can occupy more (ASCII `...` is three). Measure terminal cells with the shared width helpers, because CJK names take 2 cells. Do not use emoji. Options remain `glyphs: auto | nerd | plain`; `auto` currently uses plain icons until Nerd Font detection exists. ASCII is a renderer fallback, not a public option. See `docs/decisions/0011-git-history-core-contracts.md`.

| Meaning | Plain Unicode | ASCII |
| --- | --- | --- |
| Folder collapsed / expanded | `▸` / `▾` | `>` / `v` |
| Git status | `M A D R U C` | same letters |
| Ahead / behind | `↑2 ↓1` | `^2 v1` |
| Branch | `⎇ main` (Nerd: `` ``) | `main` |
| Dirty branch | `main*` | `main*` |
| Agent commit | `✦` | `@` |
| Graph commit, line, fork | `● │ ─ ╭ ╮ ╰ ╯` | `* \| - / \ / \` |
| Touched this session | `•` | `.` |
| Ellipsis | `…` (1 cell) | `...` (3 cells) |
| Counts in Git rows | `+12 −3` (U+2212) | `+12 -3` |
| Separators (rule, hint line) | `─`, `·` | `-`, `-` |

Truncation always reads the ellipsis width from the active glyph set. Diff lines keep git's own `+`/`-` in every set.

Graph lane rows use `2 * lanes - 1` cells including separators. Pass a cell budget to `fitGraph`, reserving other row content first; clipped rows retain the commit cell whenever at least one cell fits, shift the visible lane window when needed and include the real ellipsis width. The final lone root has no connector row.

Middle lane vacancies remain blank until reused so live continuations do not shift through another stem. A crossing without a parent connection uses the one-cell `╳` (ASCII `x`); actual parent junctions use box junctions (ASCII `+`). See `docs/decisions/0012-git-history-evidence-and-state.md`.

## 4. Layout grid

```
1 Files  2 Search  3 Symbols  4 Git      tab bar      (pinned)
──────────────────────────────────────   rule, muted  (pinned)
 ⎇ main*  ↑1 ↓2                 Sync     header row   (pinned)
 ▾ src                             M     body         (scrolls)
•  ▸ api                           M
   user.ts                         A
 ↑↓ move · enter open · a mention · f filter   hint line (pinned)
```

- **Tab bar:** tabs are separated by 2 spaces. The active tab is `accent` and bold.
- **Rule:** a single `muted` horizontal line. It is the only border in JEI. Dialogs and confirms use one `muted` rule above them and no box.
- **Header row:** shows what the body is about. Files: root name and filter. Search: the query field and its toggles. Symbols: the file name and `LSP` or `approximate`. Git: the repository row. Diff view: file, source and +/−.
- **Gutters:** column 0 is the gutter. It shows the touched marker `•` in the activity color, otherwise a space. Keep 1 empty column on the right. Content never touches the right edge.
- **Indent:** 2 cells per tree level (1 cell below 32 columns). Indent stops growing at `floor(width / 4)`, so deeper levels share that indent.
- **Right-hand columns:** status letters, counts, +/−, line numbers and times are right-aligned. Each column's width is the widest value among the visible rows, so numbers line up. Columns have 1 space between them below 60 columns and 2 spaces from 60 up. The left text truncates first, and right-hand columns are never cut mid-value.
- **Groups (Git: Graph, Staged, Changes; Search: files):** a header row with a chevron, the name in sentence case and a right-aligned count, all `muted` apart from the chevron. Graph remains collapsible so even a full page leaves working changes reachable. There are no blank lines inside lists, and one blank line between Git sections only at heights of 24 or more.
- **Selection:** the `selection` pair fills the row from gutter to gutter. Only one row is selected per view.

## 5. Responsive rules (width)

These widths are pane widths, not terminal widths. Rows are rendered from a pure `layout(width, height, state)` function.

| Element | ≥100 (L) | 60–99 (M) | 32–59 (S) | <32 (XS) |
| --- | --- | --- | --- | --- |
| Tab bar | `1 Files  2 Search  3 Symbols  4 Git` | same | active tab named, rest numbers: `1 Files  2  3  4` | numbers only: `1 2 3 4` |
| Nerd icons | yes | yes | no | no |
| Files row | name, roll-up count, status | name, status | name, status | name, status; indent 1 |
| Git change row | `M` name, folder, `+12 −3` | `M` name, folder, `+12 −3` | `M` name, `+12 −3` | `M` name |
| Graph row | lanes, ✦, refs, subject, author/time, final hash | lanes, ✦, fitting refs, subject, author/time, final hash | lanes, ✦, fitting refs, subject, final hash | lanes, ✦, subject, final hash; below 24 subject/hash only |
| Repository row | repo, branch, ↑↓, `Sync` | branch, ↑↓, `Sync` | branch, ↑↓ | branch (↑↓ when it fits) |
| Search file row | path, count, timing in header | path, count | path, count | basename, count |
| Search match row | line no, match text | line no, match text | line no, match text | match text |
| Symbols row | kind word, name, line | kind word, name, line | kind letter (`f c m t v`), name, line | kind letter, name |
| Commit field placeholder | `Message (enter to commit on "main")` | same | `Message` | `Message` |
| Diff gutter | old and new line numbers | new line number | none | none |

**Drop order.** Graph badges reserve up to 12 subject cells and omit badges that cannot fit; author/time appears only when the complete subject fits beside them. The remaining subject truncates while the seven-character hash stays aligned at the end. Other rows drop author, hash, optional refs, folder, time, +/−, roll-up counts and the touched marker. Status letters, selection and names remain. ADR 0017 supersedes the earlier graph anatomy.

Graph uses `fitGraph` with a cell budget of `min(max(cellWidth(glyph), cellWidth(connector)), max(3, floor(inner/4)))`, treating an absent connector as empty. Include connector width because a fork can be wider than its commit row; connector rows contain only the glyph. Both hosts use plain Unicode graph cells with every current icon setting; ASCII remains the shared core fallback, not a new option. The Graph header is `▾ Graph` / `▸ Graph`, adding `(filtered)` for an active filter. Load more is an explicit selectable final row. Expanded files show status, fitted path and +/−, followed by selectable Checkout, Revert and a supported web link. Branches shows locals then a Remote header, current `*`, fitted name, aligned ahead/behind counts and `gone`. Comparison files appear under `Compared with <base>`.

Claude Code keeps the six working action hints on working rows and substitutes the six graph commit hints `y/a/b/f/t/n` on a selected commit. Stage, unstage and discard retain working-list context when their old row disappears: Claude selects the first remaining working file or group, and OpenCode selects the first working group. Graph is the fallback after no working rows remain. Non-commit Graph contexts (header, Load more, expanded files and action rows) supply `b/f/t/e`, retaining Sync on clean narrow panes; expanded action rows are reached with the shared arrows/Enter. This keeps every applicable shortcut Button visible at 24 columns. Branches keeps `n/c/f`; comparison files have their own view and selection, validated against the current file list. Both hosts label that view `Comparison`. The shell Back Button uses `q` on a separate row, outside the hint budget. Active history filters and the new-branch editor remain above the list viewport; confirmations replace editors until answered, preserving both answer Buttons at five rows. Historical diff headers identify the commit or comparison, and a path row sits immediately above the hunks. No browser animation or CSS applies to these character-cell views.

**Truncation.**
- Paths use a middle ellipsis that keeps the whole basename: `src/…/user.ts`. If the basename alone does not fit, it gets an end ellipsis that keeps the extension where possible: `very-long-na….ts`.
- Single names, commit subjects, branch names and messages use an end ellipsis: `fix: validate us…`.
- Search match text is centered on the first match, with an ellipsis on each side that was cut.
- Row data is never mutated: truncation exists only in the rendered string.
- Both hosts build the tab bar with `core/shared/tabs.ts` (`tabBar`): when a form does not fit, the gap shrinks to 1, then 0, before the labels shorten.
- Both hosts build these strings with `core/shared/fit.ts` (`cellWidth`, `fitEnd`, `fitPath`, `padEnd`), never with string length. Every result is at most the requested width in cells.

**Hint line.** Items are `key label` pairs in priority order, separated by ` · `. Drop the lowest-priority items from the end until the line fits; the hint never ends with a catch-all item. On OpenCode the longest labelled prefix that fits is followed, after ` · `, by the remaining keys bare (`c commit · g e esc`), and below 32 columns the hint shows only keys (`↑↓ enter a`). On Claude Code a letter key is a hotkey `Button`, and Esc is not listed because the host keeps it (back to the prompt; ADR 0009). A plain hotkey Button always draws `k: ` before its label and a letter key works only while its Button is drawn, so a letter key never shows as a bare `k: ` while anything else fits. The first form that fits wins: every label (`↑↓ move · enter open · s: stage · … · e: sync`); the navigation words bare (`↑↓ enter · s: stage · …`); no navigation words; the longest labelled prefix of letter keys, then the rest as keycaps after ` · ` (`s: stage · u: unstage · d: discard · [ c ] [ g ] [ e ]`, non-plain Buttons, whose hotkey is not drawn); keycaps only (`[ s ] [ u ] …`, then without gaps); and only when even tight keycaps do not fit (six keys below 32 columns) a strip of labelless keys (`s: u: d: c: g: e: `), cut from the end as a last resort. A short pane (below 10 rows) starts at the keycaps. The full key list for every view is in the PRD and `core/keys.ts`.

**Hard rules.**
- No list or chrome row ever wraps, and no line is wider than the pane.
- The only text that wraps is preview and diff content. On OpenCode it soft-wraps at the pane width, and continuation lines show a `muted` `│` in the line-number gutter, or a space where there is no gutter. On Claude Code a preview or diff window counts rows, so `Code` cuts each line at the edge (`wrap="truncate-end"`) instead, and the window's box (`height` = its rows, `overflow="hidden"`) clips rendered Markdown: the hint line, whose Buttons are the letter keys, never leaves the pane.
- Text fitted to a row draws a tab as one space and any other control character as U+FFFD, and counts each as one cell (`printable` in `core/shared/fit.ts`).

## 6. Height rules

OpenCode's commit input edits only the first line of a generated message; a retained body changes the control label to `Edit subject (body kept)`. Enter commits the complete draft, and a blank subject disables committing. The branch-aware message placeholder appears from 60 columns when it fits; narrower panels use `Message`. Smart-commit guidance appears only when smart commit will stage existing changes, never for amend or with smart commit disabled.

- The tab bar and header row stay pinned, the hint line stays pinned at the bottom, and only the body scrolls. An active OpenCode Files filter and the Git commit message keep one editable input row even when the normal header is hidden, including heights 2 and 5; the result viewport keeps at least one row. Git's other controls participate in the selection-anchored scroll window and remain reachable by arrows/Enter.
- When rows run short, OpenCode Git-family views (working Git, Graph, Branches and diff) keep a fitted hint at five rows and above, reserving that row before computing the body viewport. Other OpenCode tabs hide hints below 10 rows; the keys still work. On Claude Code the letter keys live on the hint line's Buttons, so a view with letter actions keeps the hint, bare (keycaps, no labels), and drops it only below 3 rows (`docs/decisions/0009-esc-is-host-reserved-on-claude-code.md`). Below 8, hide the rule. Below 6, hide the header row; its key facts move into the tab bar's right side if they fit. Below 3, render only the body.
- A nested view keeps a visible Back row, including at five rows, while retaining tab and hint controls. Claude suppresses the separate Back row below four total rows to keep the body, tabs and hint within the available height. Both hosts use shared `q` when the Back control is drawn; OpenCode also accepts Esc and Claude Code reserves it for the prompt. Editable fields keep a typed `q`. Back returns diff → comparison → Branches → Git one level at a time; Files preview returns to its retained filter/list. At five rows the preview/diff still keeps one content row. An active Claude Files filter pins its input when the normal header is hidden; at three/four rows the input may consume the entire body and results return on growth. Its `f` hint Button still closes the filter, and mouse Back is available from four rows. Inline name editors and questions keep their existing Cancel controls instead of another Back row.

Search/Quick Open reserve `q` for their mode toggle (ADR 0019); previews, Replace and Symbols/results retain Back. A preview returns to its originating tab/subview and carries the requested line. Claude Code uses a bounded source window with a visible target gutter, including Markdown/CSV/TSV line targets. Fallback summaries identify `git grep`; it returns only the first occurrence per line. A true truncation flag shows `Results truncated.`. The fallback's bounded buffer can truncate before 2,000 results.

Claude Search pins `Search` / `Go to file` in the body, followed by `Aa .* \\b`, optional include/exclude text, file groups, accent match spans and the summary. Active toggles have brackets as well as the accent color. `Include/exclude: src/** !**/*.test.ts` and `Replace with` are secondary editors; Submit returns focus to the list or opens replacement review. Replacement file headers apply only after confirmation; their chevrons collapse bounded native diff windows. `Not replaced` lists actual reasons, and partial writes report their successful count before refresh.

Claude Symbols shows `Outline: <rel> · LSP` or `· approximate`, indented kind letters, `Find symbol`, grouped references and lazy Callers/Calls trees. Each expanded section names its actual source. Unknown languages show `No outline for this file type.`; no selection shows `Select a file in Files.`. Source labels remain present in compact panes. Approximate data stays visible while `Exact symbols need permission to use the LSP tool.` offers deliberate `Use LSP`.

At five rows, Claude Search/Symbols keep tabs, the active editor, selected row and hint. Compact editors expose Cancel and omit the separate Back row. At 24 columns, actions omitted from fitted hints remain in the scrollable list; their letter shortcut exists only while its native Button is drawn. Input focus suspends letter/digit shortcuts, and Submit restores list actions. Mobile shows an explicit input-unavailable fallback. ADR 0021 records these native limits.
- The body always keeps at least 1 row. Scrolling keeps 1 row of context above and below the selection when the body has 5 or more rows.
- Expanded inline items (a commit's files, call hierarchy) never push the selected row out of view.

## 7. Resize behavior

- Recompute the whole layout on every width or height change, synchronously and without debouncing. Column widths are never cached between sizes.
- Scrolling is anchored to the selected row's id, not its index. After a resize, the selected row keeps its screen offset when it can. Otherwise it is clamped to the nearest visible position.
- Expansion, filters, queries, the commit message and the diff position all survive a resize. Shrinking and then growing back gives output identical to a fresh render at the final size.

## 8. Empty, loading and error states

States are one `muted` line in the body, a short sentence ending in a period, with no exclamation marks. Errors use `error` and add git's or the OS's first error line, truncated at the end. Loading shows static text with no spinner.

| View | State | Copy |
| --- | --- | --- |
| Any | Loading | `Loading…` |
| Files | Empty folder | `This folder is empty.` |
| Files | Filter, no match | `No files match "user".` |
| Files | Read failure | `Can't read this folder.` |
| Files | Preview read failure | `Can't read this file: <first error line>.` when available, otherwise `Can't read this file.` (`error`) |
| Files | Preview too large | `Too large to preview (3.4 MB).` |
| Files | Binary | `Binary file. Press o to open it.` |
| Files | Empty file | `This file is empty.` |
| Files | Image the surface cannot draw | `No image preview here. Press o to open it.` |
| Search | Idle | `Type to search the project.` |
| Search | No results | `No results.` |
| Search | Capped | `Results truncated.` |
| Search | No ripgrep | `ripgrep (rg) is not installed. Install it to search:` with the installation URL; fallback summaries add `· git grep` |
| Symbols | Nothing selected | `Select a file in Files.` |
| Symbols | None found | `No symbols.` / `No outline for this file type.` |
| Symbols | LSP permission | `Exact symbols need permission to use the LSP tool.` |
| Git | Not a repo | `This folder is not a git repository.` with an `Initialize repository` action |
| Git | Clean | `No changes.` |
| Git | Nothing staged | `Nothing staged. Commit stages all changes.` |
| Git | Detached | `Detached at a41f9c2.` (`warning`) |
| Git | No upstream | `No upstream branch.` (`warning`) |
| Git | Failure | `Push failed: <first git line>.` (`error`) |
| Git | Discard (confirm) | `Discard changes to user.ts?` / `Discard all changes (3 files, 1 untracked will be deleted)?` (`warning`) with `Discard` and `Cancel` |
| Git | Sensitive files | `These files look sensitive: .env` (`warning`), the whole list wrapped over rows, with `Commit anyway` and `Cancel`. On a short pane the rule goes first, then the list is cut and ends in `+N more`; the Buttons always stay (the same for Discard) |
| Git | Diverged | `Your branch and its upstream have diverged.` (`warning`) with `Merge`, `Rebase`, `Ask Claude` and `Cancel` |
| Git (Claude Code) | Missing Sync review | `Claude auto mode could not review Sync. Ask Claude to continue from the prompt.` (`warning`), with `Ask Claude` and `Cancel` (`q`). The pinned answers stay visible at five rows; Ask only prepares prompt text. |
| Git | Busy | `Committing…`, `Syncing…`, `Generating…` in the repository row (`muted`); Commit is drawn dim and cannot be pressed while the message is empty |
| Git | Left running | `Commit is still running in the background; check the terminal.` (toast; the message is kept) |
| Diff | Capped | `Diff truncated at 5,000 lines.` (`warning`) |

## 9. Motion: activity shimmer

- When a row is touched, the name's foreground starts in the activity color and returns to `fg` in **8 steps of 250 ms (2 s in total)**. In truecolor, each step mixes linearly from the token's color to `fg` in the theme layer. With 16 colors there are **3 steps**: bold activity color (0–700 ms), activity color (700–1400 ms), dim activity color (1400–2000 ms).
- When it ends, the gutter shows `•` in the dim activity color for the rest of the session. That marker is the only thing that persists.
- Touching the row again restarts the fade. Only visible rows animate, and rows that scroll off show their end state when they return.
- On the selected row, only the gutter marker shimmers, so the selection stays readable.
- `activity: none` shows nothing: no fade and no marker. The host's reduced-motion setting skips the fade and shows the marker straight away.
- Claude Code paints with theme keys only, which cannot be mixed, so it always uses the 3-step form (`shimmerPhase` in `core/activity/log.ts`), redrawn every 250 ms only while a row glows.
- There is no other animation: no spinners, no sliding, no blinking cursor except the host's own.

The OpenCode shell follows these height rules using its root box's measured height, rather than assuming the terminal height equals the panel height. The tab bar uses `tabBar`, the single text hint uses `hintLine` (which retains Esc), and all remaining shell rows use `fitEnd` or `fitPath`. The active tab is bold in the resolved theme's primary action text color; tabs also accept clicks. Files adds a selection-anchored tree, eight-step theme-colored shimmer and previews; Git adds a pinned commit input, scrollable actions/groups and the diff view. OpenCode's Markdown preview displays highlighted literal source, and images display `Image preview is not available in OpenCode.`. Its binary notice is `Binary file — no preview.`; too-large previews say `Too large to preview.` because the RPC does not carry size. Code wraps and scrolls by native visual rows; CSV/TSV use the shared `fitTable` helper. Diff uses the dedicated theme diff text colors, cell-based wrapping and continuation gutters; its logical row and character anchors survive rewrapping. The truncation notice keeps one row whenever there is also room for a content row, including height 2.

## 10. Test checklist

Render every view (Files tree, Files preview, Search, Quick Open, Symbols, Git, Diff, confirm dialogs and every state in §8) as snapshots in all three glyph sets.

- **Widths:** 24, 40, 80, 120, and 200 as a smoke test. **Heights:** 10, 24 and 5.
- For each render, assert all of the following:
  - [ ] Every line's display width (wcwidth) is ≤ the pane width, with no partial wide character at the edge.
  - [ ] The output is exactly `height` lines, and only preview and diff content has continuation lines.
  - [ ] The selected row is inside the body viewport.
  - [ ] The tab bar and hint line are each ≤ the width, and the hint never ends in a catch-all item.
  - [ ] Status letters are present on every changed row at every width.
  - [ ] Right-hand columns are right-aligned: the same column ends at the same cell on every row.
  - [ ] Truncated paths keep the basename (middle ellipsis), and subjects use an end ellipsis.
  - [ ] Each `NO_COLOR` snapshot still distinguishes every state by text.
  - [ ] Views contain no raw color values (a lint rule forbids hex, RGB and ANSI escapes outside `theme.ts`).
- **Resize sequence:** 120 → 24 → 10 rows → 120. After it, the selection id is unchanged and the final output equals a fresh render.
- **Shimmer:** a touch produces 8 frames in truecolor and 3 frames with 16 colors, then a static `•`. `activity: none` produces 0 frames.

OpenCode keeps its permanent shared key layer active while short panes hide chrome. Contextual Graph hints select applicable keys from the shared map. OpenCode working-row hints omit commit-only `y/a/n`, preserving room for Generate and Sync. Expanded OpenCode files show a muted, nonselectable `Loading…` row while details are pending. Filter/name editors use native editable dialogs; cancel retains the prior filter and confirmations use the fresh core question. Historical diff paths keep a body row at short heights. See ADRs 0015 and 0016.
