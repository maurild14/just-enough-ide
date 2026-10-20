# Contributing to JEI

Thanks for helping. JEI is one codebase for two hosts, Claude Code and OpenCode.
Please read this page and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

Working with an AI agent, or want the in-depth docs? Start at `AGENTS.md` and the index in `docs/README.md`.

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

## Continuous integration

CI (`.github/workflows/ci.yml`) runs tests on three operating systems, the type
check, the docs check and a secret scan. The Claude Code job is non-blocking
because the CLI may need a signed-in account in CI: run
`bun run validate && bun run test:claude` before every release.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `test:`, `chore:`, `ci:`. Release automation reads them.

## Running each host from the working copy

Claude Code: point it at the checkout. The folder is watched and the mod
reloads on save; dock the pane with `/tui fullscreen`.

```
claude --plugin-dir <path to jei>
```

Validate and test the plugin:

```
bun run validate
bun run test:claude
```

OpenCode 2.x: add the absolute path of the checkout to `plugins` in
`opencode.json` (the loader resolves `index`, `tui` and `rpc` in that folder),
then restart OpenCode:

```json
{ "plugins": ["/absolute/path/to/jei"] }
```

`bun run test` and `bun run typecheck` cover that half without a running host.

## Releases

Before a release, run the manual checklist in `docs/qa.md` on both hosts.

Releases are automated by `.github/workflows/release.yml`. On every push to
`main`, release-please opens or updates a release PR from the Conventional
Commits since the last release: it bumps `package.json`,
`.claude-plugin/plugin.json` and `core/version.ts` together and updates
`CHANGELOG.md`. Merging that
PR creates the tag and GitHub release, and the `publish` job (environment
`npm`) runs the tests and publishes `opencode-jei` to npm through npm trusted
publishing. There is no npm token; provenance is attached automatically.

One-time setup by the maintainer:

- The manifest (`.release-please-manifest.json`) starts at `0.1.0`, so
  release-please treats 0.1.0 as released and proposes the next version.
  `CHANGELOG.md` already holds the hand-written 0.1.0 entry. Bootstrap once:
  1. Publish 0.1.0 by hand from a clean checkout of the release commit
     (`npm publish --access public`); npm can only attach a trusted publisher
     to a package that exists.
  2. Create a GitHub Release `v0.1.0` on that commit (not just a tag), so the
     release is visible to people and to release-please.
  3. Add `"bootstrap-sha": "<that commit>"` at the top level of
     `release-please-config.json` in a `chore:` commit. release-please then
     collects changelog commits only after 0.1.0 instead of walking the whole
     history. It ignores the key once its first release PR is merged; remove
     it then.
- On npmjs.com, in the `opencode-jei` package settings, add a trusted
  publisher: GitHub Actions, repository `maurild14/just-enough-ide`, workflow
  `release.yml`, environment `npm`.
- In the GitHub repository, create the `npm` environment and allow GitHub
  Actions to create pull requests (Settings, Actions, General) so
  release-please can open its PR.
- Required status checks do not run on the release PR: GitHub does not start
  workflows for a pull request opened or updated with `GITHUB_TOKEN`. Either
  give the release-please step a fine-grained PAT or GitHub App token (input
  `token`) so CI runs on its PR, or do not require checks on that branch
  (`release-please--branches--main`) and run CI yourself before merging.
