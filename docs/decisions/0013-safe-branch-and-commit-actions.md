# Safe branch and commit actions

> Purpose: define shared v0.2 action confirmation, exact refs, comparison and credential handling contracts · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

The v0.2 branch plan lists pure switch/create plans but omits the services its real-Git tests and both hosts need. Dirty-only confirmation misses leaving detached HEAD, and clearing a gone upstream loses the distinction from a branch that never tracked one. Revision option separation alone permits shorthand expansion and ambiguous tags. Existing Git errors can include credentials from configured remote URLs.

## Decision

- Add `gone: boolean` to `Branch`, preserving `upstream: null` when tracking is gone. Local branches precede remotes, with the current local first. Default comparison base is the existing `origin/HEAD` target, then local `main`, then local `master`.
- Share `switchBranch`, `createBranch`, `checkout` and `revert` services. Each accepts `confirmed = false` and an optional `run(steps)` runner, like Sync. Their result is `{ ok: true }` after execution or `{ ok: false, confirm: string }` without execution. Hosts display that question and repeat the request with `confirmed: true` only after approval. Repeated requests read targets and status again. Both dirty changes and leaving detached HEAD require confirmation for switching/creation; checkout and revert always require it. Git protects conflicting local changes; no operation stashes, forces, discards or resets them.
- Branch names pass `check-ref-format --branch` and must equal its literal output, rejecting shorthand such as `@{-1}`. Also refuse the single name `@`: installed Git accepts its format but expands it as HEAD during switch. Target selection accepts a full local/remote ref or a uniquely matching listed short branch name. Full refs take precedence over short names that happen to look like full refs. Local switching uses the verified local name, which Git distinguishes from a same-named tag. Remote targets use their full ref and map back to local names through configured fetch refspecs, preserving nested branch paths and custom destination prefixes.
- Commit inputs remain full 40-character lowercase SHA-1 OIDs and must identify a commit. Installed Git 2.52 accepts `--end-of-options` for switch and revert; retain the planned builders. Service-side revert independently refuses commits with multiple parents using `Reverting a merge commit is not supported.`
- Comparison resolves branch inputs to immutable hashes, reads matching rename-aware name-status and numstat, and includes both paths in rename diffs. Internal compare services also accept full commit hashes; host branch RPC inputs must still enforce their branch-name schema.
- Web links use the current HEAD branch's upstream remote, falling back to `origin` only when there is no upstream remote. Only supported GitHub/GitLab HTTPS, SSH and scp forms produce a credential-free HTTPS commit link. URL opening refuses other schemes and userinfo. `GitError` strips URL userinfo from its display message, stored stderr and copied argv; process execution receives the original argv.
- `fetchAll` means exactly `fetch --prune` on Git's configured default remote, despite its name. It does not fetch every remote.

## Consequences

Both hosts consume the same fresh validation and confirmation boundary and can route hook-firing steps through their existing runner. Additional local reads precede actions. Git still handles errors and concurrent changes occurring after validation; no rollback or auto-stash is introduced. These services do not make the host Graph/Branches UI available before its later tasks. SHA-256 repositories remain unsupported. Credential redaction applies to Git errors from existing actions as well as the new fetch service.
