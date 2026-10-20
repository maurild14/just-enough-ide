# Git history core contracts

> Purpose: resolve v0.2 history, attribution, key and glyph contracts before the host views consume them · Status: current · Last reviewed: 2026-10-20

Status: superseded by 0012

## Context

The v0.2 task brief's timestamp-only agent rule can label a recent checkout or reset as an agent commit. Its end method lacks the final HEAD and cannot update it when no candidates exist. Concurrent tools and JEI's own hook-aware mutations make a single start timestamp ambiguous. The draft glyph guidance promises detection that neither host implements, while ASCII's existing ellipsis occupies three cells. Creating a branch from a graph commit also needs a shared key.

## Decision

- Keep the tracker pure. `toolStart(head, now)` returns a numeric token; `toolEnd(token, head, candidates)` receives that window's actual final HEAD. `observe(head)` never marks a commit. `invalidate()` suppresses every open window, preserving bookkeeping until each window ends. Any overlapping tool windows suppress all their marks. Unknown or repeated end tokens do nothing. Persist only the latest 1,000 inserted valid full hashes, never open windows.
- Hosts capture immutable start HEAD and `captureReflog(host, root, head)` before execution. The boundary is `{ entry: string | null }`: the complete newest OID, raw-date selector and action record; `entry: null` denotes an unborn HEAD. A null boundary means unavailable evidence. `agentCandidates(host, root, from, to, boundary)` intersects newly reachable commits with proven creation records above the unique boundary. Read at most 501 reflog entries, allowing at most 500 new records; older records beyond a found boundary do not invalidate it. An empty baseline requires a complete initial-commit record. Missing, malformed, ambiguous, raced or truncated evidence marks nothing. Evidence read failures never fail a user's tool.
- Recognize `commit`, initial/amend commit, revert, cherry-pick and rebase pick/reword/squash/fixup/continue actions. Checkout, reset, fetch, fast-forward and unknown actions never prove creation. Committer time must additionally be at least the window start minus two seconds. Hosts pair by tool identity, invalidate before JEI mutations, and keep one tracker per session and repository. They must end bookkeeping even when evidence fails. This proves creation during a tool window, not authorship: an unrelated external commit during that window remains indistinguishable.
- The graph service accepts positive safe integer counts whose paging sentinel count plus one is also safe and requests one extra commit for paging. Named branches resolve to exactly one existing local or remote full ref, then a full SHA-1 commit OID. Revision expressions and tags are not branch inputs. New commit read services accept only 40 lowercase hexadecimal OIDs. Full decoration output distinguishes slash-containing local branches from remote refs.
- File details and diffs compare merges against the first parent; roots include every added file. Rename diffs include both literal paths so Git retains rename metadata. Both root and nonroot diffs disable external diff commands.
- Graph budgets are terminal cells: a full row of `lanes` occupies `2 * lanes - 1` cells. `fitGraph` includes the configured ellipsis width, retains the commit cell whenever the budget is positive, and shifts the visible lane window if necessary. Zero cells return empty strings. The terminal lone root needs no connector. Preserve `glyphs: auto | nerd | plain`; `auto` currently uses plain icons until detection exists. ASCII remains a renderer fallback, with no new option.
- Define `n new branch` in the shared Git key map, contextual to the selected graph commit. Branches uses `n new` from HEAD. Generalized diff sources are working, commit and compare; a diff pushed from Branches returns there. Host history UI and RPC additions remain separate v0.2 tasks; this change adapts only existing working diffs.

## Consequences

Both adapters consume one attribution and graph contract. Extra bounded local Git reads add pre-tool latency. Overlaps, unavailable evidence, custom reflog actions and older-than-slack committer dates can leave agent commits unmarked. Very large graph requests can fail at the existing process output or timeout limits; there is no arbitrary total history ceiling or silent truncation. SHA-256 repositories are unsupported by these v0.2 history services. History, Branches and their new keys remain unavailable until both host feature tasks land; existing working diffs retain their behavior.
