# Changelog

## 0.4.0

First public release, published by hand (see `CONTRIBUTING.md`, Releases). Versions 0.1 to 0.3 were internal milestones and were never published.

### Features

* A pane docked beside a Claude Code or OpenCode session with three tabs, Files, Search and Git, and the same keys and behavior on both hosts.
* Files: a lazy file tree with git status, an agent activity shimmer, follow-the-agent, live filename search, previews (code, Markdown, CSV and TSV), mention in the prompt, open in the editor, and new, rename, move and always-confirmed delete.
* Search: literal, case-insensitive project search with streamed results, include/exclude globs, one/all hand-off to the agent, a `git grep` fallback without ripgrep, and a reviewed, confirmed replacement that changes only exact-case matches and refuses changed files. Quick Open ranks files by recent and agent-touched paths and accepts `:line`.
* Git: Staged and Changes with stage, unstage and confirmed discard, Commit, Commit & Push and Amend, a generated commit message from your own model, Sync with a merge or rebase choice on divergence, and an exact confirmation before committing files that look sensitive.
* Graph and Branches: colored lanes and ref badges, inline commit files and diffs, copy hash, Ask, confirmed checkout and revert, GitHub/GitLab links, agent commit markers, filters, explicit paging and fetch, branch switch and create with dirty/detached confirmation, and comparison with the main branch.
* Diff view with hunk and file navigation, Ask and open in editor.
