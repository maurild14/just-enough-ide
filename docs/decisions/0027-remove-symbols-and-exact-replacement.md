# Remove Symbols and exact replacement

> Purpose: withdraw Symbols completely, use ordinary unknown-value handling and require exact literal replacement · Status: current · Last reviewed: 2026-10-21

Status: accepted. Supersedes ADR 0026's Symbols compatibility and legacy tab/config/command conversions, and the Symbols portions of ADRs 0021 and 0022. Corrects ADR 0017's blanket tiny-height claims.

## Context

Retiring the native Symbols views left unused core services, fixtures, RPC and session contracts. Case-insensitive Search also let literal replacement change case variants the user had not typed. Earlier current documentation overstated support for historical diffs and Branches editors at three/four total rows.

## Decision

- Delete Symbols core services/tests/fixtures, LSP parsing, RPC schemas/handlers and Claude state/types. Files, Search and Git remain the three tabs. No Symbols-specific compatibility or migration remains.
- Unknown default-tab config values follow the ordinary Files default. Unknown command words follow the existing Files path behavior. Unknown retained tabs/views and wrongly rooted stacks reset generically to Files, preserving valid selections/recent paths. Preserve working-diff normalization, missing recent paths, Search-under-Files migration and valid shared Files previews.
- Search remains literal and case-insensitive. Both native query builders and the OpenCode server RPC boundary force case/regex/word flags off, including retained/programmatic requests. RPC still validates the existing fields and their types; only internal core services retain regex behavior. Literal Replace edits only text exactly equal to the query, including case. Other case variants stay unchanged and yield one `case-differs` notice per file, even when that file also has eligible edits. Both hosts show the reason before a fitted path and retain notices after apply. Applying one file cannot remove another eligible file merely because it already has a case skip.
- Validate all supplied lines and ranges, including omitted case variants, before allowing a file's writes. Preserve stale-file, malformed/overlapping-range, UTF-8, binary, size and root-confinement safeguards. Internal regex service behavior remains supported by its existing tests.
- Historical commit/comparison diffs and Branches filter/new-branch editors require at least five total rows. Three/four-row bounded coverage applies only to tested Files states. This supersedes broader prose in ADR 0017 without changing its historical record or adding an extreme-height redesign.
- Milestone 0.4 covers cleanup/exact Replace/docs, review and Files operations. Polish, launch and publication are deferred. The test suite requires rg on PATH; runtime Git grep fallback remains available.

## Consequences

Symbols consumers must stop using the removed contracts. Old unknown values receive the same safe behavior as any unsupported value. A replacement review may show both eligible edits and omitted matches for one path; counts include eligible edits only. Existing complete-review budgets and confirmation/apply validation remain unchanged. Native kit/renderer checks and real rg service tests establish automated behavior; physical focus, paint and other OS checks remain release QA.
