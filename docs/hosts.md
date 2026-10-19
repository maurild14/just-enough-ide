# Hosts

> Purpose: verified API facts, limits and version floors for Claude Code mods and OpenCode 2.x plugins · Status: current · Last reviewed: 2026-10-19

Source: `PRD.md` §4.2 to §4.4, verified in October 2026. Both APIs are young; a host's exported types are the contract. If a fact here turns out wrong, fix this file and say so in the commit.

## Claude Code

Minimum version **2.1.302**. CI also runs against the latest release. The mod API is early access.

**Mod rules.** A hooks module has no Node, no DOM, no `WebAssembly`, no `eval` and no dynamic `import()`. Imports must stay inside the plugin folder (which is why the whole repo root is the plugin and `core/` ships with it). Relative imports keep their `.ts` extension. `userConfig` values in `plugin.json` are strings; on/off settings are `"on"`/`"off"` pickers.

**Types.** `.claude-plugin/types/` is laid by Claude Code, gitignored and never committed. The plugin's own state contract is `types/index.d.ts`.

| Need | API |
| --- | --- |
| Docked pane | `$.ui.open({ id, title })`, rendered on `ui.render` for `{ component: 'Pane', requestId }` |
| Elements | `$.ui.resolve(e)` gives `Box`, `Text`, `Button`, `Input`, `Select`, `Code`, `Markdown`, `Image`, `Raster` |
| Colored diffs | `Code` with `format: 'diff'` (plain if the text is not a valid unified diff) |
| Run git or rg | `$.process.run(argv, { cwd, timeoutMs, stdin })` (4 MiB stdout cap, 30 s default timeout); `$.process.spawn` to stream |
| Files | `$.fs.read`, `write` (UTF-8, 4 MiB), `list`, `exists`, `stat`, `ancestors` |
| Agent activity | `tool.call` hooks on `Read`, `Edit`, `Write`, `NotebookEdit`, `Grep`, `Glob`, `Bash`, `PowerShell` |
| Disk and cwd changes | `classic.FileChanged`, `classic.CwdChanged`, `watchPaths` from `classic.SessionStart` |
| Text into the prompt | `$.prompt.fill({ text, mode: 'insert' })` |
| Commit message model | `$.model.complete({ model, prompt })` on the session's own client; no API key |
| State | `$.state` (session, drives redraws) declared in `types/index.d.ts`; `$.store` across sessions |
| Slash command | `$.command.register` and `command.run` |
| LSP (milestone 0.4) | `$.tool.call({ tool: 'LSP', ... })`; the result is formatted text, may need a permission; check first with `$.tool.check` |

**Keys.** A pane receives keys only through its `Button`s: a `hotkey` is one digit or one lowercase letter. Tab and arrows walk the focus ring; Esc returns to the prompt. There is no raw key event, so the single-key rule in `core/keys.ts` follows from this.

**Layout and surfaces.** Docking beside the transcript needs `/tui fullscreen`; a pane opened unasked seats from about 110 to 144 columns, inline below that. Body width is `e.props.bodyColumns` (expect 40 to 60). The terminal is first class; the Desktop app also draws mod panes (`e.surface === 'desktop'`), so every tree must be valid there and work by click. Mods do not load in the Desktop app's WSL sessions, the VS Code chat panel or `claude -p`. Mouse works only in the fullscreen layout.

**Adapter structure.** Status: current for the pane shell (plan Task 10).
- `hooks/register.tsx` is wiring only: `session.start` registers `/jei`, writes `cwd` and the opening tab; a pass-through `ui.render` hook on `PromptHint` opens the pane unasked once, only when `options.startOpen` and `e.viewport.isFullscreen` is true (session start knows no viewport); `command.run` for `jei` answers its own command (`JEI opened.`, `JEI closed.`, `JEI opened on <Tab>.`) and opens with `focus`; `classic.CwdChanged` updates `cwd` (its `.catch` passes the event on); `ui.render` on `{ component: 'Pane', requestId: 'jei' }` calls `renderPane`.
- `hosts/claude-code/state.ts` declares the atoms (`pane`, `cwd`, `activity`, `git`, `tree`, plugin `jei`) and the accessors other files use (`readPane`, `updatePane`, `setCwd`, ...). `claude plugin validate` traces a state call only to an atom declared in the same file, and follows `$` across an import only into a function declaration, so state calls live in `state.ts` and accessors are `function` declarations. A matcher's `requestId` must be a literal.
- `types/index.d.ts` is self-contained (no imports) and repeats core's shapes as JSON; `state.ts` fails to compile if they drift. `GitSnapshot`'s count `Map`s are stored as records (`gitState`), because state is JSON.
- `hosts/claude-code/host.ts` is `claudeHost($, platform)`: `$.process.run` (no signal support: an aborted call never starts), `$.fs.list`, `$.fs.stat(path, { resolve: true })`, `$.fs.read` (bytes mode for `readHead`), `$.model.complete` (model `haiku` when empty; no answer throws).
- `hosts/claude-code/pane.tsx` draws the shell from `bodyColumns` and `scroll.bodyRows` on every render. Tabs are `Button`s keyed `tab-1`..`tab-4` with hotkeys `1`..`4`, the current one `variant="primary"` and bold; the terminal draws them as `[ 1 Files ]`, so the bar budgets 4 cells of chrome per tab and shrinks the gap (2, 1, 0) before shortening labels. A `Text` takes no `key`, so named rows (`rule`, `header`, `hint`, `body-<n>`) are keyed `Box`es holding one `Text`.
- `classic.CwdChanged` does not run for a person-installed plugin where an organization manages Claude Code; there `cwd` stays the session's start directory.

**Git hooks.** `$.process.run` runs git with repo hooks off. When a repo uses hooks (detected in `core/git/hooks.ts`), hook-firing operations go through Claude Code's shell tool via `$.tool.call`, after `$.tool.check`. See `docs/decisions/0006-hooks-aware-commit-on-claude-code.md`.

## OpenCode

Target: **OpenCode 2.x only**, minimum **2.0.32**. The 1.x line has no `session.panel` slot. CI type-checks against the latest `@opencode/plugin`.

**Entries.** A package has a server entry (`@opencode/plugin`, `Plugin.define({ id, setup(ctx) })`) and a TUI entry (`@opencode/plugin/tui`, exported as `./tui`). The loader resolves `index`, `tui` and `rpc` in the package folder, which is why the repo root has `index.ts`, `tui.ts` and `rpc.ts`. The RPC contract is `Rpc.define({ id: 'jei', methods, events })` from `@opencode/plugin`. Anything touching files or git runs in the server entry; the TUI may be remote.

| Need | API |
| --- | --- |
| Docked pane | `context.ui.panel.open(name, { presentation })` and `context.ui.slot({ replace/append: 'session.panel', render })`; slot input has reactive `name`, `sessionID`, `width`, `presentation`, `focused` plus `focus()`, `close()`, `toggleFullscreen()` |
| Full-screen views | `context.ui.router.register({ name, render })` |
| Drawing | OpenTUI elements in Solid JSX (peers `@opentui/solid`, `@opentui/core`); colors from `context.theme` and `context.themeMode` |
| Keys and slash command | `context.keymap.layer(() => ({ commands, bindings }))`; a command has `id`, `title`, `bind`, `palette`, `slash`, `run` |
| Dialogs and toasts | `ui.dialog.confirm`, `ui.dialog.select`, `ui.dialog.prompt({ title, value })`, `ui.toast.show` |
| Processes and files | Server entry: `node:child_process` `spawn` with argv arrays, `node:fs/promises` |
| Server and TUI link | Server: `ctx.rpc.register(definition, handlers)` returns a registration with `emit`; TUI: `context.client.rpc` |
| Agent activity | Server: `ctx.tool.hook('execute.after')` (and `execute.before`) with `tool`, `sessionID`, `input`, `status`, `result`; events `filesystem.changed`, `vcs.branch.updated` |
| Commit message model | `client.generate.text({ prompt: { prompt, model? } })` returns `{ text }` |
| Storage | `context.storage` in the TUI, `ctx.storage` on the server |

**Known gaps.**
- No API to insert text into the user's prompt. Mention and send open an editable `ui.dialog.prompt` prefilled with the text, then send it with `client.session.prompt({ sessionID, text })`. Esc cancels.
- No LSP or symbol call in the 2.x client, so Symbols is approximate only there (milestone 0.4; re-check then).
- No diff element: JEI renders `core`'s parsed hunks line by line with theme colors.

**Keys.** `keymap` allows chords, but JEI uses the same single-letter and digit keys as Claude Code. Never bind `ctrl+n` or `ctrl+p` (reserved by OpenCode's dialogs). On narrow terminals OpenCode shows panels full screen.

**Tools.** Tool names are read from `ctx.tool.list()` at runtime; `core/` classifies a call by tool id first and by input shape (a `filePath` or `path` field, a `command` field) as fallback.

**Git hooks.** Git runs as a normal process, so repo hooks fire; nothing special is needed.

## Both hosts

Every view renders at 40 columns; git always runs with `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0`; no shell strings; agent labels use the host's name (Ask Claude, Ask OpenCode). Behavior differences are limited to those listed above and are recorded in `PRD.md` §13.
