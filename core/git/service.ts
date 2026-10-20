import type { Host } from '../host.ts'
import { creationAction, parseReflog, type Candidate, type ReflogBoundary } from './agent.ts'
import { assertCommitHash, checkoutArgs, commitDiffArgs, commitFilesArgs, commitWebUrl, parseCommitFiles, revertArgs, type CommitFile } from './commit.ts'
import { branchesArgs, compareArgs, compareDiffArgs, createPlan, defaultBase, parseBranches, switchPlan, type Branch, type SwitchPlan } from './branches.ts'
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
import { isMerge, logArgs, parseLog, type GraphFilter, type LogCommit } from './log.ts'

export const DIFF_MAX_LINES = 5000
const PROMPT_MAX_CHARS = 12_000

function refusal(root: string, args: string[], message: string): GitError {
  return new GitError(gitArgv(root, args), { exitCode: 1, stdout: '', stderr: message })
}

async function readBranches(host: Host, root: string): Promise<Branch[]> {
  return parseBranches((await git(host, root, branchesArgs())).stdout)
}

export async function branches(host: Host, root: string): Promise<{ branches: Branch[]; base: string | null }> {
  const rows = await readBranches(host, root)
  let originHead: string | null = null
  try { originHead = (await git(host, root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])).stdout.trim() }
  catch (error) { if (!(error instanceof GitError) || error.exitCode !== 1) throw error }
  return { branches: rows, base: defaultBase(rows, originHead) }
}

export async function validBranchName(host: Host, root: string, name: string): Promise<boolean> {
  if (!name || name.startsWith('-') || name === '@') return false
  try { return (await git(host, root, ['check-ref-format', '--branch', name])).stdout.trim() === name }
  catch (error) { if (error instanceof GitError) return false; throw error }
}

function branchTarget(root: string, rows: readonly Branch[], name: string): Branch {
  const full = name.startsWith('refs/heads/') || name.startsWith('refs/remotes/')
  const matches = rows.filter((branch) => name === (full ? `refs/${branch.remote ? 'remotes' : 'heads'}/${branch.name}` : branch.name))
  if (name.startsWith('-') || matches.length !== 1) throw refusal(root, [], 'Invalid branch.')
  return matches[0]!
}

async function readCommit(host: Host, root: string, hash: string): Promise<LogCommit> {
  assertCommitHash(hash)
  const commit = parseLog((await git(host, root, logArgs({ branch: hash }, 0))).stdout)[0]
  if (commit?.hash !== hash) throw refusal(root, [], 'Invalid commit.')
  return commit
}

async function resolveRevision(host: Host, root: string, name: string): Promise<string> {
  if (/^[0-9a-f]{40}$/.test(name)) return (await readCommit(host, root, name)).hash
  return resolveBranch(host, root, name)
}

async function resolveBranch(host: Host, root: string, name: string): Promise<string> {
  const target = branchTarget(root, await readBranches(host, root), name)
  const ref = `refs/${target.remote ? 'remotes' : 'heads'}/${target.name}`
  const hash = (await git(host, root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).stdout.trim()
  assertCommitHash(hash)
  return hash
}

export async function compare(host: Host, root: string, base: string, head: string): Promise<CommitFile[]> {
  const [from, to] = await Promise.all([resolveRevision(host, root, base), resolveRevision(host, root, head)])
  const args = compareArgs(from, to)
  const [names, counts] = await Promise.all([git(host, root, args), git(host, root, args.map((word) => word === '--name-status' ? '--numstat' : word))])
  return parseCommitFiles(names.stdout, counts.stdout)
}

export async function compareDiff(host: Host, root: string, base: string, head: string, path: string): Promise<{ file: DiffFile | null; truncated: boolean }> {
  const [from, to] = await Promise.all([resolveRevision(host, root, base), resolveRevision(host, root, head)])
  const args = compareDiffArgs(from, to, path)
  const original = (await compare(host, root, from, to)).find((file) => file.path === path)?.from
  if (original !== undefined) args.push(original)
  const file = parseUnifiedDiff((await git(host, root, args)).stdout).find((file) => file.path === path)
  return file === undefined ? { file: null, truncated: false } : capDiff(file, DIFF_MAX_LINES)
}

export async function fetchAll(host: Host, root: string): Promise<void> {
  await git(host, root, ['fetch', '--prune'])
}

export async function webUrl(host: Host, root: string, hash: string): Promise<string | null> {
  assertCommitHash(hash)
  let remote = 'origin'
  try {
    const upstream = (await git(host, root, ['for-each-ref', '--format=%(HEAD)%00%(upstream:remotename)', 'refs/heads/'])).stdout.split(/\r?\n/).find((line) => line.startsWith('*\0'))?.slice(2)
    if (upstream) remote = upstream
    const url = (await git(host, root, ['remote', 'get-url', '--', remote])).stdout.trim()
    return commitWebUrl(url, hash)
  } catch (error) { if (error instanceof GitError) return null; throw error }
}

export type ActionResult = { ok: true } | { ok: false; confirm: string }
type StepsRunner = (steps: string[][]) => Promise<void>

async function readStatus(host: Host, root: string): Promise<RepoStatus> {
  return parseStatus((await git(host, root, [...STATUS_ARGS])).stdout)
}

function switchConfirmation(plan: SwitchPlan, status: RepoStatus): string | null {
  return status.branch.head === null
    ? `You are leaving detached HEAD. ${plan.confirm ?? 'Switch to a branch?'}` : plan.confirm
}

async function remoteLocalName(host: Host, root: string, target: Branch): Promise<string> {
  const ref = `refs/remotes/${target.name}`
  const mappings = (await git(host, root, ['config', '--get-regexp', '^remote\\..*\\.fetch$'])).stdout.split(/\r?\n/)
  const names = new Set<string>()
  for (const mapping of mappings) {
    const spec = mapping.slice(mapping.indexOf(' ') + 1).replace(/^\+/, '')
    const [source, destination] = spec.split(':')
    if (!source?.startsWith('refs/heads/') || !destination) continue
    const [prefix, suffix] = destination.split('*')
    if (suffix !== undefined && ref.startsWith(prefix!) && ref.endsWith(suffix)) names.add(source.replace('*', ref.slice(prefix!.length, suffix ? -suffix.length : undefined)).slice(11))
    else if (ref === destination) names.add(source.slice(11))
  }
  if (names.size !== 1) throw refusal(root, [], 'Invalid remote branch mapping.')
  return [...names][0]!
}

export async function switchBranch(host: Host, root: string, name: string, confirmed = false, run: StepsRunner = (steps) => runSteps(host, root, steps)): Promise<ActionResult> {
  const rows = await readBranches(host, root)
  const target = branchTarget(root, rows, name)
  const localName = target.remote ? await remoteLocalName(host, root, target) : target.name
  if (!await validBranchName(host, root, localName)) throw refusal(root, [], 'Invalid branch.')
  const status = await readStatus(host, root)
  const plan = switchPlan({ ...target, name: localName, remote: false }, status.entries.length > 0, rows)
  const confirm = switchConfirmation(plan, status)
  if (confirm !== null && !confirmed) return { ok: false, confirm }
  const steps = target.remote && !rows.some((branch) => !branch.remote && branch.name === localName)
    ? [['switch', '-c', localName, '--track', '--end-of-options', `refs/remotes/${target.name}`]]
    : [['switch', '--end-of-options', localName]]
  await run(steps)
  return { ok: true }
}

export async function createBranch(host: Host, root: string, name: string, start: string | null, confirmed = false, run: StepsRunner = (steps) => runSteps(host, root, steps)): Promise<ActionResult> {
  if (start !== null) await readCommit(host, root, start)
  if (!await validBranchName(host, root, name) || (await readBranches(host, root)).some((branch) => !branch.remote && branch.name === name)) throw refusal(root, [], 'Invalid branch.')
  const status = await readStatus(host, root)
  const plan = createPlan(name, start, status.entries.length > 0)
  const confirm = switchConfirmation(plan, status)
  if (confirm !== null && !confirmed) return { ok: false, confirm }
  plan.steps[0]!.splice(3, 0, '--end-of-options')
  await run(plan.steps)
  return { ok: true }
}

export const REVERT_MERGE_REFUSAL = 'Reverting a merge commit is not supported.'

export async function checkout(host: Host, root: string, hash: string, confirmed = false, run: StepsRunner = (steps) => runSteps(host, root, steps)): Promise<ActionResult> {
  await readCommit(host, root, hash)
  await readStatus(host, root)
  if (!confirmed) return { ok: false, confirm: `Check out ${hash.slice(0, 7)} (detached HEAD)?` }
  await run([checkoutArgs(hash)])
  return { ok: true }
}

export async function revert(host: Host, root: string, hash: string, confirmed = false, run: StepsRunner = (steps) => runSteps(host, root, steps)): Promise<ActionResult> {
  const commit = await readCommit(host, root, hash)
  if (isMerge(commit)) throw refusal(root, revertArgs(hash), REVERT_MERGE_REFUSAL)
  await readStatus(host, root)
  if (!confirmed) return { ok: false, confirm: `Revert ${hash.slice(0, 7)} "${commit.subject}"?` }
  await run([revertArgs(hash)])
  return { ok: true }
}

export async function graph(host: Host, root: string, filter: GraphFilter, count: number): Promise<{ commits: LogCommit[]; more: boolean }> {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(count + 1)) throw new Error('Invalid graph count.')
  let branch = filter.branch
  if (branch !== undefined && branch !== 'all') {
    branch = await resolveBranch(host, root, branch)
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
