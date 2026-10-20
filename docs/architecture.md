# Architecture

> Purpose: how JEI is split between a host-independent core and two thin host adapters, and how data moves · Status: current · Last reviewed: 2026-10-20

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

`core/keys.ts` holds the one key map. `KEYS[view]` lists `{ key, action, label }` in hint-line priority (lowest priority last); adapters dispatch on `action`. `TAB_KEYS` maps `1`-`4` to tabs. `hintLine(view, columns, keys?)` builds the hint line for any width: items in priority order, `esc` always kept when it fits, the longest priority prefix that fits labelled (`s stage`, joined by ` · `), then the remaining items that still fit as bare keys (`u d c`). Below 32 columns every item is bare. A word is never cut, the line never exceeds `columns`, and the number of keys shown never drops as the width grows.

| View | key: action |
| --- | --- |
| `files` | `up`: move-up, `down`: move-down, `enter`: activate, `a`: mention, `o`: open-editor, `f`: filter, `h`: toggle-hidden, `esc`: back |
| `files.preview` | `up`: scroll-up, `down`: scroll-down, `a`: mention, `o`: open-editor, `m`: toggle-markdown-source, `esc`: back |
| `git` | `up`: move-up, `down`: move-down, `enter`: activate, `s`: stage, `u`: unstage, `d`: discard, `c`: commit, `y`: copy-hash, `a`: ask, `b`: branches, `f`: filter, `t`: fetch, `n`: new-branch, `g`: generate-message, `e`: sync, `esc`: back |
| `git.branches` | `up`: move-up, `down`: move-down, `enter`: switch, `n`: new-branch, `c`: compare, `f`: filter, `esc`: back |
| `git.diff` | `up`: scroll-up, `down`: scroll-down, `n`: next-hunk, `p`: prev-hunk, `j`: next-file, `k`: prev-file, `a`: ask-review, `o`: open-editor, `esc`: back |
| `search`, `symbols` | `up`: move-up, `down`: move-down, `enter`: activate, `esc`: back (more keys arrive in 0.3 and 0.4) |

Action names are stable; rename one only with every consumer in the same change.

The v0.2 keys are defined in core; see `docs/quality.md` for host availability. `n` in Git creates from the selected graph commit, while Branches creates from HEAD. `PaneState.diff` is `{ source: DiffSource; path: string }`, with working `{ kind: 'working'; staged; untracked }`, commit `{ kind: 'commit'; hash }` or compare `{ kind: 'compare'; base; head }` sources. `open-diff` carries the same fields; `branches` pushes `git.branches`. Diff/back preserves the current Git stack and selection. Both hosts consume all three sources.

## Adapters

| Host | Where | Implements Host with | Draws with |
| --- | --- | --- | --- |
| Claude Code | `hosts/claude-code/`, entry `hooks/register.tsx` | `$.process.run`, `$.fs`, `$.model.complete` | `$.ui` elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Code`, `Markdown`) |
| OpenCode | `hosts/opencode/`, entries `index.ts`, `tui.ts`, `rpc.ts` | `node:child_process` and `node:fs/promises` in the server entry, `ctx.generate.text` | Solid + OpenTUI views in the TUI entry |

Adapters stay thin: wiring, drawing, host-specific delivery of text to the agent. Anything testable without a host moves to `core/`.

Claude Code's `graph.tsx` contributes rows and contextual actions to `git.tsx`'s existing list window; `branches.tsx` owns the nested Branches view using the same viewport helper. The `history` state atom is keyed by repository root and stores JSON UI state and agent hashes within the host session. Git focus/list state and attribution registries use documented `session.id()` plus root; snapshots have a latest-wins guard per session and reject an obsolete cwd. Each shell call retains its immutable from-HEAD, reflog boundary and core token in its wrapper closure. Full-operation mutation guards also surround hook-aware shell calls, preventing a JEI commit from creating an eligible fresh tool window. ADR 0014 records paging/presentation choices and the native kit/API limits.

The OpenCode foundation (Task 13) is `nodeHost(generate)` in `hosts/opencode/host.ts`: argv-only `spawn` with `shell: false`, `windowsHide`, cwd/env/stdin, cancellation and timeout; filesystem reads use `node:fs/promises`. `readHead` returns only bytes actually read and always closes its handle; missing or unreadable reads return `null`, while a failed listing throws. The server (Task 14) injects `ctx.generate.text({ prompt, model? })`, with a flat string prompt and `provider/model` parsed into `{ providerID, id }`; an empty model uses the host default.

`hosts/opencode/rpc.ts` defines the portable `JeiRpc` with `Rpc.define` from `@opencode/plugin`; root `rpc.ts` re-exports it and the snapshot converters. The 25 method inputs and outputs are JSON Schema object literals; `allFiles` wraps its array in `{ files }`, `generate` wraps its string in `{ message }`, and void services return `{}`. Other service result objects keep their shape. `toWire`/`fromWire` convert only the `GitSnapshot` count Maps (`numstat`, `staged`) to/from records; non-repositories remain `{ root: null }`. Path-taking methods declare `outside_root`; `hosts/opencode/server.ts` checks every path against `ctx.location.directory` before invoking services, including the whole batch before mutations. Previews also retain core's real-path guard. Discard selects matching entries from a fresh snapshot; commit replans from fresh status and runs core steps only when every sensitive path occurs literally in the `approvedSensitive` list carried by RPC. Activity events carry `{ rel, kind }`, and changed events carry `{}`.

## Shared v0.2 Git actions

`branches(host, root)` returns `{ branches, base }`, with base an exact full branch ref or null; `validBranchName` validates literal names. Both hosts match the full ref before deriving a display label, preserving custom remote/local name collisions. `compare` returns the existing `CommitFile[]` shape including rename/count metadata, while `compareDiff` returns the same capped `{ file, truncated }` shape as historical diffs. Both resolve exact branch inputs to commit hashes; internal callers may also pass full commit hashes. `fetchAll` runs exactly `fetch --prune`. `webUrl` selects HEAD's upstream remote, else `origin`, and returns a supported credential-free HTTPS link or null.

`switchBranch(host, root, target, confirmed?, run?)`, `createBranch(host, root, name, start, confirmed?, run?)`, `checkout(host, root, hash, confirmed?, run?)` and `revert(host, root, hash, confirmed?, run?)` return `ActionResult`: `{ ok: true }` after execution or `{ ok: false, confirm }` before any mutation. `start` is a full commit hash or null for HEAD. An omitted `confirmed` is false; the optional runner takes `string[][]` and defaults to `runSteps`. Targets and status are read fresh on each call. Switch/create ask for dirty or detached state; checkout/revert always ask, and merge revert raises the shared refusal before execution. The hosts own displaying questions and invoking confirmed retries. This core contract is built before its host UI/RPC wiring (ADR 0013).

## Data flow

```
host events (tool hooks, file changes, cwd) -+
                                              +-> refresh scheduler -> core (parse, layout, rank) -> view model -> host view
user actions (keys, inputs) -> Host runners --+    (debounced, cancels)
                               (git, rg, fs)
```

Every runner call is cancellable (signals or generation counters, `core/latest.ts`), so a fast-typing user or a busy agent never queues stale work.

**Claude Code.** One process: hooks listen to `tool.call` and `classic.FileChanged`; the mod runs git and reads files through `$`, keeps pane state in `$.state`, and draws with `$.ui`. Panes open with `$.ui.open` and render on `ui.render`.

**OpenCode.** Two entries linked by one RPC contract (`hosts/opencode/rpc.ts`, `JeiRpc`). Root `index.ts` re-exports `hosts/opencode/server.ts`. The server runs git and file work next to the files and answers RPC calls. Completed tool calls update an `ActivityLog` and emit allowed project-relative touches; failed calls and outside-root paths are ignored. Writes, git actions and unclassified shell calls schedule `changed` after 300 ms of quiet, independently of activity visibility. `filesystem.changed` and `vcs.branch.updated` share the debounce, ignoring other locations. Cleanup cancels the timer, aborts and awaits the event stream, then disposes the async tool and RPC registrations; failed setup rolls back acquired resources. Background failures are logged without failing a completed tool. The TUI entry (Tasks 15-17) only draws: it owns the keymap layer and dialogs and calls the server through `context.client.rpc`. Server-pushed updates use `registration.events.emit`. This keeps JEI working when the TUI is attached to a remote server.

The TUI shell (Task 15) is `hosts/opencode/tui.tsx`, re-exported by root `tui.ts`. It registers the additive `session.panel` claim and the palette/slash command, gets `context.client.rpc(JeiRpc)`, and opens with panel presentation. `context.storage.memory` holds pane state and the auto-open marker per session across panel remounts and plugin reloads; nothing is written to durable storage. Auto-open waits for a session route and happens once after a successful open. Explicit tab/path commands update that session's state before opening it.

`hosts/opencode/pane.tsx` owns Solid signals for the pane, the last state reply and activity, a focused keymap derived from `TAB_KEYS` and `KEYS[currentView]`, and the shared tab/hint/width helpers. JSON Schema RPC outputs are `unknown`: the shell narrows the envelope and activity fields it consumes; Files and Git narrow their own data. Changed events and completed mutations share an immediate revision bump and a state refetch through `latest`; disposed or stale responses cannot update the panel. Live activity received during a request is replayed over its result by local reception order, without comparing server and client clocks. One 250 ms interval exists only while activity glows. Solid disposal removes listeners, the timer and key layers, and releases the slot claim. Files and Git delegate actions through the shell's existing key layer, including editing suppression; Search and Symbols retain the planned placeholder.

`hosts/opencode/files.tsx` consumes only RPC and pure core helpers. It narrows listing, preview and file-list replies, validates names/relative paths before actions with `insideRel` (preserving literal filename whitespace), caches expanded directory listings, and separately guards listing, filter-list and preview generations with `latest`. A changed-event revision clears the cache and refreshes active data immediately, without waiting for the state RPC. A separate filter-list error state shows a failure notice rather than no matches, and retries on reopening or changed events. The tree uses `treeRows`, `filterRows`, `reveal`, `folderStatus`, `iconFor` and the cell-width fit helpers. Selection determines the tree viewport; the preview keeps its own path so follow-agent touches cannot replace its content or hand-off target. Native OpenTUI code wrapping/scrolling retains highlighted code and Markdown source; tables use `fitTable` over at most 200 rows. `colors.ts` maps the existing resolved theme accents and Files blends activity foregrounds in eight steps. `hand-off.ts` owns the prefilled dialog and confirmed `session.prompt` call. The pane's existing key layer delegates Files actions and suppresses letter/digit shortcuts during filter typing, while preserving navigation and Esc; the active input keeps one row even when the normal header is hidden at short heights.

## Git layer

OpenCode retains the full commit draft independently of the native input: the input edits its subject, while the stored line separators/body remain intact. The pane passes the parsed smart-commit option to Git for option/mode-aware guidance. Sensitive confirmation is followed by a fresh plan and exact path-coverage comparison; RPC carries that approved list to the server for enforcement against its final fresh plan. A refusal triggers complete-list reapproval before one retry. ADR `docs/decisions/0010-exact-sensitive-path-approval.md` records this boundary. Diff line-kind narrowing requires an actual string before enum membership, avoiding coercion of malformed RPC values.

OpenCode's `git.tsx` owns commit message/mode and busy state in session `storage.memory`, plus local editing, collapsed groups and the selection-anchored list window. It invokes RPC methods and host dialogs; core/server still own all Git command construction, fresh discard/commit planning and path enforcement. Status paths become project-relative with `insideRel`, retaining leading whitespace. Successful or partially failed mutations immediately refetch the pane. `diff.tsx` separately guards the target and revision requests with `latest`, validates the typed `DiffFile`, and lays out cell-wrapped lines using shared fit helpers and `diffWindow` hunk positions. Logical row/character anchors preserve scroll through resize; core `reviewText` and `toUnifiedText` produce Ask context. No host adapter imports the other host.

Status: current for `run.ts`, `status.ts`, `diff.ts`, `commands.ts`, `hooks.ts`, `sensitive.ts`, `sync.ts`, `message.ts`, `log.ts`, `graph.ts`, `commit.ts`, `branches.ts` and `agent.ts`.

- `core/git/run.ts`: `gitArgv(root, args)` builds `['git', '--no-optional-locks', '-C', root, ...args]`; `git(host, root, args, options?)` runs it with `GIT_ENV` (`GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, `GIT_LITERAL_PATHSPECS=1` so a path such as `app/[id]/page.tsx` is never a glob, `GIT_MERGE_AUTOEDIT=no` and `GIT_TERMINAL_PROMPT=0` so no editor or credential prompt can hang a pane) merged under the caller's env and throws `GitError` on a non-zero exit. `GitError` carries `argv`, `exitCode`, `stderr` and `firstLine` (first non-empty stderr line, then stdout, then `git exited with <code>`).
- `core/git/status.ts`: `parseStatus` reads `STATUS_ARGS` output (`status --porcelain=v2 -z --branch --untracked-files=all`) into `{ branch, entries }`. `branch.head` is `null` when detached, `branch.oid` is `null` before the first commit. Every unmerged code (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) maps to `conflicted` on both sides. `folderStatus` rolls entries up to each ancestor folder (conflicted > modified > added > untracked; deleted and renamed count as modified; ignored is skipped). `isRepo` returns the root exactly as git prints it (newline trimmed), or `null` outside a repo.
- `core/git/diff.ts`: `parseUnifiedDiff` turns `git diff` text into `DiffFile[]` (`path`, `origPath` for renames, `binary`, `added`/`removed`, `hunks` of `DiffLine`). Line kinds are `add`, `del`, `ctx` and `meta` (`\ No newline at end of file`); `text` has no `+`/`-`/space prefix and no trailing CR; `oldNo`/`newNo` are set per kind. It decodes C-quoted paths (octal escapes as UTF-8), reads `rename from/to`, takes the `+++` side for names with spaces, and handles the `--no-index` form for untracked files (`a/` side is `/dev/null` or `NUL`; the path comes from the `b/` side). `parseNumstat` reads `diff --numstat -z` (a rename is the record `added TAB removed TAB`, then NUL, the old path, NUL, the new path, NUL; `null` counts mean binary). `capDiff(file, max)` counts hunk lines, keeps whole hunks before the cut and slices the cut hunk (its `@@` header counts are recomputed; `added`/`removed` stay the full-file totals). `workingDiffArgs` and `untrackedDiffArgs` build the argv (`NUL` on win32, `/dev/null` elsewhere); `git diff --no-index` exits 1 when files differ, so callers accept exit 1 for it. `toUnifiedText` re-serializes a file (`---`/`+++`, `/dev/null` for new and deleted files, plus hunks; CRLF is not preserved) for a `diff` code block. `diffWindow(file, top, rows)` cuts a window of rows (hunk headers count as rows) into hunks a diff renderer parses: each kept hunk gets a header with counts for the lines kept, and a window that starts mid-hunk opens with a header of its own; it also returns the header rows (`hunkStarts`) and the row count. `reviewText(path, unified, max)` is the fenced "Review this diff of <path>:" request, cut to `max` characters with a `[diff truncated]` note. Fixtures live in `test/fixtures/diff/`.
- `core/git/commands.ts`: argv tails for `git()`: `stageArgs`, `unstageArgs` (`restore --staged`; both return `[]` for no paths, so callers skip the step), `discardPlan` and `discardArgs`, `commitSteps`. `discardPlan` routes by worktree status: untracked goes to `clean -f`, worktree modified/deleted goes to `restore --worktree`; entries with no worktree change (for example staged-added only) are skipped. `commitSteps` runs `add -A` first only for a smart commit with nothing staged (never for amend); `commit-push` appends `push` (or `push -u origin <publish>` when the caller passes `publish`, the branch head, because there is no upstream), `amend` uses `commit --amend -m`.
- `core/git/sync.ts`: `syncSteps(cfg, branch)` for the repository-row Sync. Detached HEAD gives `[]` (the caller shows a message); no upstream gives `push -u origin <branch>`; behind 0 gives `push`; otherwise `pull` (plain when `pull.rebase` or `pull.ff` is set, else `pull --ff-only`) then `push` when ahead. `isDivergence` matches git's ff-only refusals ("Not possible to fast-forward", "diverging branches", "Need to specify how to reconcile divergent branches"); matching is case-insensitive. `resolveDivergence` returns `pull --no-rebase --ff` (merge) or `pull --rebase`, then `push`.
- `core/git/hooks.ts`: `readHookSignals(host, root)` uses only the Host: `config --get core.hooksPath` (exit 1 means unset), `.git/hooks` located through `rev-parse --git-path hooks` (correct in linked worktrees), `.husky/`, `lefthook.yml` / `.lefthook.yml`, `.pre-commit-config.yaml`, and `.gitattributes` text. `usesHooks` ignores `*.sample` hook files and treats `filter=lfs` as a hook-like signal.
- `core/git/sensitive.ts` and `core/git/message.ts`: see `docs/security.md` for the sensitive list; `commitPrompt` asks for one Conventional Commits message (subject up to 72 characters) with the diff cut to `maxChars` and a truncation note, `cleanMessage` strips a leading "Commit message:", unwraps a fence only when the text starts with one (unterminated accepted; a fence inside a body is kept) and strips surrounding quotes; `commitPrompt` never cuts a surrogate pair.

## Git history contracts

The v0.2 core and both hosts' Graph/Branches views are built. ADR `docs/decisions/0012-git-history-evidence-and-state.md` retains the preflight contracts and records review corrections. Middle lane vacancies stay fixed until reused; only trailing vacancies close. `lanes` includes blank columns. Passing crossings (`╳`, ASCII `x`) differ from actual parent junctions (box junctions, ASCII `+`).

- `core/git/log.ts`: NUL-delimited commit records, full HEAD/local/remote/tag badges, `isMerge`, quoted `author:`, `path:` and `branch:` filter tokens (`branch:*` means all); remaining words form a fixed-string, case-insensitive message filter. `logArgs` requests topo order and count plus one. Named revisions follow `--end-of-options`; literal paths follow `--` last.
- `core/git/branches.ts`: local/current-first branch records, upstream/gone and ahead/behind metadata, default comparison base and pure safe switch/create/compare argv plans. `commit.ts` also supplies validated detached-checkout/revert argv and credential-free GitHub/GitLab commit links. ADR 0013 records the action boundary.
- `core/git/graph.ts`: pure parent-waiting lanes, Unicode/ASCII commit rows and fork/merge/closure connectors. Missing loaded parents keep their lanes. `fitGraph(row, maxCells, ellipsis)` uses actual cells, preserves the commit when width is positive, includes the active ellipsis and crops connectors too. A lane budget must first become `2 * lanes - 1` cells; a host must reserve other row content before passing its final graph cell budget.
- `core/git/commit.ts`: `CommitFile` name-status/numstat pairing, binary null counts, rename origins, first-parent merge argv and root/nonroot diff argv. `assertCommitHash` is the shared 40-lowercase-hex boundary; these history reads are SHA-1-only.
- `core/git/agent.ts`: pure `AgentCommits`, reflog parser, creation-action allowlist, `Candidate = { hash; time /* committer unix seconds */ }`, `ReflogBoundary = { entry: string | null }`. Tracker API: `toolStart(head: string | null, now: number): number`, `toolEnd(token: number, head: string | null, candidates: readonly Candidate[]): void`, `invalidate(): void`, `observe(head: string | null): void`, `lastHead(): string | null`, `has(hash): boolean`, `toJSON(): string[]`, and `AgentCommits.from(hashes: readonly string[]): AgentCommits`. Only the last 1,000 inserted valid hashes persist. Every overlapping window is suppressed until its own token ends; a JEI mutation invalidates all open windows. Refresh observation never changes captured start evidence.
- `core/git/service.ts`: `graph(host, root, filter, count)` returns `{ commits, more }` (positive safe integer count and count plus one, exact local/remote ref resolution, unborn HEAD empty). `commitFiles(host, root, hash)` and `commitDiff(host, root, hash, path)` use real first-parent/root reads and the existing 5,000-line cap; renames include both paths. `newlyReachable(host, root, from: string | null, to: string): Promise<Candidate[]>` caps at 500. `captureReflog(host, root, head: string | null): Promise<ReflogBoundary | null>` captures the newest complete raw-date HEAD reflog identity, or the explicit empty unborn baseline. `agentCandidates(host, root, from: string | null, to: string, boundary: ReflogBoundary | null): Promise<Candidate[]>` accepts only new commit-producing reflog records above a unique boundary and reachable from final HEAD. A 501-record read bounds the witness to 500 new entries; failed, malformed, ambiguous, missing-boundary or raced evidence yields no candidates. The pure tracker then applies the two-second committer-clock slack.

Hosts must await baseline capture before executing a tool without failing it on bookkeeping errors, retain its immutable start HEAD and boundary by call identity, and end its token with the actual final HEAD even when no candidates exist. Keep each tracker per session/repository; invalidate before every JEI mutation, including hook-aware shell calls. Only hashes survive session-state serialization. The witness cannot distinguish an unrelated external commit made during that same tool window; conservative overlaps also cause deliberate missed marks.

An empty boundary is emitted only after verifying a symbolic local-branch HEAD, unresolved HEAD, absent HEAD reflog and a second unresolved HEAD check. Stale null inputs and commits racing this capture suppress attribution. The creation allowlist includes normal/initial/amend/merge/cherry-pick/rebase commit completion, non-fast-forward `merge ...: Merge made by ...`, revert, cherry-pick and explicit rebase creation actions; fast-forward movement is excluded.

## Files layer

Status: current for `core/files/` and `core/shared/fit.ts`.

- `core/shared/fit.ts`: the responsive helpers both hosts use so a row never overflows. `cellWidth` counts terminal cells (East Asian wide and fullwidth and emoji are 2, combining marks and joiners 0, the rest 1; compact range tables, no dependency). `fitEnd(s, width, ellipsis?)` ends with an ellipsis. `fitPath(rel, width, ellipsis?)` uses a middle ellipsis that keeps the file name (`src/…/user.ts`) and, when the name alone is too wide, end-ellipsizes the name and keeps its extension. `padEnd` pads by cells and never truncates. Every `fitEnd` and `fitPath` result is at most `width` cells for any width of 0 or more. The optional `ellipsis` is the active glyph set's ellipsis (`…` or `...`). See `docs/design.md` section 5.
- `core/shared/tabs.ts`: `tabBar(columns, room, active, chrome)` picks the tab labels for a pane width (all named from 60 columns, only the active one from 32, numbers below), budgets `chrome` cells per tab for hosts that draw button chrome, and shrinks the gap 2, 1, 0 before shortening labels. `TAB_NAMES` are the tab words. `core/shared/paths.ts` `insideRel(root, path)` validates literal filesystem paths and returns a posix rel without trimming filename whitespace; it rejects outside-root and ambiguous drive-relative paths. The OpenCode server's existing guard moved here for reuse by Files and activity consumers. `projectRel(root, path)` trims a typed path before calling that guard.
- `core/files/tree.ts`: `treeRows` flattens the expanded tree from `listings` (key `''` is the root). Dirs come first, then names case-insensitively. `.git` is never shown; dot entries and `ignored` paths show only with `showHidden`. Past `limit` entries in one folder a single `{ rel, depth, more }` row follows with the count; its `rel` is `<folder>/…`, and the host builds the text. `filterRows` ranks every known path with `fuzzyScore`; `reveal` returns a copy of `expanded` plus the ancestors of a path; `IGNORED_ARGS` is the `git check-ignore` tail (paths on stdin).
- `core/files/preview.ts`: `previewKind` decides in this order: size 0 is `empty`, an image extension is `image` (even when large, because it is never read), over `PREVIEW_MAX_BYTES` is `too-large`, a NUL in the first 8 KiB is `binary`, then markdown, csv, tsv, else `code`. `languageOf` maps a name to a highlight id. `core/files/csv.ts`: `parseDelimited` handles quoted fields, doubled quotes, CRLF and a BOM, and stops at `maxRows`.
- `core/files/open.ts`: `openArgv` returns the OS opener for an empty command. Otherwise it splits the command, replaces `{path}` and `{line}` inside words (the rest of the word is kept) and appends the path when no word has `{path}`. With no line, `:{line}` is stripped from a word that has `{path}`, and a word that has `{line}` but no `{path}` is dropped.
- `openUrlArgv(url, platform)` uses that platform's OS opener only for HTTPS URLs without userinfo.
- `core/files/icons.ts`: `iconFor` returns one cell: `▸ ▾ ·` for `plain` and `auto` (`auto` is plain in 0.1), and a small Nerd Font map for `nerd`. `core/files/mention.ts`: `mentionText` joins posix rels as `@a @"my file" ` with one trailing space.

## Activity, pane state and command

Status: current for `core/activity/`, `core/latest.ts`, `core/pane.ts` and `core/command.ts`.

- `core/activity/classify.ts`: `classifyTool(tool, input)` maps a tool call to `{ kind: 'read' | 'write' | 'git', paths }` or `null`. Ids are case-insensitive: `read`; `edit`, `write`, `multiedit`, `NotebookEdit` (`notebook_path`), `patch` (paths may be empty); `grep`, `glob`, `list` (read, paths from `path` or empty, the adapter fills them from the result); `bash`, `PowerShell`, `shell` go to `classifyShell`. Unknown ids fall back to read when the input has `filePath`, `file_path` or `path`, to the shell classifier when it has `command`, else `null`. Paths are raw (absolute or as given); the adapter converts them with `relativeTo`.
- `core/shared/argv.ts`: `splitCommand` (no shell: quotes keep a word whole) and, for the agent's shell, `shellQuote(word, shell)` (single quotes; Bash writes `'\''` for a quote, PowerShell doubles every single-quote form, typographic ones included) and `shellLine(argv, shell)`, which leaves plain words (`[A-Za-z0-9_./:=-]`) bare so permission rules such as `Bash(git commit:*)` still match.
- `core/activity/shell.ts`: `classifyShell` splits a command line outside quotes on `|`, `||`, `&&`, `;` and `&`, tokenizes each segment with `splitCommand`, drops redirections and flags (and the value of known value flags such as `head -n 5`), and reads file words of `cat head tail less more bat type Get-Content` (`-Path`/`-LiteralPath` value) and `rg`/`grep` (first word is the pattern unless `-e`/`-f`). `git` with `commit push pull checkout switch merge rebase reset` is kind `git` (wins over reads); `status diff log show` and everything else give `null`. Nothing is executed.
- `core/activity/log.ts`: `ActivityLog` takes `now` as an argument everywhere (no clock inside). `glow` falls linearly from 1 to 0 over `GLOW_MS` (2000); `isGlowing` tells adapters whether to keep a redraw timer; `touched` stays true for the session; `toJSON`/`from` round-trip. `allows(setting, kind)` applies the `activity` option (`git` shows unless `none`).
- `core/latest.ts`: `latest(fn)` is the refresh guard. Only the most recent call yields `{ value, stale: false }`; an older call yields `{ stale: true }` even when it rejects; a rejected latest call rejects.
- `core/pane.ts`: `reducePane` is pure. `tab` resets the stack to the tab's root view but keeps `selected` (per-view selection survives tab switches). `open-diff` pushes `git.diff` and records `diff`; `preview` pushes `files.preview` and selects the file in Files; both switch tab when needed. `branches` pushes `git.branches`; `back` restores the originating view and its selection, and is a no-op on a root view. `normalizePane(state)` converts retained v0.1 working diffs into the source union without mutation or losing flags, tab, stack or selections. Claude state reads/updates and OpenCode panel/command memory loads share it; modern state keeps its identity.
- `core/command.ts`: `parseJeiArgument` trims; empty toggles; a tab name (any case) opens that tab; anything else reveals a posix-normalized path (no leading `./`) in Files.

## Services

Status: current for `core/git/service.ts` and `core/files/service.ts`. These are the only core entry points the adapters call besides pure helpers; each takes a `Host` and returns plain data.

- `core/git/service.ts`: `snapshot(host, cwd)` returns `{ root: null }` outside a repo, else `{ root, status, numstat, staged, hooks }` (status, `diff --numstat` and `diff --cached --numstat` counts keyed by path, `usesHooks`). `stage`, `unstage` skip git for no paths; `discard` runs `discardPlan` (callers confirm first). `fileDiff` returns one `DiffFile` capped at 5,000 lines (`DIFF_MAX_LINES`); untracked files use `--no-index` and exit 1 counts as success. `generateMessage` sends the staged diff (the working diff when nothing is staged) cut to 12,000 characters to `host.complete` and runs `cleanMessage`. `commitPlan` is pure: steps from `commitSteps` (with `publish` set to the branch head for `commit-push` without an upstream), `sensitive` is the sensitive subset of what the commit will include (every changed path when the smart commit runs `add -A`, else the staged paths), `viaAgentShell` is `snap.hooks`. `runSteps` stops at the first `GitError`. `sync` reads `pull.rebase`/`pull.ff`, runs `syncSteps` and returns `{ ok: true }`, `{ ok: false, divergence: true }` (only without a `choice`) or `{ ok: false, error: <first line> }`; a detached HEAD gives `Detached HEAD: check out a branch to sync.`; with `choice` it runs `resolveDivergence`. An optional `run(steps)` replaces the direct runner (Claude Code routes hook-firing steps through the agent's shell with it); its `GitError` is classified the same way.
- `core/files/service.ts`: `listDir` lists a folder and asks `git check-ignore --stdin -z` which listed paths are ignored (none outside a repo). `loadPreview` stats first (size settles empty, image and too-large without reading), reads at most `PREVIEW_MAX_BYTES`, and returns `text` plus `language`, or `rows` (200 at most) for csv/tsv. A missing path, folder, rejected path or outside-root symlink is `empty`; an in-root regular file whose `readHead` returns `null` is `error`. `allFiles` is `ls-files -co --exclude-standard -z` in a repo, else a breadth-first walk capped at 20,000 entries that skips `.git` and `node_modules`. `openFile` runs `openArgv` and ignores the exit code (some openers exit 1 on success).

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
hosts/opencode/       host.ts, rpc.ts, server.ts, tui.tsx, pane.tsx, files.tsx, colors.ts, hand-off.ts, git.tsx, diff.tsx, *.spec.ts(x)
types/index.d.ts      Claude Code PluginState contract
test/fake-host.ts     spec-only Host over a temp dir and real git
test/fixtures/        git porcelain samples, diff samples, LSP text samples
docs/                 this documentation; docs/plans/ holds implementation plans
scripts/              dev scripts (check-docs.ts)
```

Later milestones add `core/search/` (0.3), `core/symbols/` (0.4) and `core/fsops.ts` (0.5). Status: draft — built in the milestone shown.

## Packaging

The repo root is both the Claude Code plugin (the marketplace installs the whole tree, `core/` included) and the `opencode-jei` npm package (`exports` `.`, `./server`, `./tui`, `./rpc`). The npm `files` list excludes specs. There is no build step: both hosts load TypeScript directly.

## OpenCode history integration

`graph.tsx` contributes rows to Git's existing list/window; `branches.tsx` owns the nested Branches list. Session/repository `storage.memory` retains filters, pages, expansion and pinned comparison files. Actions share Git's busy guard and immediate refresh. Native editable filter/name dialogs preserve state on cancel. Commit/compare diffs reuse `diff.tsx`, with commit subject or pinned-hash labels, a path row and file/hunk navigation.

The server adds graph/commitFiles/branches/switchBranch/createBranch/compare/checkout/revert/fetch/webUrl/openWeb. Graph carries the active TUI sessionID; actual before/after tool sessionID/id pairs own immutable evidence windows. A mutation-depth guard spans every JEI Git action and invalidates overlapping/pending windows. Trackers are per session/repository and ephemeral to server setup. Compare validates full branch refs and pins their hashes before generating files. Every RPC input is closed; server full hash/ref/status checks precede execution. Portable hash schemas use lengths rather than patterns rejected by the installed compiler. ADR 0015 records the contracts and native API evidence.
