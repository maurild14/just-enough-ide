import type { Host } from '../host.ts'
import { commitSteps, discardArgs, discardPlan, stageArgs, unstageArgs } from './commands.ts'
import type { CommitMode } from './commands.ts'
import { capDiff, parseNumstat, parseUnifiedDiff, untrackedDiffArgs, workingDiffArgs } from './diff.ts'
import type { DiffFile } from './diff.ts'
import { readHookSignals, usesHooks } from './hooks.ts'
import { cleanMessage, commitPrompt } from './message.ts'
import { GIT_ENV, GitError, git, gitArgv } from './run.ts'
import { sensitivePaths } from './sensitive.ts'
import { STATUS_ARGS, isRepo, parseStatus } from './status.ts'
import type { BranchInfo, RepoStatus, StatusEntry } from './status.ts'
import { isDivergence, resolveDivergence, syncSteps } from './sync.ts'
import type { PullConfig } from './sync.ts'

export const DIFF_MAX_LINES = 5000
const PROMPT_MAX_CHARS = 12_000

type Counts = Map<string, { added: number | null; removed: number | null }>

export type GitSnapshot =
  | { root: string; status: RepoStatus; numstat: Counts; staged: Counts; hooks: boolean }
  | { root: null }

async function counts(host: Host, root: string, args: string[]): Promise<Counts> {
  const map: Counts = new Map()
  try {
    const out = await git(host, root, args)
    for (const e of parseNumstat(out.stdout)) map.set(e.path, { added: e.added, removed: e.removed })
  } catch {
    // An unreadable numstat only loses the counts; the status stays usable.
  }
  return map
}

export async function snapshot(host: Host, cwd: string): Promise<GitSnapshot> {
  const root = await isRepo(host, cwd)
  if (root === null) return { root: null }
  const [status, numstat, staged, hooks] = await Promise.all([
    git(host, root, [...STATUS_ARGS]).then((r) => parseStatus(r.stdout)),
    counts(host, root, ['diff', '--numstat', '-z']),
    counts(host, root, ['diff', '--cached', '--numstat', '-z']),
    readHookSignals(host, root).then(usesHooks),
  ])
  return { root, status, numstat, staged, hooks }
}

export async function stage(host: Host, root: string, paths: readonly string[]): Promise<void> {
  const args = stageArgs(paths)
  if (args.length > 0) await git(host, root, args)
}

export async function unstage(host: Host, root: string, paths: readonly string[]): Promise<void> {
  const args = unstageArgs(paths)
  if (args.length > 0) await git(host, root, args)
}

/** Callers confirm first. Restores modified/deleted files and deletes untracked ones. */
export async function discard(host: Host, root: string, entries: readonly StatusEntry[]): Promise<void> {
  await runSteps(host, root, discardArgs(discardPlan(entries)))
}

export async function fileDiff(
  host: Host,
  root: string,
  path: string,
  opts: { staged: boolean; untracked: boolean },
): Promise<{ file: DiffFile | null; truncated: boolean }> {
  let text: string
  if (opts.untracked) {
    // `--no-index` exits 1 when the files differ, which is the normal case here.
    const argv = gitArgv(root, untrackedDiffArgs(path, host.platform))
    const res = await host.run(argv, { env: GIT_ENV })
    if (res.exitCode !== 0 && res.exitCode !== 1) throw new GitError(argv, res)
    text = res.stdout
  } else {
    text = (await git(host, root, workingDiffArgs(path, opts.staged))).stdout
  }
  const file = parseUnifiedDiff(text)[0]
  if (file === undefined) return { file: null, truncated: false }
  return capDiff(file, DIFF_MAX_LINES)
}

/** Asks the model for a commit message for the staged diff, or for the working diff when nothing is staged. */
export async function generateMessage(host: Host, root: string, model: string, stagedCount: number): Promise<string> {
  const args = ['diff', '--no-color', '--no-ext-diff', ...(stagedCount > 0 ? ['--cached'] : [])]
  let diff = (await git(host, root, args)).stdout
  if (stagedCount === 0) {
    // Untracked files are not in `git diff`; list them so a new-files-only change is not empty.
    const fresh = (await git(host, root, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout.split('\0').filter((p) => p !== '')
    if (fresh.length > 0) diff += `${diff === '' ? '' : '\n'}New files: ${fresh.join(', ')}\n`
  }
  return cleanMessage(await host.complete(commitPrompt(diff, PROMPT_MAX_CHARS), model))
}

/**
 * Steps for a commit plus the sensitive paths the commit would include: everything when the smart commit
 * will `add -A`, else the staged paths. `viaAgentShell` tells Claude Code to route hook-firing steps through
 * the agent's shell; OpenCode ignores it.
 */
export function commitPlan(
  snap: Extract<GitSnapshot, { root: string }>,
  input: { message: string; mode: CommitMode; smartCommit: boolean },
): { steps: string[][]; sensitive: string[]; viaAgentShell: boolean } {
  const { entries, branch } = snap.status
  const staged = entries.filter((e) => e.index !== null && e.index !== 'conflicted')
  const publish = input.mode === 'commit-push' && branch.upstream === null && branch.head !== null ? branch.head : undefined
  const steps = commitSteps({ ...input, stagedCount: staged.length, ...(publish === undefined ? {} : { publish }) })
  const addsAll = steps.some((s) => s[0] === 'add')
  const committed = addsAll ? entries : staged
  return { steps, sensitive: sensitivePaths(committed.map((e) => e.path)), viaAgentShell: snap.hooks }
}

/** Runs steps in order; the first failing step throws its `GitError` and the rest are skipped. */
export async function runSteps(host: Host, root: string, steps: readonly string[][]): Promise<void> {
  for (const step of steps) await git(host, root, step)
}

export async function initRepo(host: Host, dir: string): Promise<void> {
  await git(host, dir, ['init'])
}

async function configValue(host: Host, root: string, key: string): Promise<string | null> {
  try {
    const out = (await git(host, root, ['config', '--get', key])).stdout.trim()
    return out === '' ? null : out
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    return null // exit 1: unset
  }
}

export async function sync(
  host: Host,
  root: string,
  branch: BranchInfo,
  choice?: 'merge' | 'rebase',
): Promise<{ ok: true } | { ok: false; divergence: true } | { ok: false; error: string }> {
  let steps: string[][]
  if (choice !== undefined) {
    steps = resolveDivergence(choice)
  } else {
    const cfg: PullConfig = {
      rebase: await configValue(host, root, 'pull.rebase'),
      ff: await configValue(host, root, 'pull.ff'),
    }
    steps = syncSteps(cfg, branch)
    if (steps.length === 0) return { ok: false, error: 'Detached HEAD: check out a branch to sync.' }
  }
  try {
    await runSteps(host, root, steps)
    return { ok: true }
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (choice === undefined && isDivergence(err)) return { ok: false, divergence: true }
    return { ok: false, error: err.firstLine }
  }
}
