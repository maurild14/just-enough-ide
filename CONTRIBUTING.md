# Contributing to JEI

Thanks for helping. JEI is one codebase for two hosts, Claude Code and OpenCode.
Please read this page and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Setup

```
bun install
bun run test
bun run typecheck
```

`typecheck` covers core and the OpenCode adapter. `typecheck:claude` checks the
Claude Code half and needs `.claude-plugin/types/`, which Claude Code lays
when you load the folder interactively (`claude --plugin-dir .`); CI checks that
half with `claude plugin validate`.

Requirements: Bun, Git, and (for the Claude Code half) the `claude` CLI.

## Rules of the repository

- **The `core/` rule.** `core/` is pure TypeScript. It imports nothing from
  `claude-code`, `@opencode/*`, `solid-js`, `@opentui/*`, `node:*` or `bun:*`,
  and uses only ECMAScript built-ins. Anything testable without a host belongs
  there. Specs (`*.spec.ts`) may import `bun:test` and `node:*`; the purity
  rule binds non-spec files.
- **Both hosts or neither.** A feature lands on both hosts in the same change,
  or it does not land.
- **Zero runtime dependencies.** Host packages are optional peer dependencies.
- **Relative imports name their file with its extension** (`./status.ts`).
- **No shell strings.** Every process is an argv array.
- **Test naming.** `*.spec.ts(x)` run under `bun test` (`core/`,
  `hosts/opencode/`). `*.test.ts(x)` run under `claude plugin test`
  (`hosts/claude-code/` only). Never mix them: `claude plugin test` loads every
  `*.test.ts` in the plugin folder.
- **Privacy.** No secrets, personal paths, usernames, emails or real project
  names in code, fixtures or screenshots. Fixtures use the sample repo
  `acme-app` and fictional authors.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `test:`, `chore:`, `ci:`. Release automation reads them.

## Running each host from the working copy

Claude Code:

```
claude --plugin-dir .
```

Validate and test the plugin:

```
bun run validate
bun run test:claude
```

OpenCode: host-specific steps are added with the OpenCode adapter. Until then,
`bun run test` and `bun run typecheck` cover that half.
