# Manual QA checklist

> Purpose: the hand checks run on both hosts before every release, for what the test kits cannot see · Status: current · Last reviewed: 2026-10-21

The specs cover logic and rendered frames (`docs/testing.md`). They cannot see real paint, real terminals, a real agent or a real model. Before each release, run this list on **Claude Code** and on **OpenCode 2.0.32+**, on **Windows** and on **one of macOS or Linux**. Use a disposable copy of the sample repo `acme-app` (fictional authors, a bare repo as `origin`), never a real project. Load the working copy as described in `CONTRIBUTING.md` ("Running each host from the working copy").

Record failures as issues or rows in `docs/quality.md`; a release ships only when every item passes or has a logged, accepted reason.

Files-only checks require no model request. If a live Claude model is necessary, use `claude --plugin-dir <path to jei> --model haiku --effort low`, at most one smoke pass for the task, with minimal input.

## 1. Load and open (both hosts)

- [ ] Claude Code: `claude --plugin-dir <path to jei> --model haiku --effort low`, then `/tui fullscreen` in a terminal of at least 110 columns; the pane docks beside the transcript.
- [ ] OpenCode: the checkout is listed as a local plugin in `opencode.json`; after a restart the panel opens once on session start (`startOpen: on`) and not again in the same session.
- [ ] `/jei` toggles the pane; `/jei files`, `/jei search`, `/jei git` open on that tab; `/jei <path>` opens Files revealing the path.
- [ ] Keys `1` to `3` switch tabs while the pane is focused; clicking a tab works where the host has a mouse.
- [ ] Claude: enter Git with `3`, reach the mode Button with Tab, cycle all modes with Enter, then hold Down to reach Graph and Changes. Returning with Up, clicking tabs and using `1`–`3` still work. Mode changes perform no Git operation.
- [ ] OpenCode: `q`, visible Back and `Esc` go back one level from a nested view; host `Ctrl-N` / `Ctrl-P` still work; clicking the panel focuses it.
- [ ] Claude Code: `Esc` stays the host's (back to the prompt); nested views use `q` or visible Back without losing tab access at five rows (ADRs 0009 and 0017).
- [ ] Claude Code: arrow keys either scroll the pane or walk the focus ring when the tree fits; both paths move the selection sensibly.
- [ ] Claude Code desktop app: the pane draws, buttons have sensible chrome and every action works by click.

## 2. Files

- [ ] Expand and collapse folders; git status letters and colors appear on files and roll up to folders.
- [ ] `f` filter: typing goes to the filter input (not the agent prompt), results narrow, `esc` clears; `h` toggles hidden files.
- [ ] `enter` previews a file: code, Markdown (`m` toggles source), CSV table, binary and too-large notices.
- [ ] `a` mention: Claude Code inserts the text into the prompt; OpenCode opens an editable dialog and sends it.
- [ ] `o` opens the file in the editor (`editorCommand` empty and set with `{path}` / `{line}`).
- [ ] Shimmer while the agent works: ask the agent to read a file (purple), edit one (orange), then commit (green); the row fades over about 2 s and keeps a "touched" marker. `followAgent: on` reveals the touched file.
- [ ] On both hosts, on Windows and on macOS or Linux, use disposable files/folders to exercise `n`, `r`, `m`, `d`: New under a selected folder/file parent/root, trailing `/` for a folder, Rename as a basename, and Move as an exact project-relative destination including basename. Check spaces, brackets, apostrophes, backticks, Unicode and leading dashes; on POSIX also check a colon name. New keeps already expanded descendants.
- [ ] Delete names the file and always asks first; a nonempty folder explicitly says recursive. Cancel/Back before submit or confirmation changes no contents. Confirm removes only the owned target and selects a surviving parent/row. Inputs own letters/digits. Cancel and refused submit retain the filename filter; success clears it.
- [ ] Refuse existing file/folder/dangling-link destinations, missing parents, project-root aliases, absolute/outside/traversal paths, direct source links and outside symlink/junction parents. Preserve source and destination contents plus an outside sentinel for every refusal. Test a root opened through a link separately; never change platform settings to enable a case-sensitive directory or symlink.
- [ ] Resize operation editors and recursive confirmations before/after input at 24/40/80/120 columns and five total rows. Smaller panes keep an honest enlargement notice and usable Cancel, and cannot submit hidden controls. Check actual keyboard focus and paint on both hosts, including Claude desktop.
- [ ] After create/rename/move/delete, verify Files, Git, previews, filename search and retained Quick Open refresh without reopening. The actual result/surviving parent stays selected; hidden/ignored/capped results become visible without changing visibility settings, while `.git` uses explicit visible-parent feedback.
- [ ] Cancel or leave Files during a held operation, then return: busy stays held through the actual response/refresh, execution and refresh failures remain truthful, and a late result cannot replace a newer selection or another project's state. Change the project before confirmation and verify no stale effect. A failed/refused action shows its first reason and permits retry.

## 3. Git

- [ ] Not a repository: the Git tab says so and nothing breaks; Files still works.
- [ ] Repository row shows branch and Sync state; `e` Sync on a diverged branch offers Merge and Rebase.
- [ ] `s` stage, `u` unstage, `d` discard (asks to confirm; cancel keeps the change), discard all confirms.
- [ ] `g` ✦ Generate against a configured model (`commitModel` empty and set); the subject can be edited and the generated body is kept in the commit (OpenCode edits the subject only).
- [ ] Commit, Commit & Push and Amend; smart commit with nothing staged stages everything first.
- [ ] A sensitive file (`.env`, `id_rsa`) in a smart commit is listed and needs "Commit anyway"; adding another sensitive path after approving asks again for the exact new list.
- [ ] During a merge with a conflict, Commit shows `Resolve conflicts first.` and commits nothing; Generate with a changed `.env` lists it as `sensitive file, contents omitted` and never sends its values.
- [ ] With `editorCommand` empty, `o` on a `.bat`/`.sh` file toasts `Set editorCommand to open this file type.`; on a `.ts` file the OS opener shows it (on Windows, with a backslash path).
- [ ] On Claude Code, a preview or diff with lines wider than the pane cuts them at the edge and the hint line stays at the bottom of the docked pane.
- [ ] A repo with a real `pre-commit` hook: on Claude Code the commit goes through the agent's shell tool (permission asked first; the message file is written into `.git` via `$.fs.write`); on OpenCode the hook runs. A failing hook shows its message.
- [ ] Claude Code: a failing shell-tool step shows a readable toast line.
- [ ] Claude Code, disposable auto-mode session: if Sync reports the missing server review, it stops with Ask Claude/Cancel, without retrying or bypassing hooks/permissions. Ask inserts once into a draft without sending it; unavailable prompt/root change retains the question, and Cancel or `q` does no work. After a completed pull, recovery requests only pending push. Check 24/40/80/120 columns and five rows, plus Branches/diff Back while the question is hidden. Send the draft only when deliberately testing host authorization; later approval is not guaranteed.

## 4. Diff view

- [ ] `enter` on a change opens its diff replacing the pane; `n` / `p` next and previous hunk, `j` / `k` next and previous file, `a` ask, `o` open in editor, `q` or Back goes back (OpenCode also accepts Esc).
- [ ] Long lines wrap or truncate without pushing the hint line off the pane.

## 5. Sizes and themes

- [ ] Claude Search: type successive queries during a large streaming search, then edit include/exclude globs. Check cancellation, batched paint, errors, fallback first-occurrence labels and exact one/all prompt hand-off.
- [ ] Claude Replace: inspect/collapse/scroll each diff, confirm one/all, cancel, edit a file after preview and verify skipped reasons, partial-write counts and immediate Files/Search refresh in a disposable repo.
- [ ] Claude Quick Open: check touched/recent ranking, file-event cache refresh, `:line` targeting and Back retaining the query/results. Test code, Markdown, CSV and TSV markers through resize.

- [ ] Live-resize the pane through 120, 80, 40 and 24 columns and through 24, 10, 5 and 2 rows: no line wider than the pane, the selected row stays visible, the hint line adapts.
- [ ] Dark and light host themes: every state stays readable.

## 6. Release

- [ ] Run `bun run test`, `bun run typecheck`, `bun run check:docs`, `bun run validate` and `bun run test:claude`.
- [ ] `npm pack --dry-run` lists only `index.ts`, `tui.ts`, `rpc.ts`, `core/`, `hosts/opencode/` (no specs), `LICENSE`, `README.md`, `package.json`.
- [ ] Run a secret scan over the full history (gitleaks).
- [ ] When preparing the release PR, fold the temporary `Unreleased — 0.2` notes into the generated release notes and remove that temporary heading.
- [ ] Take the README screenshots, one per host, from `acme-app`, with no personal paths or names in the title bar or prompt.

## Search (both hosts, 0.3)

- [ ] Search a large disposable repository and observe results arriving before completion. Change the query while it streams; stale rows and completion must not replace the new results. Check literal case-insensitive matching, include/exclude globs and the 2,000-line/estimated-16-MiB truncation notice. OpenCode query/globs Esc leaves Search running; leaving the active view cancels it with explicit status. Ordinary file changes retain current Search selection/results.
- [ ] Unicode before/inside matches (accented letters, emoji and CJK) keeps correct highlights and source-line previews. Hide rg from the isolated fixture PATH: repository fallback identifies Git grep's first-occurrence limit; a non-repository shows installation help.
- [ ] One/all hand-off has exact locations and bounded omission copy. OpenCode's editable dialog cancels or sends only confirmed text; Claude inserts without sending.

## Quick Open (both hosts, 0.3)

- [ ] Touched files rank before recent previews, then other fuzzy matches. File events refresh the cache, deleted tracked files disappear, and Search/Quick Open toggles retain coherent separate queries/results. A `:42` target clamps at EOF and marks the actual source row through Back and resize, including wrapped preceding lines and Markdown/CSV/TSV. OpenCode manual scroll survives a same-target refresh.

## Replace (both hosts, 0.3)

- [ ] Search `user` in `user User USER`: all three matches appear, but Replace with `account` reviews/applies only one exact match and lists `case-differs`. Repeat across lines, all-mismatched files and mixed files. Apply one then all: remaining eligible files and case skip notices stay visible, including long paths at 24 columns.
- [ ] Inspect/collapse/scroll reviewed diffs, apply one/all only after confirmation, cancel without writes and change a file after preview: it is listed as changed and preserved. Binary, invalid UTF-8 and other skip reasons remain explicit.
- [ ] A small edit deep in a file shows localized context; multiline/final-newline edits remain complete. Truncated searches, empty literal queries and reviews over the estimated 32 MiB budget require narrowing before any write. Git fallback whole-word replacement beside Unicode letters refuses incompatible files. Successful own replacements refresh Search/Files explicitly.
- [ ] A later write failure reports only known successful replacements, preserves remaining review state and refreshes Files/Search. Repeated activation during confirmation/apply cannot duplicate writes. An invalid selected subset cannot authorize any write.

## 7. Graph and Branches (both hosts, 0.2)

- [ ] At 24/40/80/120 columns and five rows, paint linear/fork/merge lanes, expand a commit and resize while retaining focus.
- [ ] Open a commit diff; check subject/path, hunk keys, j/k navigation and return to the expanded row.
- [ ] y copies the full hash (OpenCode unsupported/false OSC 52 opens Commit hash); a uses the expected commit text. Cancel Ask, then edit/confirm it.
- [ ] Checkout/revert cancel without mutation, then confirm; merge revert reports the shared refusal. A real repository hook runs.
- [ ] In a disposable repo, provoke a revert conflict: verify the error and Git REVERTING state remain, and Commit refuses unresolved files. JEI has no continue/abort action; inspect `git status`, then deliberately resolve and run `git revert --continue` or choose `git revert --abort` outside the pane.
- [ ] On a clean ahead tree at 24/40 columns and five rows, reach Sync from the Graph header, Load more and expanded file/action rows; commit rows retain their six contextual keys.
- [ ] Filter message, quoted author, path, a branch and branch:*; cancel retains the old filter. Load more adds graphLimit commits; t fetch reports failures.
- [ ] b opens Branches; locals/remotes, current marker, gone and ahead/behind counts are readable. Dirty/detached switch: cancel retains state, confirm carries changes only if Git allows.
- [ ] n creates from HEAD in Branches and the selected commit in Graph. Invalid names fail without lost work.
- [ ] c compares with the default main branch; open a file diff and use j/k/back. Return through diff → comparison → Branches → Git with `q` and mouse Back, preserving each selection. Type `q` into filter/name/message editors and confirm it stays text. Move the branch and verify the comparison stays pinned. Check missing-base and empty notices.
- [ ] A real agent commit gains a session-local marker; a JEI commit (including hook-aware Claude execution) never does. Another session/repository must not inherit it. Ambiguous overlap or unavailable evidence may omit markers.
- [ ] Repeat clipboard/focus/native dialogs in light/dark themes, real terminal resize and another OS.

Task 4 smoke completed on Windows with OpenCode 2.0.32: the checkout loaded in an isolated private session, Graph painted a real commit, and b opened main/feature Branches. No model prompt was sent. This fixed 80-column PTY smoke does not mark the broader checklist complete.

Historical 0.3 Task 4 smoke at `c9c09d6` passed at 80 x 24 in a disposable 3,001-file repository using cached OpenCode 2.0.32: native Search frames showed matching rows and Searching before completion, targeted preview marked the first source line, Back retained results without a restart, and the then-present Symbols view showed both functions. The session sent no model/provider request; Ctrl-C restored modes and the isolated process exited. This predates strict native event-location filtering and later lifecycle corrections, and does not certify final source. Live resize, themes, actual provider hand-off, other operating systems remain unchecked above.

The final fix-wave smoke verified source commit `6a9c5967a2e7aee346bcf6272d30e0bbb2535db8` with cached OpenCode 2.0.32 on Windows at 80 x 24, using a fresh isolated 3,001-file `acme-app`. A synchronized native paint showed `getAccount` result rows with `Searching…`, followed chronologically by `Results truncated.`. Enter opened marked `src/account.ts:1`; Back retained the query, grouped results and completed status without restarting. The then-present Symbols view showed the approximate `getAccount`/`describeAccount` outline. Ctrl-C deliberately exited 1, restored terminal modes and removed both added client/server processes while preserving the baseline process set. The checkout and fixture stayed clean, with no provider/model request. This verifies the strict event-location/current-source path for that run; it does not count RPC batches or establish live mid-stream cancellation, resize, other dimensions/themes/OS, provider hand-off, clipboard.

- [ ] Files: live filename results above the project name, basename prefixes first, accent border, typing/digit ownership, arrows across result windows, preview Back, Clear to the original expanded tree and Cancel leaving the query. Search tab 2: content queries on Enter, no case/regex/word controls, retained preview result and Clear staying on Search. Repeat at 24/40/80/120 columns and five rows; verify both hosts.

- [ ] Historical commit/comparison diffs and Branches filter/new-branch editors use at least five total rows. Tested Files-only three/four-row behavior does not establish those views at extreme heights (ADR 0027).
