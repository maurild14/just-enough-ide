import type { Host } from '../host.ts'
import { creationAction, parseReflog, type Candidate, type ReflogBoundary } from './agent.ts'
import { assertCommitHash, commitDiffArgs, commitFilesArgs, parseCommitFiles, type CommitFile } from './commit.ts'
import { commitSteps, discardArgs, discardPlan, stageArgs, unstageArgs } from './commands.ts'
import type { CommitMode } from './commands.ts'
import { capDiff, omitSensitive, parseNumstat, parseUnifiedDiff, untrackedDiffArgs, workingDiffArgs } from './diff.ts'
import type { DiffFile } from './diff.ts'
import { readHookSignals, usesHooks } from './hooks.ts'
import { cleanMessage, commitPrompt } from './message.ts'
import { GIT_ENV, GitError, git, gitArgv } from './run.ts'
import { sensitivePaths } from './sensitive.ts'
import { STATUS_ARGS, isRepo, parseStatus } from './status.ts'
import type { BranchInfo, RepoStatus, StatusEntry } from './status.ts'
import { isDivergence, resolveDivergence, syncSteps } from './sync.ts'
import type { PullConfig } from './sync.ts'
import { logArgs, parseLog, type GraphFilter, type LogCommit } from './log.ts'

export const DIFF_MAX_LINES = 5000
const PROMPT_MAX_CHARS = 12_000

export async function graph(host: Host, root: string, filter: GraphFilter, count: number): Promise<{ commits: LogCommit[]; more: boolean }> {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(count + 1)) throw new Error('Invalid graph count.')
  let branch = filter.branch
  if (branch !== undefined && branch !== 'all') {
    const refs = (await git(host, root, ['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'])).stdout.trim().split('\n')
    const matches = refs.filter((ref) => ref === branch || ref === `refs/heads/${branch}` || ref === `refs/remotes/${branch}`)
    if (matches.length !== 1) throw new Error('Invalid branch.')
    branch = (await git(host, root, ['rev-parse', '--verify', `${matches[0]}^{commit}`])).stdout.trim()
    assertCommitHash(branch)
  } else if (branch === undefined) {
    try { await git(host, root, ['rev-parse', '--verify', '--quiet', 'HEAD']) }
    catch (error) {
      if (error instanceof GitError && error.exitCode === 1) return { commits: [], more: false }
      throw error
    }
  }
  const commits = parseLog((await git(host, root, logArgs({ ...filter, branch }, count))).stdout)
  return { commits: commits.slice(0, count), more: commits.length > count }
}

export async function commitFiles(host: Host, root: string, hash: string): Promise<CommitFile[]> {
  assertCommitHash(hash)
  const [names, counts] = await Promise.all(commitFilesArgs(hash).map((args) => git(host, root, args)))
  return parseCommitFiles(names!.stdout, counts!.stdout)
}

export async function commitDiff(host: Host, root: string, hash: string, path: string): Promise<{ file: DiffFile | null; truncated: boolean }> {
  assertCommitHash(hash)
  const parents = (await git(host, root, ['rev-list', '--parents', '--max-count=1', hash])).stdout.trim().split(' ')
  const isRoot = parents.length === 1
  const args = commitDiffArgs(hash, path, isRoot)
  // Include both paths so the pathspec does not turn a rename into a new-file diff.
  if (!isRoot) {
    const from = (await commitFiles(host, root, hash)).find((file) => file.path === path)?.from
    if (from !== undefined) args.push(from)
  }
  const file = parseUnifiedDiff((await git(host, root, args)).stdout).find((file) => file.path === path)
  return file === undefined ? { file: null, truncated: false } : capDiff(file, DIFF_MAX_LINES)
}

export async function newlyReachable(host: Host, root: string, from: string | null, to: string): Promise<Candidate[]> {
  assertCommitHash(to)
  if (from !== null) assertCommitHash(from)
  const args = ['rev-list', '--no-commit-header', '--format=%H %ct', '--max-count=500', to, ...(from === null ? [] : ['--not', from])]
  const candidates: Candidate[] = []
  for (const line of (await git(host, root, args)).stdout.split('\n')) {
    const match = /^([0-9a-f]{40}) (\d+)$/.exec(line)
    if (match) candidates.push({ hash: match[1]!, time: Number(match[2]) })
  }
  return candidates
}

async function readReflog(host: Host, root: string) {
  return parseReflog((await git(host, root, ['reflog', 'show', '-z', '--date=raw', '--format=%H%x00%gD%x00%gs', '-n', '501', 'HEAD'])).stdout)
}

async function missingGitRef(host: Host, root: string, args: string[]): Promise<boolean> {
  try { await git(host, root, args); return false }
  catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return true
    throw error
  }
}

/** Capture before execution; a failed/unreadable baseline must never block a user's tool. */
export async function captureReflog(host: Host, root: string, head: string | null): Promise<ReflogBoundary | null> {
  if (head !== null) assertCommitHash(head)
  try {
    if (head === null) {
      const ref = (await git(host, root, ['symbolic-ref', '--quiet', 'HEAD'])).stdout.trim()
      if (!ref.startsWith('refs/heads/')) return null
      const unborn = ['rev-parse', '--verify', '--quiet', 'HEAD']
      if (!await missingGitRef(host, root, unborn) || !await missingGitRef(host, root, ['reflog', 'exists', 'HEAD'])) return null
      return await missingGitRef(host, root, unborn) ? { entry: null } : null
    }
    const entries = await readReflog(host, root)
    return entries?.[0]?.hash === head ? { entry: entries[0].identity } : null
  } catch { return null }
}

/** Only creations above the immutable boundary are evidence; failures suppress attribution. */
export async function agentCandidates(host: Host, root: string, from: string | null, to: string, boundary: ReflogBoundary | null): Promise<Candidate[]> {
  assertCommitHash(to)
  if (from !== null) assertCommitHash(from)
  if (boundary === null) return []
  try {
    const entries = await readReflog(host, root)
    if (entries === null || entries[0]?.hash !== to) return []
    let end = entries.length
    if (boundary.entry !== null) {
      const matches = entries.flatMap((entry, index) => entry.identity === boundary.entry ? [index] : [])
      if (matches.length !== 1) return []
      end = matches[0]!
    } else if (from !== null || entries.length > 500 || !entries.at(-1)?.action.startsWith('commit (initial): ')) return []
    const created = new Set(entries.slice(0, end).filter((entry) => creationAction(entry.action)).map((entry) => entry.hash))
    if (created.size === 0) return []
    return (await newlyReachable(host, root, from, to)).filter((candidate) => created.has(candidate.hash))
  } catch { return [] }
}

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

/**
 * Asks the model for a commit message for the staged diff, or for the working diff when nothing is staged.
 * Files that look sensitive (`sensitive.ts`) go by name only: their contents never reach the model.
 */
export async function generateMessage(host: Host, root: string, model: string, stagedCount: number): Promise<string> {
  const args = ['diff', '--no-color', '--no-ext-diff', ...(stagedCount > 0 ? ['--cached'] : [])]
  let diff = omitSensitive((await git(host, root, args)).stdout)
  if (stagedCount === 0) {
    // Untracked files are not in `git diff`; list them so a new-files-only change is not empty.
    const fresh = (await git(host, root, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout.split('\0').filter((p) => p !== '')
    if (fresh.length > 0) diff += `${diff === '' ? '' : '\n'}New files: ${fresh.join(', ')}\n`
  }
  return cleanMessage(await host.complete(commitPrompt(diff, PROMPT_MAX_CHARS), model))
}

export const CONFLICTS_REFUSAL = 'Resolve conflicts first.'

export type CommitPlan = { steps: string[][]; sensitive: string[]; viaAgentShell: boolean; refusal?: string }

/**
 * Steps for a commit plus the sensitive paths the commit would include: everything when the smart commit
 * will `add -A`, else the staged paths. `viaAgentShell` tells Claude Code to route hook-firing steps through
 * the agent's shell; OpenCode ignores it. While any entry is unmerged the plan has no steps and a `refusal`
 * the host shows instead (a smart commit's `add -A` would mark conflict markers as resolved).
 */
export function commitPlan(
  snap: Extract<GitSnapshot, { root: string }>,
  input: { message: string; mode: CommitMode; smartCommit: boolean },
): CommitPlan {
  const { entries, branch } = snap.status
  if (entries.some((e) => e.index === 'conflicted' || e.worktree === 'conflicted')) {
    return { steps: [], sensitive: [], viaAgentShell: snap.hooks, refusal: CONFLICTS_REFUSAL }
  }
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

/**
 * Pull and push per the repository row. `run` runs the steps (default: directly); Claude Code passes one that
 * routes hook-firing steps through the agent's shell. A `GitError` from it is classified like a direct failure.
 */
export async function sync(
  host: Host,
  root: string,
  branch: BranchInfo,
  choice?: 'merge' | 'rebase',
  run: (steps: string[][]) => Promise<void> = (steps) => runSteps(host, root, steps),
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
    await run(steps)
    return { ok: true }
  } catch (err) {
    if (!(err instanceof GitError)) throw err
    if (choice === undefined && isDivergence(err)) return { ok: false, divergence: true }
    return { ok: false, error: err.firstLine }
  }
}
