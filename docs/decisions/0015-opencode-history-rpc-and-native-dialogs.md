# OpenCode history RPC and native dialogs

> Purpose: record OpenCode 2.0.32 history contracts, validation limits and native presentation · Status: current · Last reviewed: 2026-10-20

Status: accepted

## Context

OpenCode separates the TUI from the server. Its installed `RpcCallContext` exposes only `signal` and `error`, while `execute.before` and `execute.after` expose stable `sessionID` and call `id`. The native dialog API supplies editable prompts and confirmations. Real CLI verification found that the host's JSON Schema compiler rejects `pattern` by default, including patterns in output schemas.

## Decision

- Graph adds the active TUI `sessionID` to `{ filter, count }`. The installed session ID is a branded string without a public format restriction. The server validates its string type and keys attribution by session plus repository in a Map. Call windows pair actual hook session/call identities; pending evidence reads count as overlap before their first await.
- Every RPC object is closed with `additionalProperties: false`; handlers independently reject unexpected/missing fields. Full hashes declare string length 40 in portable schemas and are checked with `assertCommitHash` at every server boundary. TUI replies use full-hash narrowing. Do not put `pattern` in these schemas: the installed host compiler rejects it before calling the handler. A spec compiles all method schemas with the installed compiler defaults.
- Switch/create/checkout/revert carry `confirmed` and return the shared `ActionResult`. The first request cannot mutate when confirmation is required; the native dialog displays the core's fresh question, and the approved retry revalidates targets/status. Create has optional full-hash `start`. Compare accepts existing full branch refs, pins both listed hashes before generating files, and returns those exact hashes as its comparison source. Historical diff requests use full hashes, retaining the comparison after refs move. Commit diff replies also carry their subject label.
- `defaultBase` and `branches().base` return the exact full branch ref. Both host selectors match that full ref and use only the matched branch's name for display. A custom `origin/HEAD` target such as `refs/remotes/main` must remain distinct from local `refs/heads/main`; absent origin HEAD still falls back to local main/master. This corrects the earlier short-name result without changing preference order.
- `webUrl { hash }` remains read-only. `openWeb { hash }` derives the supported credential-free URL on the server and uses `openUrlArgv`; the TUI accepts no arbitrary executable or URL input.
- Graph uses the existing Git selection/window, below working groups. Branches uses a nested list. OpenCode filters and new branch names use editable native dialogs; cancel retains the previous filter, and confirmations keep the list state. This differs from Claude Code's inline editors while preserving keys, filter syntax and action semantics. Contextual Graph hints show the applicable shared keys. Esc remains OpenCode back.
- Installed `context.renderer.copyToClipboardOSC52(text)` returns boolean. `y` copies the complete hash; false or an unavailable renderer opens `ui.dialog.prompt({ title: 'Commit hash', value: hash })`. A true return cannot prove the terminal accepted OSC 52. Ask uses the existing editable `handToAgent` dialog and confirmed `session.prompt`.
- A server mutation-depth guard spans every JEI Git operation, invalidating before and after its entire async interval. Tool windows starting inside it and ambiguous overlapping/pending windows remain invalid, including failed operations. Attribution errors never change a user's tool result. Trackers live only for this plugin server lifetime.

## Consequences

Both hosts now implement the 0.2 milestone. Native dialogs avoid squeezing editors and answers into short OpenTUI panes. Unreleased RPC shapes change together with every caller/fixture. No new runtime dependency, version bump or publication occurs. Attribution stays conservative: missing reflog evidence or concurrent work can omit markers, and an unrelated external commit inside a valid tool interval is indistinguishable. Live agent commits, terminal clipboard acceptance, focus/themes, terminal resize and another OS remain release QA.
