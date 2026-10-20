# Bounded Search and complete replacement review

> Purpose: bound retained Search/replacement data and refuse incomplete replacement reviews · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

Installed ripgrep 15.2 JSON output ignores `--max-columns` as a line-length bound. A 2,000-result cap therefore permits many large retained lines and submatch arrays. Complete before/after replacement snapshots amplify the same problem. ADR 0019 allowed capped replacement plans to cover only reviewed results, which can silently omit later occurrences in the final retained file. Git and rg also interpret newline-separated patterns differently, and Git's C-locale whole-word matching accepts boundaries beside non-ASCII letters.

## Decision

- Search retains at most 2,000 result lines and an estimated 16 MiB of result data. Before accepting each result, it estimates UTF-16 line/path strings at two bytes per code unit, 32 bytes per range tuple and 64 bytes per match. Exceeding either bound cancels the stream and sets the existing `truncated` completion flag. `--max-columns 1000` remains an engine hint, never a memory guarantee.
- Replacement planning refuses every truncated search with `Results truncated. Narrow the search before replacing.` This supersedes ADR 0019's capped-replacement consequence. It never returns a partial review after truncation.
- Planning processes complete files incrementally and retains at most an estimated 32 MiB of before/after/path strings plus 64 bytes per reviewed file. Exceeding the bound refuses the whole review with narrowing guidance. Existing 4 MiB UTF-8 per-file input/output limits remain; no partial plan or new setting is introduced.
- These are retained-data estimates, not exact JavaScript heap measurements. Transient parsing/working allocations, engine output buffers, RPC serialization, host/session copies and retained state for other roots are outside these budgets.
- Search rejects CR/LF in a pattern before accessing the project. Replacement requires a nonempty literal query; an intentional empty regex remains supported. Each host keeps Search and Quick Open query text coherent with its results across mode changes.
- Whole-word replacement independently checks both adjacent Unicode code points using rg's Alphabetic/Mark/Decimal_Number/Connector_Punctuation/Join_Control definition. An engine boundary disagreement refuses the whole file as `regex-differs`, as incompatible regex matches already do.
- Replacement previews show changed runs with three lines of context, merging neighboring hunks when their context meets. When line counts change, one hunk trims the common prefix/suffix and retains three context lines. Final-newline changes remain explicit. Both hosts use the same pure 12,000-character replacement Ask formatter with complete locations and an omission count.
- Git fallback basename globs match at every depth using generated `**/` prefixes. `--no-full-name` overrides Git configuration so paths remain relative to the current project root. Quick Open removes deleted tracked paths; missing rg outside a repository gives installation guidance. Tracking/hidden-file coverage and the fallback's first-occurrence limit remain explicit.

## Consequences

Large searches remain useful up to the retained-data limit, but replacement requires narrowing until both Search and its complete review fit. A review cannot silently authorize a subset from a truncated search. Both hosts preserve existing public service shapes and confirmations. No dependency, cache framework, new option or batched outgoing-call algorithm is added. Sequential writes still have no atomic compare-and-swap against external changes after their last complete byte read and realpath check. Bounded payload duplication, unpruned per-root state, real POSIX filesystem QA and positive real-LSP compatibility remain debt.
