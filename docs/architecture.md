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

- `core/git/run.ts`: `gitArgv(root, args)` builds `['git', '--no-optional-locks', '-C', root, ...args]`; `git(host, root, args, options?)` runs it with `GIT_ENV` (`GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`) merged under the caller's env and throws `GitError` on a non-zero exit. `GitError` carries `argv`, `exitCode`, `stderr` and `firstLine` (first non-empty stderr line, then stdout, then `git exited with <code>`).
- `core/git/status.ts`: `parseStatus` reads `STATUS_ARGS` output (`status --porcelain=v2 -z --branch --untracked-files=all`) into `{ branch, entries }`. `branch.head` is `null` when detached, `branch.oid` is `null` before the first commit. Every unmerged code (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) maps to `conflicted` on both sides. `folderStatus` rolls entries up to each ancestor folder (conflicted > modified > added > untracked; deleted and renamed count as modified; ignored is skipped). `isRepo` returns the root exactly as git prints it (newline trimmed), or `null` outside a repo.
- `core/git/diff.ts`: `parseUnifiedDiff` turns `git diff` text into `DiffFile[]` (`path`, `origPath` for renames, `binary`, `added`/`removed`, `hunks` of `DiffLine`). Line kinds are `add`, `del`, `ctx` and `meta` (`\ No newline at end of file`); `text` has no `+`/`-`/space prefix and no trailing CR; `oldNo`/`newNo` are set per kind. It decodes C-quoted paths (octal escapes as UTF-8), reads `rename from/to`, takes the `+++` side for names with spaces, and handles the `--no-index` form for untracked files (`a/` side is `/dev/null` or `NUL`; the path comes from the `b/` side). `parseNumstat` reads `diff --numstat -z` (a rename is the record `added TAB removed TAB`, then NUL, the old path, NUL, the new path, NUL; `null` counts mean binary). `capDiff(file, max)` counts hunk lines, keeps whole hunks before the cut and slices the cut hunk (its `@@` header counts are recomputed; `added`/`removed` stay the full-file totals). `workingDiffArgs` and `untrackedDiffArgs` build the argv (`NUL` on win32, `/dev/null` elsewhere); `git diff --no-index` exits 1 when files differ, so callers accept exit 1 for it. `toUnifiedText` re-serializes a file (`---`/`+++`, `/dev/null` for new and deleted files, plus hunks; CRLF is not preserved) for a `diff` code block. Fixtures live in `test/fixtures/diff/`.
- `core/git/commands.ts`: argv tails for `git()`: `stageArgs`, `unstageArgs` (`restore --staged`; both return `[]` for no paths, so callers skip the step), `discardPlan` and `discardArgs`, `commitSteps`. `discardPlan` routes by worktree status: untracked goes to `clean -f`, worktree modified/deleted goes to `restore --worktree`; entries with no worktree change (for example staged-added only) are skipped. `commitSteps` runs `add -A` first only for a smart commit with nothing staged (never for amend); `commit-push` appends `push` (or `push -u origin <publish>` when the caller passes `publish`, the branch head, because there is no upstream), `amend` uses `commit --amend -m`.
- `core/git/sync.ts`: `syncSteps(cfg, branch)` for the repository-row Sync. Detached HEAD gives `[]` (the caller shows a message); no upstream gives `push -u origin <branch>`; behind 0 gives `push`; otherwise `pull` (plain when `pull.rebase` or `pull.ff` is set, else `pull --ff-only`) then `push` when ahead. `isDivergence` matches git's ff-only refusals ("Not possible to fast-forward", "diverging branches", "Need to specify how to reconcile divergent branches"); matching is case-insensitive. `resolveDivergence` returns `pull --no-rebase --ff` (merge) or `pull --rebase`, then `push`.
- `core/git/hooks.ts`: `readHookSignals(host, root)` uses only the Host: `config --get core.hooksPath` (exit 1 means unset), `.git/hooks` located through `rev-parse --git-path hooks` (correct in linked worktrees), `.husky/`, `lefthook.yml` / `.lefthook.yml`, `.pre-commit-config.yaml`, and `.gitattributes` text. `usesHooks` ignores `*.sample` hook files and treats `filter=lfs` as a hook-like signal.
- `core/git/sensitive.ts` and `core/git/message.ts`: see `docs/security.md` for the sensitive list; `commitPrompt` asks for one Conventional Commits message (subject up to 72 characters) with the diff cut to `maxChars` and a truncation note, `cleanMessage` strips a leading "Commit message:", unwraps a fence only when the text starts with one (unterminated accepted; a fence inside a body is kept) and strips surrounding quotes; `commitPrompt` never cuts a surrogate pair.

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
  shared/{paths.ts, fuzzy.ts, argv.ts}
  git/{run.ts, status.ts, diff.ts, commands.ts, hooks.ts, message.ts, sensitive.ts}
  activity/{classify.ts, shell.ts, log.ts}
  files/{tree.ts, preview.ts, csv.ts, open.ts, mention.ts}
hosts/claude-code/    host.ts, state.ts, pane.tsx, files.tsx, git.tsx, diff.tsx, activity.ts, *.test.tsx
hosts/opencode/       host.ts, rpc.ts, server.ts, tui.tsx, pane.tsx, files.tsx, git.tsx, diff.tsx, *.spec.ts(x)
types/index.d.ts      Claude Code PluginState contract
test/fixtures/        git porcelain samples, diff samples, LSP text samples
docs/                 this documentation; docs/plans/ holds implementation plans
scripts/              dev scripts (check-docs.ts)
```

Later milestones add `core/search/` (0.3), `core/symbols/` (0.4) and `core/fsops.ts` (0.5). Status: draft — built in the milestone shown.

## Packaging

The repo root is both the Claude Code plugin (the marketplace installs the whole tree, `core/` included) and the `opencode-jei` npm package (`exports` `.`, `./server`, `./tui`, `./rpc`). The npm `files` list excludes specs. There is no build step: both hosts load TypeScript directly.
