# Search streams and safe replacement

> Purpose: resolve v0.3 search process, fallback, replacement and retained-navigation contracts · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

The v0.3 plan assumes that ripgrep searches the working directory with closed piped stdin, combines JSON and files modes, and assigns Quick Open to the shared Back key. Git grep reports only the first starting column, without a match length. UTF-8 validation must cover the complete file before a whole-file write, and both hosts need the same replacement-plan orchestration and preview target.

## Decision

- Content search uses `rg --json --no-config`, the planned flags and globs, then `.` and `-e <pattern>`. The explicit directory avoids searching empty stdin; the pattern remains a separate option value even when it starts with a dash. Files mode instead uses `rg --files --no-config --null`: JSON mode suppresses the file list in installed ripgrep 15.2. Git file lists use NUL delimiters too. Machine paths use `insideRel`, preserving literal whitespace, and reads/writes check the root's and target's real paths.
- Search emits at most 2,000 result lines, including every submatch on each retained rg line. Its completion includes `truncated`. The host views must show `Results truncated.` when true. `--max-columns 1000` is retained but is not a memory bound in JSON mode; `--max-filesize 2M` remains the rg file limit.
- Both adapters and the real-process fake host bound each unterminated stdout line and collected stderr to an 8 MiB decoded-text character budget. Overflow cancels and rejects the stream explicitly; it never reports success or silently drops text. Claude's queue backpressures at 64 lines or 1 MiB, while the native Node pipe iterator supplies backpressure on OpenCode.
- Missing ripgrep falls back inside a repository only. Generated `:(glob)` and `:(exclude,glob)` pathspecs require a narrow `GIT_LITERAL_PATHSPECS=0` exception for these read-only grep calls; every other fixed Git environment value remains unchanged. Existing literal file operations retain their own contracts.
- The fallback runs normal NUL-field grep plus `--only-matching` grep and verifies the first returned substring against the full line at its UTF-8 byte column. Only that first occurrence per line is exposed or replaced. No end-of-line range is invented. Both processes are cancellable, accept exit 1 as no matches and buffer at most 8 MiB of text apiece; overflow sets `truncated`, and unverifiable records are omitted. Newlines inside filenames are preserved by rejoining streamed lines before parsing NUL fields.
- Shared `buildReplacePlan(host, root, query, replacement)` gathers matches, reads confined complete files and calls `planReplace`. Apply rechecks complete UTF-8 bytes, NULs, the original text and real paths. Binary, invalid UTF-8, changed, outside-root, unreadable and over-4-MiB files receive distinct skip reasons. Whole-file writes over 4 MiB cannot be shared with Claude's filesystem API. Regex replacement requires JS to fully match each engine-provided substring, otherwise the entire file is refused. Hosts confirm before applying the reviewed plan.

The 4 MiB write limit applies to UTF-8 bytes of the replacement result too; planning/apply refuse expansions beyond it consistently on both hosts.
- Search and Quick Open reserve `q` for toggling modes, superseding only the universal Back clause of ADR 0017 for those two root modes. Replace, Symbols/results and previews retain `q` Back; Esc remains host-reserved on Claude Code. The core key map supplies all actions, including `c` calls on Symbols.
- Preview pushes `files.preview` on the current tab's stack and retains `{ rel, line? }` in an optional shared preview target. Back removes the target when preview leaves the stack. The last 50 deduplicated preview paths survive tab/navigation changes. Legacy state gains an empty recent list without discarding the existing diff migration. Named `quickopen`, `replace` and `symbol-results` actions reach their planned views.

## Consequences

Fallback performs an extra local Git process and intentionally shows fewer occurrences than rg. Native views must identify this first-occurrence limit. Capped replacement plans cover only the reviewed results. Writes remain sequential and may partially succeed before a filesystem error; this Host contract provides no atomic compare-and-swap against an external writer between its final read and write. Services add no UI, dependency or model call; the matching host view/RPC tasks remain required before the feature is available. Kit and real-process tests do not replace live-host or cross-platform release QA.
