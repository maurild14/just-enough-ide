# Architecture

> Purpose: how JEI is split between a host-independent core and two thin host adapters, and how data moves · Status: current · Last reviewed: 2026-10-19

The layout is fixed; modules appear as plan Tasks 3-17 are built (see `docs/quality.md`). Source: `PRD.md` §4.1 and §8.

## The core rule

Everything that is not drawing or talking to a host lives in `core/`: git output parsers, diff parsing, fuzzy ranking, shell read-target parsing, path handling, the key map, pane state and view models. `core/` imports nothing from either host and uses no Node, Bun or DOM API, only ECMAScript built-ins. Reason: Claude Code mods have no Node, OpenCode plugins run on Bun or Node; only pure TypeScript runs in both.

`core/` receives a `Host` and returns plain data. UI actions (toast, confirm, handing text to the agent) stay in each adapter.

## The Host interface

Status: current. Defined in `core/host.ts`; the process, file and model half only:

- `platform`: `'win32' | 'darwin' | 'linux'`
- `run(argv, { cwd, env, stdin, timeoutMs, signal })` returns `{ exitCode, stdout, stderr }`
- `list(dir)`, `stat(path)`, `readHead(path, maxBytes)`, `readText(path)`
- `complete(prompt, model)`: one-shot model call for the generated commit message

## Key map and actions

`core/keys.ts` holds the one key map. `KEYS[view]` lists `{ key, action, label }` in hint-line priority (lowest priority last); adapters dispatch on `action`. `TAB_KEYS` maps `1`-`4` to tabs. `hintLine(view, columns)` builds the hint line for any width: items in priority order, `esc` always kept when it fits, the longest priority prefix that fits labelled (`s stage`, joined by ` · `), then the remaining items that still fit as bare keys (`u d c`). Below 32 columns every item is bare. A word is never cut, the line never exceeds `columns`, and the number of keys shown never drops as the width grows.

| View | key: action |
| --- | --- |
| `files` | `up`: move-up, `down`: move-down, `enter`: activate, `a`: mention, `o`: open-editor, `f`: filter, `h`: toggle-hidden, `esc`: back |
| `files.preview` | `up`: scroll-up, `down`: scroll-down, `a`: mention, `o`: open-editor, `m`: toggle-markdown-source, `esc`: back |
| `git` | `up`: move-up, `down`: move-down, `enter`: activate, `s`: stage, `u`: unstage, `d`: discard, `c`: commit, `g`: generate-message, `e`: sync, `esc`: back |
| `git.diff` | `up`: scroll-up, `down`: scroll-down, `n`: next-hunk, `p`: prev-hunk, `j`: next-file, `k`: prev-file, `a`: ask-review, `o`: open-editor, `esc`: back |
| `search`, `symbols` | `up`: move-up, `down`: move-down, `enter`: activate, `esc`: back (more keys arrive in 0.3 and 0.4) |

Action names are stable; rename one only with every consumer in the same change.

## Adapters

| Host | Where | Implements Host with | Draws with |
| --- | --- | --- | --- |
| Claude Code | `hosts/claude-code/`, entry `hooks/register.tsx` | `$.process.run`, `$.fs`, `$.model.complete` | `$.ui` elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Code`, `Markdown`) |
| OpenCode | `hosts/opencode/`, entries `index.ts`, `tui.ts`, `rpc.ts` | `node:child_process` and `node:fs/promises` in the server entry, `client.generate.text` | Solid + OpenTUI views in the TUI entry |

Adapters stay thin: wiring, drawing, host-specific delivery of text to the agent. Anything testable without a host moves to `core/`.

## Data flow

```
host events (tool hooks, file changes, cwd) -+
                                              +-> refresh scheduler -> core (parse, layout, rank) -> view model -> host view
user actions (keys, inputs) -> Host runners --+    (debounced, cancels)
                               (git, rg, fs)
```

Every runner call is cancellable (signals or generation counters, `core/latest.ts`), so a fast-typing user or a busy agent never queues stale work.

**Claude Code.** One process: hooks listen to `tool.call` and `classic.FileChanged`; the mod runs git and reads files through `$`, keeps pane state in `$.state`, and draws with `$.ui`. Panes open with `$.ui.open` and render on `ui.render`.

**OpenCode.** Two entries linked by one RPC contract (`hosts/opencode/rpc.ts`, `JeiRpc`). The server entry runs git and file work next to the files, observes tool hooks and events, and answers RPC calls. The TUI entry only draws: it owns the keymap layer and dialogs and calls the server through `context.client.rpc`. Server-pushed updates use the registration's `emit`. This keeps JEI working when the TUI is attached to a remote server.

## Git layer

Status: current for `run.ts`, `status.ts`, `diff.ts`, `commands.ts`, `hooks.ts`, `sensitive.ts`, `sync.ts` and `message.ts`.

- `core/git/run.ts`: `gitArgv(root, args)` builds `['git', '--no-optional-locks', '-C', root, ...args]`; `git(host, root, args, options?)` runs it with `GIT_ENV` (`GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, `GIT_LITERAL_PATHSPECS=1` so a path such as `app/[id]/page.tsx` is never a glob, `GIT_MERGE_AUTOEDIT=no` and `GIT_TERMINAL_PROMPT=0` so no editor or credential prompt can hang a pane) merged under the caller's env and throws `GitError` on a non-zero exit. `GitError` carries `argv`, `exitCode`, `stderr` and `firstLine` (first non-empty stderr line, then stdout, then `git exited with <code>`).
- `core/git/status.ts`: `parseStatus` reads `STATUS_ARGS` output (`status --porcelain=v2 -z --branch --untracked-files=all`) into `{ branch, entries }`. `branch.head` is `null` when detached, `branch.oid` is `null` before the first commit. Every unmerged code (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) maps to `conflicted` on both sides. `folderStatus` rolls entries up to each ancestor folder (conflicted > modified > added > untracked; deleted and renamed count as modified; ignored is skipped). `isRepo` returns the root exactly as git prints it (newline trimmed), or `null` outside a repo.
- `core/git/diff.ts`: `parseUnifiedDiff` turns `git diff` text into `DiffFile[]` (`path`, `origPath` for renames, `binary`, `added`/`removed`, `hunks` of `DiffLine`). Line kinds are `add`, `del`, `ctx` and `meta` (`\ No newline at end of file`); `text` has no `+`/`-`/space prefix and no trailing CR; `oldNo`/`newNo` are set per kind. It decodes C-quoted paths (octal escapes as UTF-8), reads `rename from/to`, takes the `+++` side for names with spaces, and handles the `--no-index` form for untracked files (`a/` side is `/dev/null` or `NUL`; the path comes from the `b/` side). `parseNumstat` reads `diff --numstat -z` (a rename is the record `added TAB removed TAB`, then NUL, the old path, NUL, the new path, NUL; `null` counts mean binary). `capDiff(file, max)` counts hunk lines, keeps whole hunks before the cut and slices the cut hunk (its `@@` header counts are recomputed; `added`/`removed` stay the full-file totals). `workingDiffArgs` and `untrackedDiffArgs` build the argv (`NUL` on win32, `/dev/null` elsewhere); `git diff --no-index` exits 1 when files differ, so callers accept exit 1 for it. `toUnifiedText` re-serializes a file (`---`/`+++`, `/dev/null` for new and deleted files, plus hunks; CRLF is not preserved) for a `diff` code block. Fixtures live in `test/fixtures/diff/`.
- `core/git/commands.ts`: argv tails for `git()`: `stageArgs`, `unstageArgs` (`restore --staged`; both return `[]` for no paths, so callers skip the step), `discardPlan` and `discardArgs`, `commitSteps`. `discardPlan` routes by worktree status: untracked goes to `clean -f`, worktree modified/deleted goes to `restore --worktree`; entries with no worktree change (for example staged-added only) are skipped. `commitSteps` runs `add -A` first only for a smart commit with nothing staged (never for amend); `commit-push` appends `push` (or `push -u origin <publish>` when the caller passes `publish`, the branch head, because there is no upstream), `amend` uses `commit --amend -m`.
- `core/git/sync.ts`: `syncSteps(cfg, branch)` for the repository-row Sync. Detached HEAD gives `[]` (the caller shows a message); no upstream gives `push -u origin <branch>`; behind 0 gives `push`; otherwise `pull` (plain when `pull.rebase` or `pull.ff` is set, else `pull --ff-only`) then `push` when ahead. `isDivergence` matches git's ff-only refusals ("Not possible to fast-forward", "diverging branches", "Need to specify how to reconcile divergent branches"); matching is case-insensitive. `resolveDivergence` returns `pull --no-rebase --ff` (merge) or `pull --rebase`, then `push`.
- `core/git/hooks.ts`: `readHookSignals(host, root)` uses only the Host: `config --get core.hooksPath` (exit 1 means unset), `.git/hooks` located through `rev-parse --git-path hooks` (correct in linked worktrees), `.husky/`, `lefthook.yml` / `.lefthook.yml`, `.pre-commit-config.yaml`, and `.gitattributes` text. `usesHooks` ignores `*.sample` hook files and treats `filter=lfs` as a hook-like signal.
- `core/git/sensitive.ts` and `core/git/message.ts`: see `docs/security.md` for the sensitive list; `commitPrompt` asks for one Conventional Commits message (subject up to 72 characters) with the diff cut to `maxChars` and a truncation note, `cleanMessage` strips a leading "Commit message:", unwraps a fence only when the text starts with one (unterminated accepted; a fence inside a body is kept) and strips surrounding quotes; `commitPrompt` never cuts a surrogate pair.

## Files layer

Status: current for `core/files/` and `core/shared/fit.ts`.

- `core/shared/fit.ts`: the responsive helpers both hosts use so a row never overflows. `cellWidth` counts terminal cells (East Asian wide and fullwidth and emoji are 2, combining marks and joiners 0, the rest 1; compact range tables, no dependency). `fitEnd(s, width, ellipsis?)` ends with an ellipsis. `fitPath(rel, width, ellipsis?)` uses a middle ellipsis that keeps the file name (`src/…/user.ts`) and, when the name alone is too wide, end-ellipsizes the name and keeps its extension. `padEnd` pads by cells and never truncates. Every `fitEnd` and `fitPath` result is at most `width` cells for any width of 0 or more. The optional `ellipsis` is the active glyph set's ellipsis (`…` or `...`). See `docs/design.md` section 5.
- `core/shared/tabs.ts`: `tabBar(columns, room, active, chrome)` picks the tab labels for a pane width (all named from 60 columns, only the active one from 32, numbers below), budgets `chrome` cells per tab for hosts that draw button chrome, and shrinks the gap 2, 1, 0 before shortening labels. `TAB_NAMES` are the tab words. `core/shared/paths.ts` `projectRel(root, path)` turns a typed path (absolute or relative) into a posix rel inside `root`, or `null` when it is outside or escapes.
- `core/files/tree.ts`: `treeRows` flattens the expanded tree from `listings` (key `''` is the root). Dirs come first, then names case-insensitively. `.git` is never shown; dot entries and `ignored` paths show only with `showHidden`. Past `limit` entries in one folder a single `{ rel, depth, more }` row follows with the count; its `rel` is `<folder>/…`, and the host builds the text. `filterRows` ranks every known path with `fuzzyScore`; `reveal` returns a copy of `expanded` plus the ancestors of a path; `IGNORED_ARGS` is the `git check-ignore` tail (paths on stdin).
- `core/files/preview.ts`: `previewKind` decides in this order: size 0 is `empty`, an image extension is `image` (even when large, because it is never read), over `PREVIEW_MAX_BYTES` is `too-large`, a NUL in the first 8 KiB is `binary`, then markdown, csv, tsv, else `code`. `languageOf` maps a name to a highlight id. `core/files/csv.ts`: `parseDelimited` handles quoted fields, doubled quotes, CRLF and a BOM, and stops at `maxRows`.
- `core/files/open.ts`: `openArgv` returns the OS opener for an empty command. Otherwise it splits the command, replaces `{path}` and `{line}` inside words (the rest of the word is kept) and appends the path when no word has `{path}`. With no line, `:{line}` is stripped from a word that has `{path}`, and a word that has `{line}` but no `{path}` is dropped.
- `core/files/icons.ts`: `iconFor` returns one cell: `▸ ▾ ·` for `plain` and `auto` (`auto` is plain in 0.1), and a small Nerd Font map for `nerd`. `core/files/mention.ts`: `mentionText` joins posix rels as `@a @"my file" ` with one trailing space.

## Activity, pane state and command

Status: current for `core/activity/`, `core/latest.ts`, `core/pane.ts` and `core/command.ts`.

- `core/activity/classify.ts`: `classifyTool(tool, input)` maps a tool call to `{ kind: 'read' | 'write' | 'git', paths }` or `null`. Ids are case-insensitive: `read`; `edit`, `write`, `multiedit`, `NotebookEdit` (`notebook_path`), `patch` (paths may be empty); `grep`, `glob`, `list` (read, paths from `path` or empty, the adapter fills them from the result); `bash`, `PowerShell`, `shell` go to `classifyShell`. Unknown ids fall back to read when the input has `filePath`, `file_path` or `path`, to the shell classifier when it has `command`, else `null`. Paths are raw (absolute or as given); the adapter converts them with `relativeTo`.
- `core/activity/shell.ts`: `classifyShell` splits a command line outside quotes on `|`, `||`, `&&`, `;` and `&`, tokenizes each segment with `splitCommand`, drops redirections and flags (and the value of known value flags such as `head -n 5`), and reads file words of `cat head tail less more bat type Get-Content` (`-Path`/`-LiteralPath` value) and `rg`/`grep` (first word is the pattern unless `-e`/`-f`). `git` with `commit push pull checkout switch merge rebase reset` is kind `git` (wins over reads); `status diff log show` and everything else give `null`. Nothing is executed.
- `core/activity/log.ts`: `ActivityLog` takes `now` as an argument everywhere (no clock inside). `glow` falls linearly from 1 to 0 over `GLOW_MS` (2000); `isGlowing` tells adapters whether to keep a redraw timer; `touched` stays true for the session; `toJSON`/`from` round-trip. `allows(setting, kind)` applies the `activity` option (`git` shows unless `none`).
- `core/latest.ts`: `latest(fn)` is the refresh guard. Only the most recent call yields `{ value, stale: false }`; an older call yields `{ stale: true }` even when it rejects; a rejected latest call rejects.
- `core/pane.ts`: `reducePane` is pure. `tab` resets the stack to the tab's root view but keeps `selected` (per-view selection survives tab switches). `open-diff` pushes `git.diff` and records `diff`; `preview` pushes `files.preview` and selects the file in Files; both switch tab when needed. `back` pops (restoring `git` with `selected.git` intact) and is a no-op on a root view.
- `core/command.ts`: `parseJeiArgument` trims; empty toggles; a tab name (any case) opens that tab; anything else reveals a posix-normalized path (no leading `./`) in Files.

## Services

Status: current for `core/git/service.ts` and `core/files/service.ts`. These are the only core entry points the adapters call besides pure helpers; each takes a `Host` and returns plain data.

- `core/git/service.ts`: `snapshot(host, cwd)` returns `{ root: null }` outside a repo, else `{ root, status, numstat, staged, hooks }` (status, `diff --numstat` and `diff --cached --numstat` counts keyed by path, `usesHooks`). `stage`, `unstage` skip git for no paths; `discard` runs `discardPlan` (callers confirm first). `fileDiff` returns one `DiffFile` capped at 5,000 lines (`DIFF_MAX_LINES`); untracked files use `--no-index` and exit 1 counts as success. `generateMessage` sends the staged diff (the working diff when nothing is staged) cut to 12,000 characters to `host.complete` and runs `cleanMessage`. `commitPlan` is pure: steps from `commitSteps` (with `publish` set to the branch head for `commit-push` without an upstream), `sensitive` is the sensitive subset of what the commit will include (every changed path when the smart commit runs `add -A`, else the staged paths), `viaAgentShell` is `snap.hooks`. `runSteps` stops at the first `GitError`. `sync` reads `pull.rebase`/`pull.ff`, runs `syncSteps` and returns `{ ok: true }`, `{ ok: false, divergence: true }` (only without a `choice`) or `{ ok: false, error: <first line> }`; a detached HEAD gives `Detached HEAD: check out a branch to sync.`; with `choice` it runs `resolveDivergence`.
- `core/files/service.ts`: `listDir` lists a folder and asks `git check-ignore --stdin -z` which listed paths are ignored (none outside a repo). `loadPreview` stats first (size settles empty, image and too-large without reading), reads at most `PREVIEW_MAX_BYTES`, and returns `text` plus `language`, or `rows` (200 at most) for csv/tsv; a missing path or a folder is `empty`. `allFiles` is `ls-files -co --exclude-standard -z` in a repo, else a breadth-first walk capped at 20,000 entries that skips `.git` and `node_modules`. `openFile` runs `openArgv` and ignores the exit code (some openers exit 1 on success).

## Dependency direction

```
hooks/, index.ts, tui.ts, rpc.ts     entries: wiring only
        |
hosts/claude-code    hosts/opencode   never import each other
        \                /
              core/                   imports nothing from above
```

- `core/` never imports from `hosts/`, entries or host packages.
- The two adapters never import each other. Shared logic moves down into `core/`.
- Inside `core/`, `host.ts`, `keys.ts` and `shared/` are leaves; tab folders (`files/`, `git/`, `activity/`) may use `shared/` and `host.ts`, not each other's internals except through exported types.
- Specs may use `bun:test` and `node:*`; the purity rule binds non-spec files.

## File map

```
.claude-plugin/{plugin.json, marketplace.json}   Claude Code plugin manifest and marketplace
hooks/{hooks.json, register.tsx}                  Claude Code entry, wiring only
index.ts  tui.ts  rpc.ts                          OpenCode entries (re-export hosts/opencode/*)
core/
  host.ts  keys.ts  options.ts  latest.ts  pane.ts
  shared/{paths.ts, fuzzy.ts, argv.ts, fit.ts, tabs.ts}
  git/{run.ts, status.ts, diff.ts, commands.ts, hooks.ts, message.ts, sensitive.ts, sync.ts, service.ts}
  activity/{classify.ts, shell.ts, log.ts (ActivityLog, allows, shimmerPhase)}
  files/{tree.ts, preview.ts, csv.ts (parseDelimited, fitTable), open.ts, icons.ts, mention.ts, service.ts}
hosts/claude-code/    host.ts, state.ts, theme.ts, pane.tsx, files.tsx, git.tsx, diff.tsx, activity.ts, *.test.tsx, measure.ts (test helper)
hosts/opencode/       host.ts, rpc.ts, server.ts, tui.tsx, pane.tsx, files.tsx, git.tsx, diff.tsx, *.spec.ts(x)
types/index.d.ts      Claude Code PluginState contract
test/fake-host.ts     spec-only Host over a temp dir and real git
test/fixtures/        git porcelain samples, diff samples, LSP text samples
docs/                 this documentation; docs/plans/ holds implementation plans
scripts/              dev scripts (check-docs.ts)
```

Later milestones add `core/search/` (0.3), `core/symbols/` (0.4) and `core/fsops.ts` (0.5). Status: draft — built in the milestone shown.

## Packaging

The repo root is both the Claude Code plugin (the marketplace installs the whole tree, `core/` included) and the `opencode-jei` npm package (`exports` `.`, `./server`, `./tui`, `./rpc`). The npm `files` list excludes specs. There is no build step: both hosts load TypeScript directly.
