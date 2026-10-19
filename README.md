# JEI — Just Enough IDE

> The parts of an IDE you still need when the AI writes the code: a file tree, project search, symbols and a full Git panel, docked beside your Claude Code or OpenCode session.

**Status: pre-release.** Nothing is installable yet; the sections below describe the intended setup.

## Install

### Claude Code

```
/plugin marketplace add maurild14/just-enough-ide
/plugin install jei@jei
```

### OpenCode

Add the npm package to `opencode.json` (or `opencode.jsonc`); OpenCode installs it with Bun on next start:

```json
{ "plugins": ["opencode-jei"] }
```

## Requirements

- Claude Code 2.1.302 or newer, with `/tui fullscreen` and at least 110 columns for docking.
- OpenCode 2.x, version 2.0.32 or newer (the 1.x line is not supported).
- On both: `git` on your PATH. Optional: `rg`, language servers, a Nerd Font.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
