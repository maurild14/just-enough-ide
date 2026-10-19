# Security and privacy

> Purpose: what JEI does and never does with your data, and the hygiene rules for contributors · Status: current · Last reviewed: 2026-10-19

Source: `PRD.md` §9. To report a vulnerability, follow `SECURITY.md`.

## Privacy model

- JEI is local. It sends nothing over the network itself.
- The only model calls are the ones the user starts: generating a commit message, and Ask. They go through the user's own host session and provider.
- `git fetch`, `pull` and `push` talk to the user's own remotes, and only on a user action. JEI never fetches in the background.
- JEI stores only small per-project UI state (expanded folders, last tab) through the host's own storage.

## Safe behavior

On OpenCode, sensitive-file approval covers the exact list shown and crosses RPC as `approvedSensitive: string[]`. After each approval the TUI requests another fresh plan; any newly sensitive path requires a new confirmation. The server independently replans and refuses before any Git steps unless every current sensitive path is included in that exact approved list. Comparison preserves literal whitespace and case. On refusal the TUI shows the full current list and requires approval before one retry; cancel stops the commit. The busy guard remains held throughout. See `docs/decisions/0010-exact-sensitive-path-approval.md`.

- **Secrets in commits.** Before a smart commit stages everything, paths that look sensitive (`core/git/sensitive.ts`) are listed and the user must confirm with "Commit anyway". Matching is on the basename, case-insensitive: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `credentials.json`, `.npmrc`, `.netrc`. The committed templates `.env.example`, `.env.sample` and `.env.template` are not flagged. Both hosts implement the confirmation; OpenCode passes the exact `approvedSensitive` list, and its server enforces coverage against a fresh plan before executing.
- **Destructive actions** (discard, discard all, delete, checkout over local changes) always confirm. JEI never stashes on its own.
- **No surprise permission dialogs.** The Claude Code LSP and shell-tool permissions are checked with `$.tool.check` first; the pane explains and asks.
- **No shell strings.** Every process is an argv array, which also removes a whole class of injection through file names.
- **Paths stay inside the project root.** Every path JEI writes or deletes is resolved and checked. The Files service refuses a relative path that leaves the root (listing and preview return empty) and a preview whose real path (after symlinks) is outside the root's real path. Git runs with `GIT_LITERAL_PATHSPECS=1`, so a file name with `[`, `*` or `?` never matches other files when staged, restored or cleaned.
- **No lock contention.** Git runs with `--no-optional-locks` so JEI never blocks the agent.

## Repository hygiene

- No secrets, tokens, personal paths, usernames, emails or real project names in code, fixtures, docs or screenshots. Fixtures use `acme-app` and fictional authors (`@example.com`).
- Commits use the maintainer's GitHub noreply identity, never a personal address. The license names "The JEI contributors".
- CI runs a gitleaks scan on the full history, with `contents: read` permissions, `persist-credentials: false` on checkout, and Dependabot keeping the SHA-pinned actions current; run a secret scan over the repo before each release.
- npm publishing runs from GitHub Actions through npm trusted publishing (OIDC): no npm token exists to leak, and provenance is attached automatically. Actions are pinned by commit SHA and run with least-privilege `permissions`. Status: draft — built in milestone 0.1 (plan Tasks 2 and 18).
- `.claude-plugin/types/` (laid by Claude Code) is gitignored and never committed.

## Reporting

Report vulnerabilities privately as described in `SECURITY.md`; do not open a public issue for them.
