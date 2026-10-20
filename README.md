# JEI — Just Enough IDE

> The parts of an IDE you still need when the AI writes the code: a file tree, project search, symbols and a full Git panel, docked beside your Claude Code or OpenCode session.

JEI is a pane with four tabs (Files, Search, Symbols, Git) that sits next to the agent's conversation. You watch what the agent reads and edits, review its changes and commit them, without leaving the session. Both hosts get the same features and the same keys from one codebase.

<!-- screenshots: added by the maintainer from acme-app before the public release -->

## What 0.2 ships

- **Files:** a lazy file tree with git status, a shimmer on the files the agent reads (purple), writes (orange) or touches through git (green), follow-the-agent, a filter, previews (code, Markdown, CSV/TSV), mention into the agent, and open in your editor.
- **Git:** a repository row (branch, Sync with your remote), Changes with stage, unstage and discard (always confirmed), commit, Commit & Push and amend, a ✦ Generate commit message from your own model, and a check before secrets such as `.env` or private keys are committed.
- **Diff view:** a unified diff that replaces the pane, with hunk and file navigation, Ask about the change, and open in editor.
- **Graph:** fitted commit lanes, inline changed files, commit diffs, copy hash, Ask, confirmed checkout/revert, supported GitHub/GitLab links, session agent markers, filters and explicit paging. Fetch runs only when requested.
- **Branches:** local/remote branches, dirty/detached switch confirmation, create from HEAD or a selected commit, and pinned comparisons with the main branch.
- **Keys:** `1`–`4` switch tabs; every view lists its keys on the last line.

Coming next (see the milestones in [PRD.md §11](PRD.md#11-milestones)):

- **0.3:** Search and Quick Open.
- **0.4:** Symbols.

Until then the Search and Symbols tabs show "Coming in a later version."

| View | Keys |
| --- | --- |
| Git | `enter` expand/open, `s` stage, `u` unstage, `d` discard, `c` commit mode, `g` generate, `e` sync |
| Graph | `y` copy hash, `a` Ask, `b` branches, `f` filter, `t` fetch, `n` new branch from the selected commit |
| Branches | `enter` switch, `n` new branch from HEAD, `c` compare, `f` filter |
| Diff | `n/p` hunk, `j/k` file, `a` Ask, `o` editor |

OpenCode uses Esc to go back; Claude Code uses the header button or tab digit. Graph filters accept text plus `author:`, `path:` and `branch:` fields (`branch:*` includes all branches). Merge commits cannot be reverted by JEI.

## Install

### Claude Code

In a Claude Code session:

```
/plugin marketplace add maurild14/just-enough-ide
/plugin install jei@jei
```

Then run `/tui fullscreen` so the pane can dock beside the transcript, and `/jei` to toggle it. In the Claude Code desktop app, run the same two commands in a session prompt; the pane draws there too and works by click. Mods do not load in desktop WSL sessions, the VS Code chat panel or `claude -p`.

### OpenCode 2.x

Add the npm package to `opencode.json` (or `opencode.jsonc`); OpenCode installs it with Bun on next start:

```json
{ "plugins": ["opencode-jei"] }
```

## Requirements

- Claude Code 2.1.302 or newer, with `/tui fullscreen` and at least 110 columns for docking.
- OpenCode 2.x, version 2.0.32 or newer (the 1.x line is not supported).
- On both: `git` on your PATH. Optional: a Nerd Font for icons; `rg` and language servers once Search (0.3) and Symbols (0.4) land.

## Configuration

The same keys on both hosts. On Claude Code, set them in `/config` (on/off settings are `on`/`off` pickers). On OpenCode, pass them as plugin options:

```json
{ "plugins": [{ "package": "opencode-jei", "options": { "defaultTab": "git" } }] }
```

| Key | Values | Default | Meaning |
| --- | --- | --- | --- |
| `startOpen` | on / off | on | Open the pane when a session starts (where it can dock) |
| `defaultTab` | `files`, `search`, `symbols`, `git` | `files` | Tab shown on open |
| `activity` | `reads and writes`, `writes`, `reads`, `none` | `reads and writes` | What the shimmer shows |
| `followAgent` | on / off | on | The tree follows the files the agent touches |
| `glyphs` | `auto`, `nerd`, `plain` | `auto` | Icon set |
| `editorCommand` | text | empty | Command that opens a file; `{path}` and `{line}` are replaced. Empty uses the system default |
| `commitModel` | text | empty | Model for ✦ Generate; empty uses the host default |
| `smartCommit` | on / off | on | Commit with nothing staged stages everything first |
| `graphLimit` | number | 200 | Commits loaded per page in the Graph (from 0.2) |

## Privacy

- JEI is local. It sends nothing over the network itself.
- The only model calls are the ones you start (✦ Generate and Ask), through your own host session and provider.
- `git fetch`, `pull` and `push` talk only to your own remotes, and only when you ask. JEI never fetches in the background.
- Before a smart commit stages everything, files that look like secrets are listed and need your confirmation.
- The npm package is published from GitHub Actions with npm trusted publishing and provenance; no npm token exists.

Details: [docs/security.md](docs/security.md). Security reports: [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
