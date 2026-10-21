# 0029: Canonical filesystem identity

> Purpose: separate canonical metadata identity from lexical path aliases · Status: current · Last reviewed: 2026-10-21

Status: accepted

Date: 2026-10-21

## Context

Windows lexical path handling folds case for typed paths. JavaScript Unicode lowercasing does not establish filesystem identity: ordinary sibling directories named `k` and `K` coexist on Windows, and case-sensitive directories can also contain case-distinct entries. Passing resolved metadata through that lexical comparison admitted a static outside junction. This is separate from ADR 0028's external-writer check/use window.

## Decision

Keep `nativeRel` for lexical user, process and RPC paths. Add pure `canonicalRel` in the existing shared paths module for resolved root/source/ancestor/destination metadata, preview admission, Search publication and both replacement read/write checks. It requires unambiguous absolute native grammar, normalizes Windows separators and the ASCII drive letter only, and compares all directory, filename and UNC components exactly. It never Unicode-folds or normalizes components, joins a relative metadata path or erases traversal/empty components. Malformed or ambiguous evidence fails closed.

Files uses this same boundary for canonical descendant checks, exact destination postconditions and returned canonical relative results. A lexical casing alias remains valid when the host resolves it to consistent actual canonical metadata. Source entry selection prefers an exact listed basename; an unambiguous ASCII casing fallback must also match the exact canonical basename. Other ambiguous aliases are refused conservatively. Direct source links/other entries remain refused. Existing-destination collision refusals remain conservative.

## Consequences and evidence

Static Unicode and case-distinct canonical siblings cannot authorize an outside Files effect, preview read, Search result or replacement read/write. A root opened through a link remains anchored to its actual canonical root. Existing typed parent-case aliases use the returned actual canonical result. Uncertain canonical case or UNC identity is refused; no filesystem settings or Unicode identity heuristics are introduced.

Pure/fake-host tests cover distinct Windows components, malformed evidence and every metadata consumer. Disposable Windows junction tests preserve the outside sentinel through public server refusals; Claude's native kit simulates the same resolved Windows metadata and refuses before confirmation/effects. No per-directory case-sensitivity setting or real UNC filesystem is exercised. The shared check cannot remove the separate external-writer window after a final check, prove inode identity or roll back an OS effect.
