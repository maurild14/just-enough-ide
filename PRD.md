# JEI — Just Enough IDE

**Product requirements and technical spec · v0.4**

> The parts of an IDE you still need when the AI writes the code: a file tree, project search and a full Git panel, docked beside your Claude Code or OpenCode session.

---

## 1. Why this exists

More and more developers work through an agent in the terminal: the agent writes the code, and they direct and review it. They no longer need an editor full of tabs, but they still lean on a few parts of the IDE every day:

- a **file explorer** to see the project's shape and what is changing,
- **project-wide search** to find things without asking the model (and paying tokens for it),
- the **Source Control panel**: branch, graph of commits, changed files, diffs, a commit button.

Today that means keeping VS Code open *only* for its sidebar. JEI brings exactly that sidebar into the agent's terminal UI, as a pane docked beside the conversation, and makes it aware of what the agent is doing.

JEI ships for **two hosts from the first release: Claude Code and OpenCode**, from one repository, with the same features, keys and behavior on both.

### What already exists (prior art, researched Oct 2026)

| Project | What it does | Gap JEI fills |
| --- | --- | --- |
| Existing Claude Code file viewers | Tree plus previews (Markdown, CSV) | Read-only: no file operations, no search, no Git |
| Claude Code native diff panel (fullscreen) | Lists changed files and their diffs | No history, no commit, no branches |
| OpenCode diff viewers | Show diffs | Diffs only; no explorer, search, symbols or Git panel |
| OpenCode sidebar plugins | Small status panels in OpenCode's sidebar | Prove the slot works; no file explorer exists for OpenCode |
| Standalone TUIs and terminal splits | Run next to the agent | Not inside the host; not aware of the agent; extra setup |

JEI is written **from scratch**; no code from other projects is copied. If a fragment is ever reused it is kept with its license notice in `THIRD_PARTY_NOTICES.md`.

---

## 2. Goals, non-goals, anti-goals

### Goals
1. One pane, three tabs, **Files · Search · Git**, with live filename search in Files, that replace the VS Code sidebar for a developer who works through an agent.
2. The **Git tab mirrors VS Code's Source Control panel** (repository row, Graph, Changes, branches), adapted to a terminal pane.
3. **Agent-aware:** the pane shows what the agent reads, writes and commits, and every view can hand context to the agent in one key ("Ask", "mention").
4. **Two hosts, one core:** Claude Code and OpenCode get the same features at the same time. All logic lives in a host-independent core; each host is a thin adapter.
5. **Deterministic and cheap:** search and Git are local operations; they never call the model unless the user asks (✦ commit message, Ask).
6. **Works the same on Windows, macOS and Linux.**
7. Installable in two lines on each host.

### Non-goals (v1)
- Editing code inside the pane (JEI previews; editing is the agent's job or your editor's).
- Interactive rebase, merge-conflict resolution, stash management.
- A full debugger, test explorer, task runner or Problems panel (candidates for later, see §11).
- Hosts other than Claude Code and OpenCode. Non-terminal surfaces of OpenCode (desktop, web).

### Anti-goals (it fails even if it works)
- **It becomes an IDE.** If a feature needs a tab bar of open editors, it does not belong here. The name is the rule: *just enough*.
- **It fights the agent.** JEI must never hold a git lock, rewrite files behind the agent's back, or block a tool call.
- **It is slow or noisy.** A pane that lags the terminal, floods toasts or re-scans the repo constantly will be uninstalled.
- **It surprises the user with destructive actions.** Discard, delete, revert, checkout over local changes: always confirmed.
- **The hosts drift apart.** A feature that ships on one host and not the other, or behaves differently, is a bug.

---

## 3. Users and the core moments

**Primary user:** a developer who builds mostly through Claude Code or OpenCode in a terminal, comfortable with git, used to VS Code's sidebar.

Moments JEI is designed around:
1. *"What did the agent just touch?"* → Files tab shimmers it; Git → Changes lists it with +/−.
2. *"Where is `getUser` used?"* → Search, then **send them to the agent** in one key.
3. *"What changed in that commit?"* → Git → Graph → expand commit → open a file's diff.
4. *"Commit this."* → Git → Changes → ✦ generate message → Commit (or Commit & Push).
5. *"Start a branch for this."* → Git → Branches → create & switch.

---

## 4. Constraints (from the platforms)

### 4.1 The core rule

Everything that is not drawing or talking to a host lives in `core/`: git output parsers, graph lane layout, diff parsing, fuzzy ranking, shell read-target parsing, path handling, key map, view models. **`core/` imports nothing from either host and uses no Node, Bun or DOM API.** It receives a small `Host` interface (run a process, list/stat/read files, complete with a model) and returns plain data; UI actions (toast, confirm, hand text to the agent) stay in each adapter. Reason: Claude Code mods have no Node; OpenCode plugins run on Bun or Node; only pure TypeScript runs in both.

### 4.2 Claude Code host

Verified against the Claude Code mod API (build 2.1.302) and its type declarations.

| Need | API | Status |
| --- | --- | --- |
| Docked side pane | `$.ui.open({ id, title })` + `ui.render` on `{ component: 'Pane', requestId }` | ✅ |
| Buttons, inputs, selects | `$.ui.resolve(e)` → `Box`, `Text`, `Button`, `Input`, `Select`, `Code`, `Markdown`, `Image`, `Raster` | ✅ |
| Diffs with colors | `Code` with `format: 'diff'` (falls back to plain if not a valid unified diff) | ✅ |
| Run git / rg | `$.process.run(argv, { cwd, timeoutMs, stdin })` (4 MiB stdout cap, 30 s default timeout, 10 min max); `$.process.spawn` for streaming | ✅ |
| Read files / list dirs | `$.fs.read`, `$.fs.list`, `$.fs.stat` | ✅ |
| Know what the agent does | `tool.call` hooks on `Read`, `Edit`, `Write`, `NotebookEdit`, `Grep`, `Glob`, `Bash`, `PowerShell` | ✅ |
| Files changed on disk | `classic.FileChanged`, `classic.CwdChanged`, `watchPaths` from `classic.SessionStart` | ✅ |
| Put text into the prompt | `$.prompt.fill({ text, mode: 'insert' })` | ✅ |
| AI commit message | `$.model.complete({ model, prompt })` on the session's own client (no API key) | ✅ |
| State | `$.state` (session, drives redraws) declared in `types/index.d.ts`; `$.store` (across sessions) | ✅ |
| Slash command | `$.command.register` + `command.run` | ✅ |
| Parser in-process (tree-sitter) | **No `WebAssembly`, no Node, no `eval`** in a hooks module | ❌ Replaced (see §6.3) |
| Images in preview | `Image` uses the kitty graphics protocol (kitty, Ghostty); `alt` text elsewhere | ⚠️ |

- **Keyboard:** a pane receives keys through its `Button`s: a `hotkey` is **one digit or one lowercase letter**; Tab and the arrows walk the focus ring; Esc returns to the prompt. No raw key event. Mouse (click, wheel) only in the fullscreen layout.
- **Layout:** docking beside the transcript needs `/tui fullscreen`; a pane opened unasked seats from ~110–144 columns, inline below that. Body width is `e.props.bodyColumns` (expect ~40–60 columns).
- **Surfaces:** the terminal (fullscreen layout) is first-class. The Desktop app also draws mod panes (`e.surface === 'desktop'`); JEI must render valid trees there (mod tests mount the pane on `terminal` and `desktop`) and work by click; desktop polish is best effort in v1. VS Code and mobile surfaces are out of scope. Mods do not load in the Desktop app's WSL sessions, the VS Code extension's chat panel or `claude -p`.
- **Version:** the API is early access: minimum Claude Code **2.1.302**; CI also runs against the latest release.
- **Git runs with repo hooks off** under `$.process.run` (pre-commit, commit-msg, pre-push, post-checkout don't fire). See §6.4.

### 4.3 OpenCode host

Verified against OpenCode's official v2 plugin docs (`opencode.ai/v2/docs/build/plugins`, `/build/plugins/cli`) and the published type declarations of `@opencode/plugin` 2.0.32 and `@opencode/client` 2.0.32 (Oct 2026).

**Target: OpenCode 2.x** (`@opencode/cli`, released Sept 2026). The 1.x line (`opencode-ai`, still maintained) has no `session.panel` slot, only a narrow sidebar slot, so it cannot host JEI's pane and is out of scope.

An OpenCode plugin package has a **server entry** (`@opencode/plugin`, `Plugin.define({ id, setup(ctx) })`) and a **TUI entry** (`@opencode/plugin/tui`, exported as `./tui`, `define({ id, setup(context) })`). The TUI may be connected to a remote server, so anything that touches the project's files or git runs in the **server entry**, next to the files; the TUI entry only draws.

| Need | API (verified in the types) | Status |
| --- | --- | --- |
| Docked side pane | `context.ui.panel.open(name, { presentation: 'panel' \| 'fullscreen' })`; JEI claims the `session.panel` slot with `context.ui.slot({ replace/append: 'session.panel', render })`, whose input is reactive `name`, `sessionID`, `width`, `presentation`, `focused`, plus `focus()`, `close()`, `toggleFullscreen()` | ✅ |
| Full-screen views | `context.ui.router.register({ name, render })` | ✅ |
| Drawing | OpenTUI elements in **Solid** JSX (peer deps `@opentui/solid`, `@opentui/core` ≥ 0.5.17); `context.theme` and `context.themeMode` for colors | ✅ |
| Diffs with colors | No diff element: JEI renders `core`'s parsed hunks line by line with theme colors | ✅ Own renderer |
| Keys and slash command | `context.keymap.layer(() => ({ commands, bindings, … }))`; a command has `id`, `title`, `bind`, `palette`, `slash: { name, arguments }`, `run(input, event)` | ✅ |
| Confirm / pick / edit text / toast | `ui.dialog.confirm`, `ui.dialog.select` (with `search` and `actions`), `ui.dialog.prompt({ title, value })` (prefilled, editable), `ui.toast.show` | ✅ |
| Run git / rg | Server entry: `node:child_process` `spawn` with argv arrays (the plugin runtime has Bun and Node builds; `node:child_process` works on both) | ✅ |
| Server ↔ TUI | Server: `ctx.rpc.register(definition, handlers)` returns a registration with `events.emit(...)` for server-pushed events; the TUI calls methods and listens through `context.client.rpc` | ✅ |
| Know what the agent does | Server: `ctx.tool.hook('execute.before' / 'execute.after')` with `tool`, `sessionID`, `input`, `status`, `result`; event `filesystem.changed`; `vcs.branch.updated` | ✅ |
| Put text into the prompt | **No API in 2.x** to insert into the user's prompt (`tui.prompt.append` exists only as an event type). JEI uses `ui.dialog.prompt({ value })` prefilled with the text, then `client.session.prompt({ sessionID, text })` to send it | ✅ Different UX, see §5.3 |
| AI commit message | `ctx.generate.text({ prompt, model? })` → `{ text }`; prompt is a string and model is `{ providerID, id }` | ✅ |
| State | Solid signals in the TUI; `context.storage` in the TUI; `ctx.storage` on the server | ✅ |
| Git hooks | Git runs as a normal process: repo hooks fire | ✅ |

- **Keyboard:** `keymap` allows chords and modifiers, but JEI uses the **same single-letter/digit keys as on Claude Code** (one key map in `core/keys.ts`, the stricter host's rules). Never bind `ctrl+n`/`ctrl+p` (reserved by OpenCode's dialogs).
- **Layout:** on narrow terminals OpenCode shows panels full-screen; `toggleFullscreen` is a no-op until there is room. Same 40-column rule as Claude Code.
- **Tool names:** read from `ctx.tool.list()` at runtime; `core/` classifies a call by tool id first and by input shape (a `filePath`/`path` field, a `command` field) as fallback, so a renamed tool still shimmers.
- **Version:** the 2.x plugin API is new and evolving; the package's exported types are the contract. Minimum OpenCode **2.0.32** (the version verified); CI type-checks against the latest release.

### 4.4 Both hosts

- Every view must render at 40 columns without breaking.
- Run every git command with `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0` so JEI never contends with the agent's own git.
- Windows parity: never pass a shell string (`sh -c`, `cmd /c`); always argv arrays. Where an OS tool is unavoidable (file ops, §6.1), each OS gets its own argv, both tested.
- UI labels that name the agent use the host's name: **Ask Claude** on Claude Code, **Ask OpenCode** on OpenCode. The spec writes "Ask".

---

## 5. Experience

### 5.1 Layout

```
┌ conversation ─────────────────────────────┬ JEI ──────────────────────────────┐
│ > add zod validation to the users endpoint│ 1 Files  2 Search  3 Git│
│                                           │───────────────────────────────────│
│ ● Update(src/api/user.ts)                 │  (active tab content)             │
│   ⎿ 12 additions, 3 removals              │                                   │
│                                           │                                   │
│ > _                                       │ hint line: keys for this view     │
└───────────────────────────────────────────┴───────────────────────────────────┘
```

- **All UI text is English.**
- Tabs switch with `1`–`3` while the pane holds the keyboard; clicking a tab works where the host supports the mouse.
- The last line of the pane is always a **hint line** listing the keys of the current view.
- `/jei` toggles the pane; `/jei files|search|git` opens it on a tab; `/jei <path>` opens Files revealing a path. Same command on both hosts.
- Colors follow the host's theme (dark/light); Nerd Font icons when available, plain Unicode otherwise.

### 5.2 Activity shimmer (shared by Files and Git)

When the agent touches a file, its row briefly glows and then settles:

| Color | Trigger |
| --- | --- |
| Purple | The agent read it (read tools; files returned by grep/glob tools; best-effort parse of read-only shell commands like `cat`, `rg`, `grep`, `head`, `type`, `Get-Content`) |
| Orange | The agent wrote it (edit, write, patch and notebook tools; files that show up as changed after a shell command) |
| Green | A git action touched it (commit, push, pull, checkout) |

Each host adapter maps its own tool names to these three kinds (Claude Code: `Read`, `Edit`, `Write`, `NotebookEdit`, `Grep`, `Glob`, `Bash`, `PowerShell`; OpenCode: its tool ids from `ctx.tool.list()`, with the input-shape fallback of §4.3). The classification and the shell parsing live in `core/`.

Known file operands glow from tool start through completion, including overlapping calls. The shimmer decays over ~2 s after the final completion and leaves a subtle marker for the rest of the session ("touched this session"). Result-only paths (such as grep/glob hits) begin glowing when reported. Option: show reads and writes / writes only / reads only / none.

### 5.3 Handing context to the agent

Mention (`a`) and Send (`s`) build the same text in `core/`. The hosts deliver it differently, because only Claude Code can write into the user's prompt:
- **Claude Code:** the text is inserted into the prompt (`$.prompt.fill`, `mode: 'insert'`); the user keeps typing and sends it.
- **OpenCode:** an editable dialog opens prefilled with the text (`ui.dialog.prompt`); the user can add to it and confirm, and JEI sends it as a message to the current session (`client.session.prompt`). Esc cancels.

---

## 6. Features

Each feature lists behavior, keys and how it is built. Keys in `code` are the same on both hosts. "Host" means the adapter's implementation of the `Host` interface (§4.1).

### 6.1 Files tab

Resolved filesystem metadata must retain exact component identity. Static Windows Unicode or case-distinct sibling paths are outside the canonical project, including junction targets; typed casing aliases remain valid only through consistent actual canonical evidence. Ambiguous identities refuse conservatively. This applies to Files effects, previews, Search publication and replacement reads/writes, separately from the external-writer window (ADR 0029).

**Behavior**
- Collapsible tree of the working directory, respecting `.gitignore` (toggle to show ignored/hidden).
- Git status per file and rolled up per folder (modified, added, untracked, deleted, conflicted), with color and letter.
- Activity shimmer (§5.2) colors the complete name area (icon, indentation and padding, including the selected row): purple for reads, orange for writes and green for Git file operands. The status letter keeps its Git color. Containing folders inherit a softer tint from the latest eligible active descendant. The two-second animation ends automatically; only the file's dim session marker remains. `activity` filters both names and markers; `followAgent` controls navigation independently. Both hosts retain selection readability in light/dark themes at 24/40/80/120 columns (ADR 0030).
- **Follow agent** (option, default on): the tree scrolls to and expands what the agent touches. Off: the view stays where you put it; markers still show.
- Filter by name (fuzzy) across the whole project, including unexpanded folders.
- **Preview** inside the pane: syntax-colored code, rendered Markdown (toggle source), CSV/TSV as a table, images where the host and terminal support them. Large (>2 MB) and binary files show a notice.
- **Mention** a file or folder in the prompt (`@path`) without leaving the pane.
- **Open** in the user's editor (configurable command with `{path}` and `{line}` placeholders) or the system default app.
- **File operations:** new file, new folder, rename, move, delete. Delete always confirms; nothing is ever deleted without a visible confirmation.
- Follows `cd`: when the session's directory changes, the tree re-roots.

**Keys:** `↑/↓` move · `enter` expand/collapse or preview · `s` or `f` filename search · `a` mention · `o` open · `n` new · `r` rename · `m` move · `d` delete · `h` toggle hidden · `q` back. OpenCode also accepts Esc; Claude Code reserves it for the prompt. A visible Back control returns a preview to its retained list/filter. Back from the filtered Files list clears the filter and restores its unfiltered origin; Cancel only leaves editing.

**Build:** list lazily (load a folder on expand, cap 2,000 entries per folder with a "show more" row). Git status from `git status --porcelain=v2 -z` (single call, parsed once in `core/`). Refresh on the host's file-changed events, after write tools and after shell commands (debounced ~300 ms).

File ops live in pure `core/fsops.ts` as validation/evidence, plans, argv/env and postcondition checks (ADR 0028). n takes one name; a single trailing `/` creates a folder. Its parent is the selected folder, the selected file's parent, or root without a selection. r takes one basename in the same parent. m takes an exact project-root-relative destination including its basename. Existing targets of any kind and missing parents refuse. Legal ordinary whitespace is preserved; absolute/traversal/control/platform aliases refuse before normalization. d always shows `Delete file?` or `Delete recursively?`, the source path and `Delete` / `Cancel`.

- **Claude Code:** new file uses exactly `$.fs.write(path, '')`. Other effects use checked `$.process.run` argv. Windows uses fixed `powershell.exe` program constants with path operands only in `JEI_FS_SOURCE`/`JEI_FS_DESTINATION` environment data; Move/Remove use `-LiteralPath`, while verified literal directory creation uses `New-Item -Path` (`-LiteralPath` does not exist for New-Item). POSIX uses `mkdir`, `mv -n` and `rm` with `--` and literal absolute operands. Exact postconditions reject skipped moves.
- **OpenCode:** closed `fsPrepare`/`fsApply` RPCs retain canonical evidence in bounded server-owned session/root plans with opaque random tokens. Only the server uses `node:fs/promises`: exclusive `wx` empty files, nonrecursive `mkdir`, checked `rename` and `rm`. The TUI has no filesystem I/O.
- Fresh uncached parent entries and resolved root/source/ancestor metadata precede effects and confirmed deletion. Direct source links, unknown metadata, root/canonical-root aliases, outside paths and descendant folder moves refuse. A linked opened root is anchored to its real root. Revalidate captured root/source/parent evidence after dialogs; canceled/stale work cannot target another project. A Files-only busy guard lasts through refresh.
- Both native inline editors own letters/digits and keep Cancel visible. Five-row views retain controls at 24/40/80/120 columns; smaller editors show enlargement/Cancel. Every attempted effect invalidates listings/previews/all-files and refreshes tree/Git/state, including errors that may follow a partial effect. Success clears the filename query, reveals/selects the target or surviving parent/row. Refresh failure says the operation happened and never automatically repeats it. Path-based APIs leave a documented external-writer check/use window; this is not an atomic no-overwrite or global editor lock guarantee.

Completion publication checks captured root/owner on each state retry, including after awaited refreshes. Use the verified canonical relative result for actual entry casing/paths. The latest selected successful target/ancestor chain can replace a normal row within the existing folder cap to remain visible through hidden/ignored filtering; settings and the 500-row cap stay unchanged. Changing selection stops that exception; visibility/root changes clear it. .git remains excluded, with a visible-parent/root-survivor fallback and exact result feedback (ADR 0028).

### 6.2 Search tab (text inside files)

Tab 2 is Search; Symbols is removed entirely (ADR 0027). Content search is literal and case-insensitive, submitted with Enter. The outlined query field has separate Cancel and Clear controls. Include/exclude globs, result grouping, one/all hand-off, Quick Open, reviewed exact-text replacement and changed-file refusal remain available. Search remains case-insensitive; Replace changes only literal text matching the query exactly, including case. Other case variants show `case-differs`, alongside eligible edits in the same file and after one/all application. Case, regex and word controls and shortcuts are removed.

Results stream from the existing bounded ripgrep service, with the verified Git grep fallback when needed. Search retains at most 2,000 result lines and an estimated 16 MiB. Replacement requires complete bounded review and fresh UTF-8 byte comparison before writes (ADR 0023). Arrow navigation keeps the selected result visible; Up from the first result focuses the query for editing, and Down from the query returns to the retained result without skipping it. Preview and Back retain its exact selection. Clear stays in Search; b returns to Files.

### 6.3 Filename search in Files

An accent outline above the project name contains the filename query. s or f focuses it. Every input change updates results without Enter; basename prefixes rank first, then existing fuzzy path matches. An empty query shows the tree. The first arrow leaves editing on the highlighted result; subsequent arrows navigate results. Enter previews. Back from preview retains query and result selection. Clear and Back from the filtered list restore the original tree selection and expansion; Cancel only leaves editing. Cancel/Clear remain part of each field's editor while focused, preserving their layout until activation. Cancel and focus moving to tabs or rows restore tab shortcuts; Search Clear refocuses its query. All controls fit at 24/40/80/120 columns and compact heights. See ADR 0026.

### 6.4 Git tab (Source Control, like VS Code)

Mirrors VS Code's Source Control panel, top to bottom.

**Repository row**
- Repo name, current branch with `*` when dirty, ahead/behind counts (`↓2 ↑1`), and a **Sync** action (pull, then push). Detached HEAD and no-upstream states are shown plainly.
- Sync follows the user's own git config (`pull.rebase`, `pull.ff`). With no config and a diverged branch, it uses `--ff-only`; if that fails it stops and offers: merge, rebase, or ask the agent. It never creates a merge commit the user did not choose.
- If the folder is not a repo: "Initialize repository" action.

**Graph**
- Commit history with branch lanes (forks and merges drawn with box characters), each commit's subject, author and relative time; ref badges for local branches, `origin/*`, tags and HEAD.
- **✦ marks commits created during an agent tool window in this session**: newly reachable hashes must have new commit-producing HEAD reflog evidence and a recent committer time. Checkout/reset movement alone never marks a commit. Overlapping tools, JEI mutations or unavailable evidence suppress marking; an unrelated external commit during a tool remains indistinguishable. See `docs/decisions/0012-git-history-evidence-and-state.md`.
- Graph is collapsible above Staged and Changes and shares their selection/scroll. Rows show stable theme-colored lanes, an optional ✦, distinct HEAD/local/remote/tag badges when space permits, subject, optional author/relative time and a seven-character hash aligned at the end. Badges reserve subject space; metadata appears only when the complete subject fits. Narrow rows retain lanes, subject and final hash. Selection uses a readable foreground, and explicit badge words and glyphs keep meaning without color. See ADR 0017.
- Contextual fetch (`fetch --prune`) and filter actions; pull/push use Sync and Commit & Push. See `docs/decisions/0014-native-history-views-and-attribution.md`.
- **Filter** by message text, author, file path or branch (or all branches).
- Loads `graphLimit` commits (200 by default); an explicit Load more row loads the next page.
- **Click/enter on a commit expands it inline**, listing its changed files with status (M/A/D/R) and +/−. Click/enter on a file **replaces the pane content with that file's diff**.
- **Commit actions:** copy hash, checkout (detached, confirmed), revert (confirmed; merge commits are refused), open on GitHub/GitLab (when the remote is one, without credentials), **Ask** (`explain commit a41f9c2`).

**Diff view (replaces the pane content)**
- Unified, one column, wrapped to the pane width, with hunk headers and line numbers. Claude Code draws it with `Code format="diff"`; OpenCode draws `core`'s parsed hunks with theme colors.
- Working header: file, source and +/−. Historical header: `<short> <subject>` or `<base>...<head>`, with the file path above the diff body.
- `n`/`p` next/previous hunk · `j`/`k` next/previous file of the same commit or change set · `a` Ask to review this diff · `o` open the file · `q` or Back returns one level (Esc also works on OpenCode).

**Changes**
- Message field ("Message (enter to commit on "main")") with **✦ Generate**: builds a Conventional Commits message from the staged diff (or the full diff when nothing is staged) with a small model (Claude Code: `$.model.complete`, default Haiku; OpenCode: `client.generate.text`, the model the user picks in `commitModel` or OpenCode's default; both configurable). The user can always edit it before committing.
- **Commit** button with three modes: Commit, Commit & Push, Commit (amend). Claude Code cycles Only → & Push → Amend through a separate Button, keeping arrows available for Graph and working changes; OpenCode uses its native modal chooser. Selecting a mode never commits. When nothing is staged, Commit stages everything first (VS Code's default "smart commit", option to turn off). See ADR 0024.
- Two groups, **Staged** and **Changes**, each file with status letter, folder and +/−.
- Per file: open diff, stage/unstage, discard (confirmed). Per group: stage all, unstage all, discard all (confirmed).

**Branches**
- Local and remote branches, current one marked, ahead/behind per branch.
- **Switch** to a branch; **create** a branch (from HEAD or from a selected commit) and switch to it; **compare with main** (lists the files the branch changes vs. its merge base and opens their diffs).
- Switching or creating with uncommitted changes or from detached HEAD: JEI stops and asks (carry changes over if git allows / cancel). It never stashes or forces a switch. Core services enforce fresh target/status validation and confirmation; see ADR 0013.

**Keys (Git tab):** `enter` expand/open · `s` stage · `u` unstage · `d` discard · `c` commit · `y` copy hash · `a` Ask · `b` branches · `f` filter · `t` fetch · `n` new branch from the selected graph commit · `g` generate message · `e` sync. **Branches:** `enter` switch · `n` new from HEAD · `c` compare · `f` filter · `q` back. Both hosts show Back in nested views. Comparison files form a separate level: diff → comparison → Branches → Git, preserving each selection. Editable fields keep `q` as text; inline editors and questions expose Cancel. OpenCode retains Esc as a Back alias.

**Build:** every command goes through one runner, `git --no-optional-locks -C <root> …` with `GIT_OPTIONAL_LOCKS=0` (Claude Code: `$.process.run`; OpenCode: `node:child_process` in the server entry). Read with porcelain/plumbing formats only (`status --porcelain=v2 -z`, `log --format=%H%x00%P%x00…`, `diff --numstat -z`, `for-each-ref --format`), parsed in `core/`. The graph layout (assigning lanes from parent hashes) is a pure function in `core/` with its own unit tests. Refresh on `.git/HEAD`, `.git/index` and ref changes and after git actions. Network operations (fetch, pull, push) show progress in the repository row and report failures as a toast with git's first error line.

**Git hooks (decided: detect and choose; Claude Code only).** On OpenCode git runs as a normal process and repo hooks fire, so nothing special is needed. On Claude Code `$.process.run` runs git with repo hooks off, so JEI detects whether the repo uses hooks: `core.hooksPath` set, non-`.sample` files in `.git/hooks`, a `.husky/` or `lefthook.yml`/`.pre-commit-config.yaml`, or Git LFS (`.gitattributes` with `filter=lfs`). Detection lives in `core/`, cached per repo and refreshed when those files change.
- **No hooks:** commit, push, pull, checkout and switch run directly through `$.process.run` (fast, no prompts).
- **Hooks present:** those hook-firing operations run through Claude Code's own shell tool, `$.tool.call({ tool: 'Bash', command: 'git …', description })` (PowerShell tool on Windows if that is the session's shell), so the hooks run. Before the first one JEI checks `$.tool.check`; if it would ask, the pane says why ("This repo has a pre-commit hook; JEI runs git through Claude's shell so it runs") and explains that normal host permissions and review apply. Ordinary failures show their first error line. A verified missing auto-mode review during Sync instead offers Ask Claude and Cancel: Ask inserts a separated draft request to inspect current state and finish only pending work while preserving local work, hooks and permissions. It checks the current repository root and never submits, retries, bypasses hooks or changes permissions; unavailable prompt/root checks retain the question. See ADR 0018.
- Read-only commands (status, log, diff, for-each-ref) always run directly. The repository row shows a small marker when hook mode is active.

---

## 7. Configuration

Same keys on both hosts. Claude Code: `userConfig` in `plugin.json`, where on/off settings are string pickers (`"on"`/`"off"`) as `/config` draws them. OpenCode: plugin options in `opencode.json(c)`, `{ "package": "opencode-jei", "options": { … } }`, read from `ctx.options` / `context.options`; real booleans and the on/off strings are both accepted. `core/options.ts` parses both into one shape.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `startOpen` | boolean | `true` | Open the pane when a session starts (where it can dock) |
| `defaultTab` | `files` \| `search` \| `git` | `files` | Tab shown on open |
| `activity` | `reads and writes` \| `writes` \| `reads` \| `none` | `reads and writes` | What the shimmer shows |
| `followAgent` | boolean | `true` | Tree follows what the agent touches |
| `glyphs` | `auto` \| `nerd` \| `plain` | `auto` | Icon set |
| `editorCommand` | string | `""` | Command to open files, `{path}` and `{line}` placeholders; empty = system default |
| `commitModel` | string | `""` | Model for ✦ Generate; empty = host default (Haiku on Claude Code, the configured small model on OpenCode) |
| `smartCommit` | boolean | `true` | Commit with nothing staged stages everything |
| `graphLimit` | number | `200` | Commits loaded per page in the Graph |

---

## 8. Architecture

### 8.1 Tech stack

One stack for two hosts:

- **TypeScript + TSX** everywhere. Claude Code compiles the mod itself; OpenCode loads the TypeScript entries itself. No bundler, no build step.
- **Zero runtime dependencies.** `@opencode/plugin` is a peer dependency that OpenCode resolves at runtime; nothing else.
- **`core/`:** pure TypeScript, no host API, no Node/Bun/DOM (§4.1).
- **Claude Code adapter:** the surface's own elements via `$.ui.resolve(e)`, JSX against the global `h`; session `$.state` atoms declared in `types/index.d.ts` retain root-scoped UI data. Search transient operations reset on session start.
- **OpenCode adapter:** server entry (processes via `node:child_process`, files, tool hooks, model, `ctx.rpc.register`) and TUI entry (Solid + OpenTUI views, keymap, dialogs, `context.storage`), linked by one RPC definition in `hosts/opencode/rpc.ts`.
- **External tools:** `git` (required for the Git tab), `rg` (Search; falls back to `git grep`).
- **Tests:**
  - `bun test` for everything in `core/` (parsers, graph layout, fuzzy ranking, shell parsing, key map, fsops argv), named `*.spec.ts`. This is where most tests live.
  - `claude plugin test` for the Claude Code adapter (mounting the pane on `terminal` and `desktop`).
  - OpenCode adapter: `bun test` over the RPC handlers (fake `ctx`, real git in a temp repo) and the views with OpenTUI's `testRender` / `captureCharFrame`, named `*.spec.tsx`.
  - Claude Code tests are the only `*.test.ts(x)` files, because `claude plugin test` loads every `*.test.ts` in the plugin folder.
  - A manual QA checklist (`docs/qa.md`) on both hosts before each release, for what the kits cannot see (real paint, real terminals).
- **Type check:** locally, `tsc -p .` with the types Claude Code lays in `.claude-plugin/types/` (gitignored; not committed, since that file is Claude Code's own); in CI the Claude Code half is checked by `claude plugin validate`. `tsc` against `@opencode/plugin` types for the OpenCode adapter.
- **CI:** GitHub Actions with least-privilege `permissions` and actions pinned by commit SHA: `bun test` on Ubuntu / macOS / Windows; `claude plugin validate` + `claude plugin test` on Ubuntu; OpenCode adapter type check against the latest `@opencode/plugin`; gitleaks secret scan; Dependabot for actions and npm.
- **Releases:** Conventional Commits → release-please (one release PR, `CHANGELOG.md`, version bumped in `package.json` and `.claude-plugin/plugin.json` together) → npm publish of `opencode-jei` through npm trusted publishing (OIDC, no stored token, provenance by default).
- **License:** MIT.

### 8.2 Repository layout

One repository serves both hosts. The repo root is the Claude Code plugin (so its marketplace installs the whole tree, `core/` included) and also the npm package OpenCode installs.

```
jei/
├── .claude-plugin/
│   ├── marketplace.json        # Claude Code: this repo is its own marketplace
│   └── plugin.json             # name "jei", version, userConfig, types
├── hooks/
│   ├── hooks.json              # { "modules": ["./register.tsx"] }
│   └── register.tsx            # Claude Code entry: wiring only → hosts/claude-code
├── core/                       # host-independent logic (§4.1)
│   ├── host.ts                 # the Host interface both adapters implement
│   ├── keys.ts                 # the one key map
│   ├── files/  search/  git/  activity/  shared/
├── hosts/
│   ├── claude-code/            # pane.tsx, views/*.tsx, activity hooks, Host impl
│   └── opencode/
│       ├── server.ts           # Plugin.define: Host impl, tool hooks, rpc handlers
│       ├── tui.tsx             # TUI entry: panel, keymap, dialogs
│       ├── rpc.ts              # shared server ↔ TUI contract
│       └── views/*.tsx         # Solid + OpenTUI views
├── types/index.d.ts            # Claude Code PluginState contract
├── test/                       # fixtures and the fake host for specs
├── test/fixtures/              # Search JSON and git porcelain samples
├── docs/                       # screenshots, GIFs for both hosts
├── package.json                # npm package for OpenCode: exports ".", "./tui", "./rpc"; scripts
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

Rules: entries stay thin; each tab owns a folder in `core/` and a view per host; anything that can be tested without a host is in `core/`. A new feature is not done until both `hosts/` have it.

### 8.3 Data flow

```
host events (tool hooks, file changes, cwd) ─┐
                                              ├─> refresh scheduler ─> core (parse, layout, rank) ─> view model ─> host view
user actions (keys, inputs) ─> Host runners ──┘    (debounced, cancels)
                               (git, rg, fs)
```

On OpenCode the left half (events, runners, core) runs in the server entry and view models cross to the TUI over RPC; on Claude Code it all runs in the mod. Every runner call is cancellable (signals / generation counters) so a fast-typing user or a busy agent never queues stale work.

---

## 9. Open-source hygiene and privacy

- No secrets, tokens, personal paths, usernames or real project names anywhere in the repo, its fixtures or its screenshots. Fixtures and screenshots use a sample repo (`acme-app`, fictional authors).
- JEI sends nothing over the network itself. The only model calls are the user-initiated ✦ Generate and Ask, through the user's own host session and provider. `git fetch/pull/push` talk to the user's own remotes.
- Never stage `.env*` or files matching common secret patterns in ✦/smart commit without showing them first.
- npm publishing runs from GitHub Actions through npm trusted publishing (OIDC): no npm token exists to leak; provenance is attached automatically.
- Commits use the maintainer's GitHub noreply email, never a personal address; the LICENSE names "The JEI contributors".
- Before each release: run a secret scan over the repo; `SECURITY.md` explains how to report issues.

---

## 10. Distribution

**Claude Code**
```
/plugin marketplace add maurild14/just-enough-ide
/plugin install jei@jei
```

**OpenCode** — add the npm package to `opencode.json(c)`; OpenCode installs it with Bun on next start:
```json
{ "plugins": ["opencode-jei"] }
```

The README states the requirements per host: Claude Code ≥ the pinned version, `/tui fullscreen` and ≥ 110 columns for docking; OpenCode 2.x ≥ 2.0.32 (the 1.x line is not supported); on both, `git` on PATH, optional `rg`, optional Nerd Font.

---

## 11. Milestones

Every milestone ships on **both hosts**.

| Version | Scope |
| --- | --- |
| **0.1** | `core/` + `Host` interface · pane shell + tabs + hint line · Files (tree, git status, shimmer, follow, preview, mention, open) · Git: repository row, Changes (stage/unstage/discard, commit, ✦), diff view |
| **0.2** | Git: Graph (lanes, expand commit, commit actions, agent ✦ markers, filter) · Branches (switch, create, compare with main) |
| **0.3** | Search (rg streaming, send to the agent, replace with preview) · Quick Open. Symbols was withdrawn; ADR 0027 removes its implementation and compatibility contracts. |
| **0.4** | Symbols removal, exact-case Replace, file operations in Files (new, rename, move, delete) · polish, public README, release 0.4.0 as the first public release |

Later candidates (not committed): Problems panel (tsc/eslint per file), Test Explorer, npm scripts & ports, TODO list of what the agent left, review queue ("unreviewed" files), blame-by-prompt.

---

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Claude Code mod API changes between releases | Pin a minimum version; CI runs `validate` and `test` against the latest Claude Code; fast patch releases |
| OpenCode V2 plugin API is new and evolving | Treat its exported types as the contract; pin a minimum version; type-check against the latest in CI; keep the adapter thin so changes stay local |
| The two hosts drift apart | One key map and one view model in `core/`; a feature is done only when both adapters have it; release checklist covers both |
| Large repos (100k+ files) | Lazy tree, capped lists, streaming search, paged graph, no full scans on every event |
| Git contention with the agent | `--no-optional-locks`, read-only plumbing for views, never auto-stash/auto-fetch in the background |
| Narrow pane | Every view designed for 40 columns; long lines wrap or truncate with ellipsis |
| Windows path and shell differences | No POSIX shell-outs; one path module in `core/` with tests for `C:\` and `/` forms; Windows in the CI matrix |

---

## 13. Decisions log

**Decided by the product owner**
- Name: **JEI — Just Enough IDE**. Everything (UI, docs, repo) in English. Open source.
- **Two hosts from the first release: Claude Code and OpenCode, in one repository.**
- Built from scratch.
- Three tabs: Files, Search, Git. Live filename search, content search and Quick Open are in; Symbols services, state, RPC and compatibility conversions are removed (ADR 0027). Unknown config values use ordinary defaults (Files); unknown command words use Files path handling.
- Git tab follows VS Code's Source Control layout (option A): repository row, Graph, Changes, branches; switch and create branches.
- Clicking a commit expands it inline with its files; clicking a file shows its diff **replacing the pane content** (unified, one column).
- Git extras accepted: Ask on commits/diffs, ✦ markers for the agent's commits, commit actions (copy hash, checkout, revert, open on GitHub), graph filter, compare branch with main.
- The activity shimmer is required.
- Git hooks: detect them; run hook-firing operations through Claude's shell tool only when the repo has hooks, directly otherwise.
- TypeScript plugin stack with no build step and zero runtime dependencies.

**Calls made by the spec author (review these)**
- v0.2 toolbar simplification: Fetch (`t`) and Filter (`f`); pull/push remain in Sync (`e`) and the existing Commit & Push path. Refresh is automatic.
- v0.2 revert simplification: merge commits are refused with `Reverting a merge commit is not supported.`
- OpenCode history uses native editable filter/branch dialogs and session-aware RPC with pinned comparison hashes; installed schema patterns are unsupported, so handlers enforce the exact hash regex. See ADR 0015.
- Host-independent `core/` with a `Host` interface; both adapters are thin. A feature ships on both hosts or on neither.
- The repo root is both the Claude Code plugin and the OpenCode npm package.
- On OpenCode, git, rg and file work run in the server entry; the TUI only draws (works with remote servers).
- Same single-letter/digit keys on both hosts, even though OpenCode allows more.
- On Claude Code, Esc stays the host's (back to the prompt); nested views use the shared `q` Back control, preserving one-level context (ADRs 0009 and 0017).
- Agent-facing labels use the host's name ("Ask Claude" / "Ask OpenCode").
- OpenCode 2.x only; the 1.x line has no side-panel slot.
- On OpenCode, mention/send opens an editable prefilled dialog and sends the message, since 2.x cannot insert into the prompt (§5.3).
- OpenCode tools are classified by id from `ctx.tool.list()` with an input-shape fallback.
- `commitModel` empty by default = the host's small model.
- Quick Open is nested under the Search tab.
- File operations (new, rename, move, delete with confirmation) are included, in 0.4.
- Switching branches with uncommitted changes asks; JEI never stashes on its own.
- ✦ Generate uses Conventional Commits format.
- Smart commit (stage all when nothing is staged) on by default, as in VS Code.
- Tabs switch with `1`–`3`.
- Slash command `/jei` on both hosts; MIT license; milestone order in §11.
- npm package name `opencode-jei`; Bun as the dev toolchain; release-please + npm trusted publishing.
- Claude Code surfaces: terminal first-class; Desktop app must render and work by click, polish best effort; VS Code/mobile out.
- Minimum Claude Code 2.1.302; minimum OpenCode 2.0.32.
- Sync follows the user's pull config; otherwise `--ff-only`, and on divergence it asks (merge / rebase / ask the agent).
- Search stays literal and case-insensitive. Replace edits only exact literal text including case; `case-differs` skips stay visible without dropping eligible edits. Non-UTF-8/binary and stale files remain refused.
- OpenCode 0.3 Search and replacement state is scoped by explicit sessionID plus the server-owned project root. Stored reviewed plans validate the entire selected subset before writes; partial operational failures return known written/skipped paths and an optional error. TUI wire-path checks are lexical; native platform/realpath checks stay server-side. See ADR 0022.
