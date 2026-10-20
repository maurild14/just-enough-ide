# Native Search and Symbols controls and path evidence

> Purpose: record compact native controls, LSP permission checks and unambiguous path boundaries · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

Search has more letter actions than one 24-column native Button hint can hold. Five-row panes must retain the active editor, selected row and hints. Claude Code reserves Esc, its Code element has no line-highlight property, and its LSP tool takes one-based source positions. A double-leading-slash project path alone cannot distinguish POSIX from Windows UNC semantics.

## Decision

- Claude Search, Quick Open and Symbols keep hints from five rows down to three, matching Files/Git. Commands omitted by fitted hints also appear as focusable list controls reached by arrows and Enter. A letter shortcut exists only when its native Button is drawn; no hidden global hotkey is promised. List controls avoid duplicate hotkeys. Search/Quick Open keep the existing `q` mode toggle exception in ADR 0019.
- Search keeps its query in the body rather than duplicating the shell header. Compact panes drop low-priority toggle/summary rows; active toggle markers and the fallback engine remain available on the query. Symbols retains a compact source header. Editors expose Submit and Cancel; their letter/digit shortcuts are suspended, and compact editors omit the extra Back row to retain a selected row. Questions keep explicit confirmation and Cancel. This narrows the universal five-row Back-row rule in ADR 0017.
- Preview routing follows `currentView`, independently of the originating tab. A one-based line target initializes the existing preview window, clamps to source bounds and draws a native gutter marker beside the actual source row. Markdown and delimited text use source while targeting a line; ordinary Files tables and rendered Markdown keep their existing behavior. Shared delimited previews preserve their existing optional `text` field as well as parsed rows.
- Cache only session/root UI state and LSP opt-in affordances. Every concrete operation/path receives a fresh side-effect-free `tool.check({tool:'LSP',input})`. Only `allow` runs automatically; `ask` retains approximate data and a deliberate Use LSP control, and `deny`, errors or unknown output fall back. Calls spread the checked input beside `tool`. Identifier positions come from a confined complete UTF-8 source read and an unambiguous identifier on the selected source line, never an assumed first column. Child call expansions resolve their own file/node.
- New Claude Search/Symbols services and shared previews resolve ambiguous `//` roots through native `fs.stat(...,{resolve:true}).realPath`. A rooted drive or native UNC prefix proves Windows; a canonical single-leading-slash path proves POSIX grammar. Missing, relative or still-double-slash metadata refuses the new operation before source/process/tool access. A backslash inside a POSIX component is not Windows evidence. Existing tree/Git platform inference is outside this change.
- Search publishes batches at most once per 100 ms after a 150 ms debounce, cancels the prior stream and guards late replies by session/root and generation. Tab, preview, cwd, pane close and session end stop pending work. Query/results/selection survive preview Back. Replacement confirms the stored preview, reports skipped reasons and partial writes, invalidates Files and restarts Search.

## Consequences

Compact native actions remain reachable, though omitted letter shortcuts require list navigation. Mobile lacks native Input and shows an explicit input-unavailable fallback. Unresolved double-slash roots conservatively refuse new operations. LSP fixtures remain synthetic contracts; positive configured-tool compatibility is unverified. Native kit interaction/size assertions use scripted process/tool responses and do not establish real terminal paint, live resize/focus or silent-process cancellation semantics. Whole-file writes retain the Host contract's non-atomic final check/write window (ADR 0019).
