import type { GitError } from './run.ts'
import type { BranchInfo } from './status.ts'

/** From `config --get pull.rebase` and `pull.ff`; null when unset. */
export type PullConfig = { rebase: string | null; ff: string | null }

/** Steps for the repository-row Sync. Detached HEAD has nothing to sync (the caller shows a message). */
export function syncSteps(cfg: PullConfig, branch: BranchInfo): string[][] {
  if (branch.head === null) return []
  if (branch.upstream === null) return [['push', '-u', 'origin', branch.head]]
  if (branch.behind === 0) return [['push']]
  const steps: string[][] = [cfg.rebase !== null || cfg.ff !== null ? ['pull'] : ['pull', '--ff-only']]
  if (branch.ahead > 0) steps.push(['push'])
  return steps
}

const DIVERGENCE = ['not possible to fast-forward', 'diverging branches', 'need to specify how to reconcile divergent branches']

export function isDivergence(err: GitError): boolean {
  const text = `${err.stderr}\n${err.firstLine}`.toLowerCase()
  return DIVERGENCE.some((m) => text.includes(m))
}

export function resolveDivergence(choice: 'merge' | 'rebase'): string[][] {
  return [['pull', ...(choice === 'merge' ? ['--no-rebase', '--ff'] : ['--rebase'])], ['push']]
}
