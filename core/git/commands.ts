import type { StatusEntry } from './status.ts'

/** Argv tails for `git(host, root, args)`. Empty input gives `[]` (no step to run), like `discardArgs`. */
export function stageArgs(paths: readonly string[]): string[] {
  return paths.length === 0 ? [] : ['add', '--', ...paths]
}

export function unstageArgs(paths: readonly string[]): string[] {
  return paths.length === 0 ? [] : ['restore', '--staged', '--', ...paths]
}

export type DiscardPlan = { restore: string[]; clean: string[] }

/**
 * Routes entries by worktree status: untracked goes to `clean`, worktree
 * modified/deleted goes to `restore`. Entries with no worktree change
 * (for example staged-added only) are skipped: `restore --worktree` cannot
 * discard them.
 */
export function discardPlan(entries: readonly StatusEntry[]): DiscardPlan {
  const plan: DiscardPlan = { restore: [], clean: [] }
  for (const e of entries) {
    if (e.worktree === 'untracked') plan.clean.push(e.path)
    else if (e.worktree === 'modified' || e.worktree === 'deleted') plan.restore.push(e.path)
  }
  return plan
}

export function discardArgs(plan: DiscardPlan): string[][] {
  const out: string[][] = []
  if (plan.restore.length > 0) out.push(['restore', '--worktree', '--', ...plan.restore])
  if (plan.clean.length > 0) out.push(['clean', '-f', '--', ...plan.clean])
  return out
}

export type CommitMode = 'commit' | 'commit-push' | 'amend'

/**
 * Smart commit stages everything first when nothing is staged (never for amend).
 * `publish` is the branch head the caller passes when there is no upstream: commit-push
 * then ends with `push -u origin <publish>` instead of `push`.
 */
export function commitSteps(input: { message: string; mode: CommitMode; smartCommit: boolean; stagedCount: number; publish?: string }): string[][] {
  const { message, mode, smartCommit, stagedCount, publish } = input
  if (mode === 'amend') return [['commit', '--amend', '-m', message]]
  const steps: string[][] = []
  if (smartCommit && stagedCount === 0) steps.push(['add', '-A'])
  steps.push(['commit', '-m', message])
  if (mode === 'commit-push') steps.push(publish ? ['push', '-u', 'origin', publish] : ['push'])
  return steps
}
