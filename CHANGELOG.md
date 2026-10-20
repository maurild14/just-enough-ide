# Changelog

## Unreleased — 0.2

* Graph and Branches on both hosts: fitted lanes, inline commit files, historical diffs, copy/Ask, checkout/revert confirmation, supported web links, filter, fetch and explicit paging.
* Branch switching/creation with fresh dirty/detached confirmation and comparisons pinned to the selected branch hashes.
* Conservative session/repository agent commit markers from before/after tool evidence; JEI mutations and ambiguous overlaps are excluded.
* Full-hash/ref validation across OpenCode RPC; native dialogs and clipboard fallback. Merge reverts remain unsupported. No version bump or release is made by this entry.

## 0.1.0

First release, published by hand (see `CONTRIBUTING.md`, Releases).

### Features

* A pane docked beside a Claude Code or OpenCode session, with the same keys and behavior on both hosts.
* Files: a file tree with git status letters, agent activity glow, a fuzzy file filter, previews (code, Markdown, CSV and TSV, images on Claude Code), mention in the prompt and open in the editor.
* Git: Staged and Changes groups, stage, unstage and confirmed discard, Commit, Commit & Push and Amend, a generated commit message, Sync with a merge or rebase choice on divergence, a diff view with hunk and file navigation, and a confirmation before committing files that look sensitive.
* Search and Symbols tabs are placeholders in this release.
