# Architecture

> Purpose: how JEI is split between a host-independent core and two thin host adapters, and how data moves · Status: current · Last reviewed: 2026-10-19

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

`core/keys.ts` holds the one key map. `KEYS[view]` lists `{ key, action, label }` in hint-line priority (lowest priority last); adapters dispatch on `action`. `TAB_KEYS` maps `1`-`4` to tabs. `hintLine(view, columns)` builds the hint line for any width >= 1: below 32 columns it shows keys only, otherwise `key label` pairs joined by ` · `, dropping items from the end until it fits.

| View | key: action |
| --- | --- |
| `files` | `up`: move-up, `down`: move-down, `enter`: activate, `a`: mention, `o`: open-editor, `f`: filter, `h`: toggle-hidden, `esc`: back |
| `files.preview` | `up`: scroll-up, `down`: scroll-down, `a`: mention, `o`: open-editor, `m`: toggle-markdown-source, `esc`: back |
| `git` | `up`: move-up, `down`: move-down, `enter`: activate, `s`: stage, `u`: unstage, `d`: discard, `c`: commit, `g`: generate-message, `e`: sync, `esc`: back |
| `git.diff` | `up`: scroll-up, `down`: scroll-down, `n`: next-hunk, `p`: prev-hunk, `j`: next-file, `k`: prev-file, `a`: ask-review, `o`: open-editor, `esc`: back |
| `search`, `symbols` | `up`: move-up, `down`: move-down, `enter`: activate, `esc`: back (more keys arrive in 0.3 and 0.4) |

Action names are stable; rename one only with every consumer in the same change.

## Adapters

| Host | Where | Implements Host with | Draws with |
| --- | --- | --- | --- |
| Claude Code | `hosts/claude-code/`, entry `hooks/register.tsx` | `$.process.run`, `$.fs`, `$.model.complete` | `$.ui` elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Code`, `Markdown`) |
| OpenCode | `hosts/opencode/`, entries `index.ts`, `tui.ts`, `rpc.ts` | `node:child_process` and `node:fs/promises` in the server entry, `client.generate.text` | Solid + OpenTUI views in the TUI entry |

Adapters stay thin: wiring, drawing, host-specific delivery of text to the agent. Anything testable without a host moves to `core/`.

## Data flow

```
host events (tool hooks, file changes, cwd) -+
                                              +-> refresh scheduler -> core (parse, layout, rank) -> view model -> host view
user actions (keys, inputs) -> Host runners --+    (debounced, cancels)
                               (git, rg, fs)
```

Every runner call is cancellable (signals or generation counters, `core/latest.ts`), so a fast-typing user or a busy agent never queues stale work.

**Claude Code.** One process: hooks listen to `tool.call` and `classic.FileChanged`; the mod runs git and reads files through `$`, keeps pane state in `$.state`, and draws with `$.ui`. Panes open with `$.ui.open` and render on `ui.render`.

**OpenCode.** Two entries linked by one RPC contract (`hosts/opencode/rpc.ts`, `JeiRpc`). The server entry runs git and file work next to the files, observes tool hooks and events, and answers RPC calls. The TUI entry only draws: it owns the keymap layer and dialogs and calls the server through `context.client.rpc`. Server-pushed updates use the registration's `emit`. This keeps JEI working when the TUI is attached to a remote server.

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
  shared/{paths.ts, fuzzy.ts, argv.ts}
  git/{run.ts, status.ts, diff.ts, commands.ts, hooks.ts, message.ts, sensitive.ts}
  activity/{classify.ts, shell.ts, log.ts}
  files/{tree.ts, preview.ts, csv.ts, open.ts, mention.ts}
hosts/claude-code/    host.ts, state.ts, pane.tsx, files.tsx, git.tsx, diff.tsx, activity.ts, *.test.tsx
hosts/opencode/       host.ts, rpc.ts, server.ts, tui.tsx, pane.tsx, files.tsx, git.tsx, diff.tsx, *.spec.ts(x)
types/index.d.ts      Claude Code PluginState contract
test/fixtures/        git porcelain samples, diff samples, LSP text samples
docs/                 this documentation; docs/plans/ holds implementation plans
scripts/              dev scripts (check-docs.ts)
```

Later milestones add `core/search/` (0.3), `core/symbols/` (0.4) and `core/fsops.ts` (0.5). Status: draft — built in the milestone shown.

## Packaging

The repo root is both the Claude Code plugin (the marketplace installs the whole tree, `core/` included) and the `opencode-jei` npm package (`exports` `.`, `./server`, `./tui`, `./rpc`). The npm `files` list excludes specs. There is no build step: both hosts load TypeScript directly.
