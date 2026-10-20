# Native search paths and zero-width fallback

> Purpose: prevent literal filename aliases and retain verified zero-width first matches in Search · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

Review reproduced a POSIX `a\b.txt` search result becoming `a/b.txt`, which could read and replace an unselected counterpart. A POSIX `a:b.txt` also disappeared during a second Windows-shaped drive check. Separately, Git grep's only-matching mode omits empty matches, so requiring a companion substring silently dropped valid `^` and empty-regex results.

## Decision

- Add shared `nativeRel(root, path, platform)`, leaving existing path helper defaults and callers unchanged. Search parsing accepts an optional platform, inferred from the root only when omitted; Host services always pass their actual platform. Windows delegates to the established containment rules. A private normalization mode disables Windows drive/UNC interpretation for POSIX; colon filenames survive repeated checks and double-leading-slash roots remain case-sensitive.
- POSIX literal backslashes in input/root/resolved paths are unsupported in v0.3. Reject them before separator normalization, so they can never alias slash paths. Search and Quick Open omit these unsupported paths. Direct replacement reports `unsupported-path`, distinct from outside-root. Use the same boundary for returned paths and resolved-path checks before reads and writes. Task 2 symbol reads and later RPC consumers can use the exported helper.
- Record completion separately for both fallback processes. A missing only-matching companion can represent an empty first match only after both streams complete successfully without truncation, and only when the first JS match on the full line is empty at Git's byte-derived UTF-16 index. An empty literal query follows the same zero-position rule. Preserve exact verification for nonempty companion substrings.
- A complete but unverifiable pair reports `Git grep could not verify the first match in <path>:<line>.` instead of successful empty results. Truncated or failed output never establishes the absence of a companion. Git/JS regex differences and mixed-result mismatches may therefore refuse the fallback explicitly.

This amends ADR 0019's literal-path boundary and first-occurrence verification; its cancellation, bounds, replacement and navigation contracts remain in force.

## Consequences

POSIX backslash filenames are conservatively refused rather than supported; no other filename is substituted. Colon filenames are supported across parse/search/plan/apply/Quick Open. Deterministic Linux-Host simulations verify target identity on Windows, while real POSIX filesystem QA remains separate. Real Git tests cover anchors, empty regexes, CRLF, empty lines and first-zero alternatives; synthetic streams cover truncation, failure and mismatched companions. Silent-child cancellation while a real Claude HookStream pull is pending remains unverified host QA; ordinary async-generator behavior alone does not establish that host's semantics.
