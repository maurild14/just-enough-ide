# Testing

> Purpose: which tests exist, which runner runs them, and what every view must prove · Status: current · Last reviewed: 2026-10-19

Source: `PRD.md` §8.1 and `docs/design.md` §10. Run `bun run test`, `bun run typecheck` and `bun run check:docs` before finishing.

## Two runners, two names

| Pattern | Runner | Where | Command |
| --- | --- | --- | --- |
| `*.spec.ts(x)` | `bun test` | `core/`, `hosts/opencode/` | `bun run test`, `bun test <file>` |
| `*.test.ts(x)` | `claude plugin test` | `hosts/claude-code/` only | `bun run test:claude` |

Never mix them: `claude plugin test` loads every `*.test.ts` in the plugin folder, so a stray one elsewhere breaks it. The script `bun run test` runs `bun test ./core ./hosts/opencode`. Specs may import `bun:test` and `node:*`; the `core/` purity rule binds non-spec files. Most tests live in `core/`.

## What is tested where

- **`core/`** (`*.spec.ts`): parsers (git status, diff), pane reducer, key map, paths (including `C:\` and `/` forms), argv splitting, fuzzy ranking, activity and shell-read classification, commit planning, hook detection, sensitive paths, preview classification. Pure functions with fixture inputs.
- **OpenCode adapter** (`*.spec.ts(x)`): RPC handlers against the fake host with real git in a temp repo; views with OpenTUI's `testRender` and `captureCharFrame`.
- **Claude Code adapter** (`*.test.tsx`): the Claude Code testing kit mounts the pane on both the `terminal` and `desktop` surfaces and drives it; process answers are mocked. `bun run validate` (`claude plugin validate .`) must report no refusals.

## Fixtures

- The sample repo is `acme-app`; authors are `Ana Rivera <ana@example.com>` and `Leo Park <leo@example.com>`. No real names, emails, paths or projects.
- Text fixtures live in `test/fixtures/` (git porcelain samples in `git/*.txt`, diffs in `diff/*.diff`, later LSP outputs). A change in a tool's output format should fail a fixture test, not users.
- The **fake host** (in `test/`) implements `Host` over a temp directory, with real `git` for git specs and scripted answers where a test needs them. Specs create their temp repos fresh and delete them.

## Width and height matrix

Every view is rendered as a snapshot at widths 24, 40, 80 and 120 (200 as a smoke test) and heights 10, 24 and 5, in all three glyph sets, and asserts the checklist in `docs/design.md` §10: no line wider than the pane, exact height, selected row visible, status letters present, right-aligned columns, truncated paths keep the basename, `NO_COLOR` still distinguishes states, no raw color values outside `theme.ts`. A resize sequence (120, 24, 10 rows, 120) must return the same selection and a final output equal to a fresh render. Status: draft — built in milestone 0.1 (plan Tasks 8, 11, 12, 16, 17).

## Manual QA

What the kits cannot see (real paint, real terminals, a real agent) is checked by hand on both hosts before each release, on Windows and one of macOS or Linux. The checklist is `docs/qa.md`. Status: draft — written in milestone 0.1 (plan Task 18).

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: `bun run test` on Ubuntu, macOS and Windows; `bun run typecheck` (core + OpenCode); `bun run check:docs`; `claude plugin validate` and `claude plugin test` on Ubuntu; and a gitleaks scan of the full history. The Claude Code job is `continue-on-error` because the CLI may need a signed-in account in CI, so run `bun run validate && bun run test:claude` before every release. The local `typecheck:claude` script needs types Claude Code lays at `.claude-plugin/types/` (gitignored, never committed), so CI checks the Claude Code half with `claude plugin validate` instead.
