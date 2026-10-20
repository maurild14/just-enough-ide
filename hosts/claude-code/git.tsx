import type { EngineInterface, RenderElement } from 'claude-code'
import { commitPlan, discard, generateMessage, initRepo, runSteps, snapshot, stage, sync, unstage } from '../../core/git/service.ts'
import type { GitSnapshot } from '../../core/git/service.ts'
import { GitError, git, gitArgv } from '../../core/git/run.ts'
import type { FileStatus, StatusEntry } from '../../core/git/status.ts'
import type { Options } from '../../core/options.ts'
import { KEYS } from '../../core/keys.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { shellLine, type Shell } from '../../core/shared/argv.ts'
import { cellWidth, fitEnd, fitPath, padEnd } from '../../core/shared/fit.ts'
import { toPosix } from '../../core/shared/paths.ts'
import type { JeiAsk, JeiCommitMode, JeiGit, JeiGitUi } from '../../types/index.d.ts'
import { mutationGuard, refreshAfterChange, refreshGit } from './activity.ts'
import { historyConfirmation, renderGraph } from './graph.tsx'
import { firstLine, hostFor, reason, windowTop, type FilesAction, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { gitState, readCwd, readGit, readGitUi, readPane, readTick, setGit, updateGitUi, updatePane } from './state.ts'
import { color, statusLook } from './theme.ts'

export type Repo = Extract<JeiGit, { root: string }>
export type Group = 'staged' | 'changes'
/** One file row of a group: its element key is its id. */
export type FileRow = { id: string; group: Group; entry: StatusEntry; status: FileStatus; added: number | null; removed: number | null }

/**
 * Commit modes: `label` is the mode `Select`'s option, read after the
 * `[ Commit ]` Button (`[ Commit ] & Push ▾`), so the row says Commit once;
 * `title` names the Button where no Select is drawn.
 */
const MODES: readonly { value: JeiCommitMode; label: string; title: string }[] = [
  { value: 'commit', label: 'Only', title: 'Commit' },
  { value: 'commit-push', label: '& Push', title: 'Commit & Push' },
  { value: 'amend', label: 'Amend', title: 'Commit (amend)' },
]
/** Cells a terminal Button draws around its label: `[ ` and ` ]`. */
const CHROME = 4
const MINUS = '−'
const GENERATE = '✦ Generate'
/** Shortest the branch part (`⎇ name`) gets before the ahead/behind counts drop. */
const BRANCH_MIN = 10
/** Steps that fire repository hooks: these go through the agent's shell when the repo has hooks. */
const HOOKED = new Set(['commit', 'push', 'pull', 'merge', 'rebase', 'checkout', 'switch', 'revert'])

const trimDot = (s: string) => s.replace(/\.+$/, '')
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const isRepo = (g: JeiGit | null): g is Repo => g !== null && g.root !== null

/** The JSON snapshot back as core's shape (count records become Maps). */
export function snapOf(g: Repo): Extract<GitSnapshot, { root: string }> {
  return {
    root: g.root,
    status: g.status,
    numstat: new Map(Object.entries(g.numstat)),
    staged: new Map(Object.entries(g.staged)),
    hooks: g.hooks,
  }
}

/** The Staged and Changes groups, each sorted by path. Conflicts show under Changes only. */
export function groupsOf(g: Repo): Record<Group, FileRow[]> {
  const staged: FileRow[] = []
  const changes: FileRow[] = []
  for (const entry of g.status.entries) {
    if (entry.index !== null && entry.index !== 'ignored' && entry.index !== 'conflicted') {
      const c = g.staged[entry.path]
      staged.push({ id: `staged-${entry.path}`, group: 'staged', entry, status: entry.index, added: c?.added ?? null, removed: c?.removed ?? null })
    }
    if (entry.worktree !== null && entry.worktree !== 'ignored') {
      const c = g.numstat[entry.path]
      changes.push({ id: `change-${entry.path}`, group: 'changes', entry, status: entry.worktree, added: c?.added ?? null, removed: c?.removed ?? null })
    }
  }
  const byPath = (a: FileRow, b: FileRow) => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0)
  return { staged: staged.sort(byPath), changes: changes.sort(byPath) }
}

// ---------------------------------------------------------------------------
// Running git where hooks fire.

/** The session's shell tool, from the tool list of this operation: Bash when present, else PowerShell. */
async function agentShell($: EngineInterface): Promise<'Bash' | 'PowerShell'> {
  const names = new Set((await $.tool.list()).map((t) => t.name))
  if (names.has('Bash')) return 'Bash'
  if (names.has('PowerShell')) return 'PowerShell'
  throw new Error('Claude has no shell tool in this session, so git hooks cannot run')
}

/** A shell tool's error text without its `Exit code N` line, so `GitError.firstLine` is git's own. */
function shellError(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*exit code \d+\s*$/i.test(l))
    .join('\n')
}

/**
 * A step the agent's shell did not finish: left running (moved to the background or timed out), or
 * `interrupted` (stopped, so it is not running any more).
 */
export class StillRunning extends Error {
  readonly step: string
  readonly interrupted: boolean
  constructor(step: string, interrupted = false) {
    super(interrupted ? `git ${step} was interrupted` : `git ${step} is still running`)
    this.name = 'StillRunning'
    this.step = step
    this.interrupted = interrupted
  }
}

/** A host review refusal, not a Git failure: core Sync must keep the pending steps intact. */
class MissingReview extends Error {
  constructor(readonly pending: string[][]) {
    super('Claude auto mode could not review this Git operation.')
    this.name = 'MissingReview'
  }
}

/** The longest a shell tool runs a step in the foreground (its maximum). */
const SHELL_TIMEOUT_MS = 600_000
/** The commit message file for the agent's shell, in the git dir (never in the shell line). */
const MESSAGE_FILE = 'JEI_COMMIT_MSG'

let warnedAsk = false

/** `-m <message>` of a commit step, or null. */
function messageOf(step: readonly string[]): string | null {
  if (step[0] !== 'commit') return null
  const at = step.indexOf('-m')
  return at >= 0 && at + 1 < step.length ? step[at + 1]! : null
}

/**
 * Runs git steps for the Git tab. Without hooks every step runs directly
 * (`runSteps`, argv arrays). With hooks (`viaAgentShell`), steps that fire
 * hooks run through the session's shell tool (`$.tool.call`, after
 * `$.tool.check`) so the repository's hooks run; the rest run directly. The
 * shell line holds only git's own words and quoted paths: a commit message is
 * written to `<gitdir>/JEI_COMMIT_MSG` and passed as `-F <file>` (emptied once
 * the commit is done; the host has no delete). A failed step throws a
 * `GitError` naming it, a step the shell left running throws `StillRunning`;
 * the steps after it are skipped.
 */
export async function runHookAware($: EngineInterface, root: string, steps: readonly string[][], viaAgentShell: boolean): Promise<void> {
  const end = await mutationGuard($, root)
  try {
    const host = hostFor($, root)
    if (!viaAgentShell) return runSteps(host, root, steps)
    for (const [index, step] of steps.entries()) {
      if (!HOOKED.has(step[0] ?? '')) {
        await git(host, root, step)
        continue
      }
      const tool = await agentShell($)
      const shell: Shell = tool === 'Bash' ? 'bash' : 'powershell'
      let words = step
      let file: string | null = null
      const message = messageOf(step)
      if (message !== null) {
        const gitDir = toPosix((await git(host, root, ['rev-parse', '--absolute-git-dir'])).stdout.trim())
        file = `${gitDir}/${MESSAGE_FILE}`
        await $.fs.write(file, `${message}\n`)
        const at = step.indexOf('-m')
        words = [...step.slice(0, at), '-F', file, ...step.slice(at + 2)]
      }
      // Core's runner sets these through the environment; the agent's shell takes only flags.
      const command = shellLine(['git', '--no-optional-locks', '-c', 'core.quotepath=off', '-C', root, ...words], shell)
      const description = `Run git ${step[0]} so the repository's hooks run`
      const argv = gitArgv(root, step)
      const fail = (text: string): never => {
        if (text.includes(`The server-side auto mode classifier gave no verdict for ${tool}: the request that produced this action did not ask for one.`)) {
          throw new MissingReview(steps.slice(index).map((pending) => [...pending]))
        }
        throw new GitError(argv, { exitCode: 1, stdout: '', stderr: text })
      }
      let leftRunning = false
      try {
        const verdict = await $.tool.check({ tool, input: { command, description } })
        if (verdict.decision === 'deny') {
          fail(`Claude's permissions block ${tool}: ${verdict.reason ?? 'denied'}`)
        }
        if (verdict.decision === 'ask' && !warnedAsk) {
          warnedAsk = true
          $.ui.toast("This repo has git hooks, so JEI uses Claude's shell with its normal permissions and review.")
        }
        const r =
          tool === 'Bash'
            ? await $.tool.call({ tool: 'Bash', command, description, timeout: SHELL_TIMEOUT_MS })
            : await $.tool.call({ tool: 'PowerShell', command, description, timeout: SHELL_TIMEOUT_MS })
        if (r.deny !== undefined) fail(r.deny)
        if (r.isError === true) fail(shellError(r.text ?? (typeof r.result === 'string' ? r.result : '')))
        const ran = r.result as { interrupted?: boolean; backgroundTaskId?: string; timedOutAfterMs?: number; backgroundedByUser?: boolean } | undefined
        if (ran?.backgroundTaskId !== undefined || ran?.timedOutAfterMs !== undefined || ran?.backgroundedByUser === true) {
          leftRunning = true
          throw new StillRunning(step[0] ?? 'git')
        }
        if (ran?.interrupted === true) throw new StillRunning(step[0] ?? 'git', true)
      } finally {
        // A commit still running may yet read its message file: keep it then.
        if (file !== null && !leftRunning) await $.fs.write(file, '').catch(() => undefined)
      }
    }
    } finally { end() }
}

// ---------------------------------------------------------------------------
// Actions. Each refreshes git and the Files listings when it changed anything.

function act($: EngineInterface, fn: () => Promise<unknown>): () => void {
  return () => {
    void fn().catch((err: unknown) => $.ui.log(`jei: ${reason(err)}`))
  }
}

/**
 * Runs `fn` with `label` in the repository row, then refreshes. The check and
 * the set are one state update, so two presses never both run; a second
 * operation is refused with a toast. False when refused.
 */
export async function busy($: EngineInterface, label: string, fn: () => Promise<void>, refresh = true): Promise<boolean> {
  let held: string | null = null
  await updateGitUi($, (u) => {
    held = u.busy
    return u.busy === null ? { ...u, busy: label } : u
  })
  if (held !== null) {
    $.ui.toast(`Still working: ${held}`)
    return false
  }
  const g = await readGit($)
  const end = refresh && g?.root ? await mutationGuard($, g.root) : () => {}
  try {
    await fn()
  } finally {
    end()
    await updateGitUi($, (u) => ({ ...u, busy: null }))
    if (refresh) await refreshAfterChange($, [], true)
  }
  return true
}

async function repoOrToast($: EngineInterface): Promise<Repo | null> {
  const g = await readGit($)
  if (isRepo(g)) return g
  $.ui.toast(g === null ? 'Git is still loading.' : 'This folder is not a git repository.')
  return null
}

function setAsk($: EngineInterface, ask: JeiGitUi['ask']): Promise<JeiGitUi> {
  return updateGitUi($, (u) => ({ ...u, ask }))
}

async function stageRows($: EngineInterface, rows: readonly FileRow[]): Promise<void> {
  const g = await repoOrToast($)
  if (g === null || rows.length === 0) return
  await busy($, 'Staging…', async () => {
    try {
      await stage(hostFor($, g.root), g.root, rows.map((r) => r.entry.path))
    } catch (err) {
      $.ui.toast(`Stage failed: ${trimDot(failure(err))}.`)
    }
  })
}

async function unstageRows($: EngineInterface, rows: readonly FileRow[]): Promise<void> {
  const g = await repoOrToast($)
  if (g === null || rows.length === 0) return
  await busy($, 'Unstaging…', async () => {
    try {
      await unstage(hostFor($, g.root), g.root, rows.map((r) => r.entry.path))
    } catch (err) {
      $.ui.toast(`Unstage failed: ${trimDot(failure(err))}.`)
    }
  })
}

/** Discard runs only from the confirm row's Discard; a busy tab keeps the question. */
async function discardNow($: EngineInterface, paths: readonly string[]): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const wanted = new Set(paths)
  const entries = g.status.entries.filter((e) => wanted.has(e.path))
  await busy($, 'Discarding…', async () => {
    await setAsk($, null)
    try {
      await discard(hostFor($, g.root), g.root, entries)
    } catch (err) {
      $.ui.toast(`Discard failed: ${trimDot(failure(err))}.`)
    }
  })
}

function failure(err: unknown): string {
  return err instanceof GitError ? err.firstLine : firstLine(err)
}

const RUNNING_WHAT: Readonly<Record<string, string>> = { commit: 'Commit', push: 'Push', pull: 'Pull' }

function stillRunning(what: string, err: StillRunning): string {
  return err.interrupted ? `${what} was interrupted.` : `${what} is still running in the background; check the terminal.`
}

/**
 * Commits as the mode says, from a snapshot read now (not the one on screen).
 * Files that look sensitive ask first; `confirmed` is what the person said
 * Commit anyway to, and only covers those paths: a new one asks again.
 */
async function commitNow($: EngineInterface, options: Options, confirmed: readonly string[] | null = null): Promise<void> {
  if ((await repoOrToast($)) === null) return
  const ui = await readGitUi($)
  const message = ui.message.trim()
  if (message === '') {
    $.ui.toast('Write a commit message first.')
    return
  }
  const cwd = await readCwd($)
  await busy($, 'Committing…', async () => {
    let fresh: GitSnapshot
    try {
      fresh = await snapshot(hostFor($, cwd), cwd)
    } catch (err) {
      $.ui.toast(`Commit failed: ${trimDot(failure(err))}.`)
      return
    }
    if (fresh.root === null) {
      $.ui.toast('This folder is not a git repository.')
      return
    }
    await setGit($, gitState(fresh))
    const changed = fresh.status.entries.some((e) => e.index !== 'ignored' && e.worktree !== 'ignored')
    if (!changed && ui.mode !== 'amend') {
      $.ui.toast('No changes to commit.')
      return
    }
    const plan = commitPlan(fresh, { message, mode: ui.mode, smartCommit: options.smartCommit })
    if (plan.refusal !== undefined) {
      await setAsk($, null)
      $.ui.toast(plan.refusal)
      return
    }
    const covered = confirmed !== null && plan.sensitive.every((p) => confirmed.includes(p))
    if (plan.sensitive.length > 0 && !covered) {
      await setAsk($, { kind: 'sensitive', paths: plan.sensitive })
      return
    }
    await setAsk($, null)
    try {
      await runHookAware($, fresh.root, plan.steps, plan.viaAgentShell)
      await updateGitUi($, (u) => ({ ...u, message: '' }))
      $.ui.toast(ui.mode === 'commit-push' ? 'Committed and pushed.' : 'Committed.')
    } catch (err) {
      if (err instanceof StillRunning) {
        if (err.step === 'commit') {
          $.ui.toast(stillRunning('Commit', err))
          return
        }
        // The commit landed; only its push is unfinished. The message is spent.
        await updateGitUi($, (u) => ({ ...u, message: '' }))
        $.ui.toast(`Committed. ${stillRunning(RUNNING_WHAT[err.step] ?? 'Push', err)}`)
        return
      }
      const pushed = err instanceof GitError && err.argv.includes('push') || err instanceof MissingReview && err.pending[0]?.[0] === 'push'
      $.ui.toast(`${pushed ? 'Push' : 'Commit'} failed: ${trimDot(failure(err))}.`)
    }
  })
}

async function syncNow($: EngineInterface, choice?: 'merge' | 'rebase'): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  await busy($, 'Syncing…', async () => {
    await setAsk($, null)
    try {
      const host = hostFor($, g.root)
      const r = await sync(host, g.root, g.status.branch, choice, (steps) => runHookAware($, g.root, steps, g.hooks))
      if (r.ok) $.ui.toast('Synced.')
      else if ('divergence' in r) await setAsk($, { kind: 'divergence' })
      else $.ui.toast(`Sync failed: ${trimDot(r.error)}.`)
    } catch (err) {
      if (err instanceof MissingReview) await setAsk($, { kind: 'sync-review', root: g.root, pending: err.pending, ...(choice ? { choice } : {}) })
      else if (err instanceof StillRunning) $.ui.toast(stillRunning('Sync', err))
      else $.ui.toast(`Sync failed: ${trimDot(failure(err))}.`)
    }
  })
}

async function askSyncClaude($: EngineInterface, ask: Extract<JeiAsk, { kind: 'sync-review' }>): Promise<void> {
  await busy($, 'Preparing request…', async () => {
    const cwd = await readCwd($)
    try {
      const root = toPosix((await git(hostFor($, cwd), cwd, ['rev-parse', '--show-toplevel'])).stdout.trim())
      if (root !== ask.root || (await readCwd($)) !== cwd) {
        $.ui.toast('The repository changed. Cancel this request and start Sync again.')
        return
      }
      if ((await readGitUi($)).ask?.kind !== 'sync-review') return
      const strategy = ask.choice ? ` I chose ${ask.choice} if reconciliation is still needed.` : ''
      const text = `\n\nClaude auto mode could not review my Sync request. Please inspect the current repository state and complete only the remaining work. Pending Git argument arrays: ${JSON.stringify(ask.pending)}. Treat each argument literally.${strategy} Do not repeat completed steps; preserve local work and use normal hooks and permissions.\n\n`
      const r = await $.prompt.fill({ text, mode: 'insert' })
      if (r.isFilled) await setAsk($, null)
      else $.ui.toast("The prompt can't take the request right now.")
    } catch (err) {
      $.ui.toast(`Can't prepare the Sync request: ${trimDot(failure(err))}.`)
    }
  }, false)
}

async function askClaude($: EngineInterface): Promise<void> {
  const g = await readGit($)
  await setAsk($, null)
  const branch = isRepo(g) ? (g.status.branch.head ?? 'HEAD') : 'my branch'
  const upstream = isRepo(g) ? (g.status.branch.upstream ?? 'its upstream') : 'its upstream'
  const text = `My branch ${branch} and ${upstream} have diverged. Explain the choices (merge or rebase) and reconcile them the way I pick, without losing work.`
  const r = await $.prompt.fill({ text, mode: 'insert' })
  if (!r.isFilled) $.ui.toast("The prompt can't take the request right now.")
}

async function generate($: EngineInterface, options: Options): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const stagedCount = groupsOf(g).staged.length
  await busy(
    $,
    'Generating…',
    async () => {
      try {
        const text = await generateMessage(hostFor($, g.root), g.root, options.commitModel, stagedCount)
        if (text === '') $.ui.toast('The model gave no message.')
        else await updateGitUi($, (u) => ({ ...u, message: text }))
      } catch (err) {
        $.ui.toast(`Can't generate a message: ${trimDot(firstLine(err))}.`)
      }
    },
    false,
  )
}

async function init($: EngineInterface): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  const end = await mutationGuard($, root)
  try {
    await initRepo(hostFor($, root), root)
  } catch (err) {
    $.ui.toast(`Can't initialize the repository: ${trimDot(failure(err))}.`)
  } finally { end() }
  await refreshGit($)
}

async function openDiff($: EngineInterface, row: FileRow): Promise<void> {
  await updateGitUi($, (u) => ({ ...u, diffTop: 0 }))
  await updatePane($, (s) =>
    reducePane(reducePane(s, { type: 'select', view: 'git', id: row.id }), {
      type: 'open-diff',
      path: row.entry.path,
      source: { kind: 'working', staged: row.group === 'staged', untracked: row.status === 'untracked' },
    }),
  )
}

// ---------------------------------------------------------------------------
// Selection: the window is anchored to the selected row's id.

/** Selectable rows as last drawn (group headers and files) and the selection they showed. */
type GitList = { ids: string[]; selected: string | undefined; rows: Map<string, FileRow>; focused: string | undefined }
const lists = new Map<string, GitList>()
async function gitList($: EngineInterface): Promise<GitList> {
  const key = `${await $.session.id()}\0${await readCwd($)}`
  let list = lists.get(key)
  if (!list) { list = { ids: [], selected: undefined, rows: new Map(), focused: undefined }; lists.set(key, list) }
  return list
}
const GROUP_PREFIX = 'group-'
const isRowKey = (k: string) => /^(change-|staged-|group-|graph-|commit-file-|checkout-|revert-|web-)/.test(k)

/** The ring moved onto a Git row: it becomes the selection. */
export async function focusGit($: EngineInterface, element: string | undefined): Promise<void> {
  if (currentView(await readPane($)) !== 'git') return
  const list = await gitList($)
  list.focused = element
  if (element === undefined || !isRowKey(element)) return
  if (currentView(await readPane($)) !== 'git') return
  await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id: element }))
}

/** Scroll keys on the Git list move the selection. True when handled. */
export async function scrollGitList($: EngineInterface, by: number): Promise<boolean> {
  if (currentView(await readPane($)) !== 'git') return false
  const list = await gitList($)
  if (!list.ids.length) return false
  const from = list.selected === undefined ? -1 : list.ids.indexOf(list.selected)
  const to = Math.max(0, Math.min(list.ids.length - 1, from < 0 ? 0 : from + Math.sign(by) * Math.max(1, Math.abs(by))))
  const id = list.ids[to]!
  await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id }))
  await $.ui.focus({ requestId: 'jei', key: id }).catch(() => undefined)
  return true
}

async function selectedTarget($: EngineInterface): Promise<{ row?: FileRow; group?: Group }> {
  const list = await gitList($)
  const id = list.selected
  if (id === undefined) return {}
  if (id === `${GROUP_PREFIX}staged`) return { group: 'staged' }
  if (id === `${GROUP_PREFIX}changes`) return { group: 'changes' }
  const row = list.rows.get(id)
  return row ? { row } : {}
}

async function keyStage($: EngineInterface): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const groups = groupsOf(g)
  const t = await selectedTarget($)
  if (t.group === 'changes') return stageRows($, groups.changes)
  if (t.row?.group === 'changes') return stageRows($, [t.row])
  $.ui.toast(t.row ? 'That file is already staged.' : 'Select a change first.')
}

async function keyUnstage($: EngineInterface): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const groups = groupsOf(g)
  const t = await selectedTarget($)
  if (t.group === 'staged') return unstageRows($, groups.staged)
  if (t.row?.group === 'staged') return unstageRows($, [t.row])
  $.ui.toast('Select a staged file first.')
}

async function keyDiscard($: EngineInterface): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const groups = groupsOf(g)
  const t = await selectedTarget($)
  if (t.group === 'changes') return askDiscardAll($, groups.changes)
  if (t.row?.group === 'changes') {
    await setAsk($, { kind: 'discard', paths: [t.row.entry.path], all: false })
    return
  }
  $.ui.toast(t.row ? 'Unstage that file first to discard it.' : 'Select a change first.')
}

async function askDiscardAll($: EngineInterface, rows: readonly FileRow[]): Promise<void> {
  if (rows.length === 0) return
  await setAsk($, { kind: 'discard', paths: rows.map((r) => r.entry.path), all: true })
}

// ---------------------------------------------------------------------------
// Drawing.

type Look = { color?: string; dim?: boolean; bold?: boolean }
type Part = { text: string; look: Look }

function countsText(r: { added: number | null; removed: number | null }): string {
  if (r.added === null || r.removed === null) return ''
  return `+${r.added} ${MINUS}${r.removed}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The Git tab: the repository row (header), any open question, the commit
 * area and the Staged and Changes groups, sized to the frame on every draw.
 * Reads state, never writes it.
 */
export async function renderGit($: EngineInterface, e: PaneRender, frame: FilesFrame, options: Options): Promise<FilesView> {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  // Mobile draws no Input and no Select (its element table has neither, though the resolved table may
  // still carry them): the message then shows as text and Commit names the mode.
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const Select = e.surface !== 'mobile' && 'Select' in els ? els.Select : undefined
  const root = await readCwd($)
  const g = await readGit($)
  const ui = await readGitUi($)
  const pane = await readPane($)
  await readTick($) // subscribes: a refresh redraws
  const inner = frame.inner
  const gutter = inner > 0 ? ' ' : ''
  const line = (text: string, look: Look = {}, key?: string) => (
    <Box key={key}>
      <Text dimColor={look.dim} color={look.color} weight={look.bold ? 'bold' : undefined} wrap="truncate-end">
        {inner > 0 ? ` ${fitEnd(text, inner)}` : ''}
      </Text>
    </Box>
  )
  /** Buttons flowed into rows that fit, 1 cell apart; a Button is its label plus chrome. */
  const buttons = (key: string, list: { key: string; label: string; run: () => void; primary?: boolean; hotkey?: string }[]) => {
    const rows: (typeof list)[] = [[]]
    let used = 0
    for (const b of list) {
      const w = cellWidth(b.label) + CHROME
      const cur = rows[rows.length - 1]!
      if (cur.length > 0 && used + 1 + w > inner) {
        rows.push([b])
        used = w
      } else {
        cur.push(b)
        used += (cur.length > 1 ? 1 : 0) + w
      }
    }
    return rows.map((r, i) => (
      <Box key={`${key}-${i}`} flexDirection="row">
        <Text>{gutter}</Text>
        <Box flexDirection="row" gap={1}>
          {r.map((b) => (
            <Button key={b.key} variant={b.primary ? 'primary' : 'secondary'} hotkey={b.hotkey} onPress={b.run}>
              {fitEnd(b.label, Math.max(1, inner - CHROME))}
            </Button>
          ))}
        </Box>
      </Box>
    ))
  }

  if (root === '' || g === null) {
    return { header: line('Git'), body: [line('Loading…', { dim: true }, 'notice')], actions: [] }
  }
  if (!isRepo(g)) {
    const name = toPosix(root).replace(/\/+$/, '').split('/').pop() || 'Git'
    return {
      header: line(name),
      body: [line('This folder is not a git repository.', { dim: true }, 'notice'), ...buttons('init-row', [{ key: 'init', label: 'Initialize repository', run: act($, () => init($)), primary: true }])],
      actions: [],
    }
  }

  const { branch, entries } = g.status
  const groups = groupsOf(g)
  const L = frame.columns >= 100
  const M = frame.columns >= 60

  // Repository row: repo, branch, ↓↑, hook marker, Sync; parts drop by docs/design.md section 5.
  const dirty = entries.some((x) => x.index !== 'ignored' && x.worktree !== 'ignored' && (x.index !== null || x.worktree !== null))
  const repoName = toPosix(g.root).replace(/\/+$/, '').split('/').pop() ?? ''
  const branchName = branch.head ?? `(detached ${(branch.oid ?? '').slice(0, 7)})`
  const branchPart: Part = { text: `⎇ ${branchName}${dirty ? '*' : ''}`, look: branch.head === null ? { color: color('warning') } : {} }
  const ab =
    branch.head === null ? null : branch.upstream === null ? { text: 'no upstream', look: { color: color('warning') } } : branch.ahead + branch.behind > 0 ? { text: `↓${branch.behind} ↑${branch.ahead}`, look: {} } : null
  const named: { id: string; part: Part }[] = []
  if (L) named.push({ id: 'repo', part: { text: repoName, look: {} } })
  named.push({ id: 'branch', part: branchPart })
  if (ab) named.push({ id: 'ab', part: ab })
  if (g.hooks) named.push({ id: 'hooks', part: { text: 'hooks', look: { color: color('warning') } } })
  if (ui.busy !== null) named.push({ id: 'busy', part: { text: ui.busy, look: { dim: true } } })
  let sync = M && ui.busy === null
  const widthOf = () => named.reduce((n, p, i) => n + cellWidth(p.part.text) + (i > 0 ? 2 : 0), 0) + (sync ? 2 + cellWidth('Sync') : 0)
  // The branch name shortens (to BRANCH_MIN) before ↓↑ drops; then it takes what is left.
  const fullBranch = branchPart.text
  const shorten = () => {
    branchPart.text = fullBranch
    const over = widthOf() - inner
    if (over > 0) branchPart.text = fitEnd(fullBranch, Math.max(Math.min(BRANCH_MIN, cellWidth(fullBranch)), cellWidth(fullBranch) - over))
  }
  for (const drop of ['repo', 'sync', 'hooks', ...(ui.busy === 'fetching…' ? [] : ['busy']), 'shorten', 'ab']) {
    if (widthOf() <= inner) break
    if (drop === 'sync') sync = false
    else if (drop === 'shorten') shorten()
    else {
      const at = named.findIndex((p) => p.id === drop)
      if (at >= 0) named.splice(at, 1)
    }
  }
  if (widthOf() > inner) branchPart.text = fitEnd(fullBranch, Math.max(0, inner))
  const leftW = named.reduce((n, p, i) => n + cellWidth(p.part.text) + (i > 0 ? 2 : 0), 0)
  const header = (
    <Box key="repo" flexDirection="row">
      <Text>{gutter}</Text>
      {named.map((p, i) => (
        <Text color={p.part.look.color} dimColor={p.part.look.dim}>
          {`${i > 0 ? '  ' : ''}${p.part.text}`}
        </Text>
      ))}
      {sync && <Text>{' '.repeat(Math.max(2, inner - leftW - cellWidth('Sync')))}</Text>}
      {sync && <Button key="sync" plain onPress={act($, () => syncNow($))} label="Sync" />}
    </Box>
  )

  // The open question, pinned above the list: a muted rule, its text, its Buttons. On a short pane the
  // rule goes first, then text rows; the Buttons always stay (docs/design.md section 6).
  let askText: string[] = []
  let fitAskText = (rows: number): string[] => askText.slice(0, Math.max(0, rows))
  let askButtons: RenderElement[] = []
  const ask = ui.ask
  if (ask !== null) {
    const cancel = { key: 'confirm-cancel', label: 'Cancel', run: act($, () => setAsk($, null)) }
    if (ask.kind === 'discard') {
      const one = ask.paths[0] ?? ''
      const untracked = !ask.all && g.status.entries.some((x) => x.path === one && x.worktree === 'untracked')
      const deleted = ask.paths.filter((p) => g.status.entries.some((x) => x.path === p && x.worktree === 'untracked')).length
      const q = ask.all
        ? `Discard all changes (${plural(ask.paths.length, 'file')}${deleted > 0 ? `, ${deleted} untracked will be deleted` : ''})?`
        : `${untracked ? 'Delete the untracked file' : 'Discard changes to'} ${fitPath(baseName(one), Math.max(1, inner - 28))}?`
      askText = [q] // destructive: the question carries the emphasis
      askButtons = buttons('ask-buttons', [{ key: 'confirm-discard', label: 'Discard', run: act($, () => discardNow($, ask.paths)) }, cancel])
    } else if (ask.kind === 'sensitive') {
      // Names flow onto as many rows as they need; with too few rows the list ends in `+N more`.
      const shown = (k: number) => {
        const list = [...ask.paths.slice(0, k), ...(k < ask.paths.length ? [`+${ask.paths.length - k} more`] : [])]
        return wrapWords([...'These files look sensitive:'.split(' '), ...list.map((p, i) => (i < list.length - 1 ? `${p},` : p))], inner)
      }
      askText = shown(ask.paths.length)
      fitAskText = (rows) => {
        for (let k = ask.paths.length; k >= 0; k--) {
          const text = shown(k)
          if (text.length <= rows) return text
        }
        return []
      }
      askButtons = buttons('ask-buttons', [
        { key: 'sensitive-commit', label: 'Commit anyway', run: act($, () => commitNow($, options, ask.paths)) },
        { ...cancel, key: 'sensitive-cancel' },
      ])
    } else if (ask.kind === 'history') {
      askButtons = historyConfirmation($, e, frame, ask)
    } else if (ask.kind === 'divergence') {
      askText = ['Your branch and its upstream have diverged.']
      askButtons = buttons('ask-buttons', [
          { key: 'diverge-merge', label: 'Merge', run: act($, () => syncNow($, 'merge')) },
          { key: 'diverge-rebase', label: 'Rebase', run: act($, () => syncNow($, 'rebase')) },
          { key: 'diverge-ask', label: 'Ask Claude', run: act($, () => askClaude($)) },
          { ...cancel, key: 'diverge-cancel' },
      ])
    } else if (ask.kind === 'sync-review') {
      askText = wrapWords('Claude auto mode could not review Sync. Ask Claude to continue from the prompt.'.split(' '), inner)
      askButtons = buttons('ask-buttons', [
        { key: 'sync-review-ask', label: 'Ask Claude', run: act($, () => askSyncClaude($, ask)) },
        { ...cancel, key: 'sync-review-cancel', hotkey: KEYS.git.find((key) => key.action === 'back')!.key },
      ])
    }
  }

  type Item = { id: string; isRow: boolean; el: RenderElement }
  const items: Item[] = []

  // Commit area: the message field, then Commit, its mode menu and Generate.
  const full = `Message (enter to commit on "${branch.head ?? 'HEAD'}")`
  const placeholder = M && cellWidth(full) <= inner - 2 ? full : 'Message'
  const setMessage = (value: string) => act($, () => updateGitUi($, (u) => ({ ...u, message: value })))()
  items.push({
    id: 'message',
    isRow: false,
    el: Input ? (
      <Box key="message-row" flexDirection="row">
        <Text>{gutter}</Text>
        <Input
          key="message"
          placeholder={placeholder}
          value={ui.message}
          submitLabel="commit"
          onInput={setMessage}
          onSubmit={(value: string) =>
            act($, async () => {
              await updateGitUi($, (u) => ({ ...u, message: value }))
              await commitNow($, options)
            })()
          }
        />
      </Box>
    ) : (
      line(ui.message === '' ? placeholder : ui.message, { dim: ui.message === '' }, 'message')
    ),
  })
  // With the mode Select beside it the Button is the verb alone; without one it names the mode.
  const modeLabel = Select ? 'Commit' : (MODES.find((m) => m.value === ui.mode)?.title ?? 'Commit')
  const canCommit = ui.message.trim() !== '' && ui.busy === null
  const controls: { el: RenderElement; w: number }[] = []
  controls.push(
    canCommit
      ? { w: cellWidth(modeLabel) + CHROME, el: <Button key="commit" variant="primary" onPress={act($, () => commitNow($, options))} label={modeLabel} /> }
      : {
          w: cellWidth(modeLabel) + CHROME,
          el: (
            <Box key="commit-off">
              <Text dimColor>{`[ ${modeLabel} ]`}</Text>
            </Box>
          ),
        },
  )
  if (Select) {
    const w = Math.max(...MODES.map((m) => cellWidth(m.label))) + 2
    controls.push({
      w,
      el: (
        <Select
          key="commit-mode"
          options={MODES.map((m) => ({ value: m.value, label: m.label }))}
          value={ui.mode}
          onSelect={(value: string) =>
            act($, () => updateGitUi($, (u) => ({ ...u, mode: MODES.some((m) => m.value === value) ? (value as JeiCommitMode) : u.mode })))()
          }
        />
      ),
    })
  }
  controls.push(
    ui.busy === 'Generating…'
      ? { w: cellWidth('Generating…'), el: <Text dimColor>Generating…</Text> }
      : { w: cellWidth(GENERATE), el: <Button key="generate" plain dimColor onPress={act($, () => generate($, options))} label={GENERATE} /> },
  )
  {
    let row: { el: RenderElement; w: number }[] = []
    let used = 0
    const flush = (i: number) => {
      if (row.length === 0) return
      items.push({
        id: `commit-${i}`,
        isRow: false,
        el: (
          <Box key={`commit-row-${i}`} flexDirection="row">
            <Text>{gutter}</Text>
            <Box flexDirection="row" gap={1}>
              {row.map((c) => c.el)}
            </Box>
          </Box>
        ),
      })
      row = []
      used = 0
    }
    let n = 0
    for (const c of controls) {
      if (row.length > 0 && used + 1 + c.w > inner) flush(n++)
      used += (row.length > 0 ? 1 : 0) + c.w
      row.push(c)
    }
    flush(n)
  }
  if (groups.staged.length === 0 && groups.changes.length === 0) items.push({ id: 'clean', isRow: false, el: line('No changes.', { dim: true }, 'notice') })
  else if (groups.staged.length === 0 && ui.mode !== 'amend') {
    items.push({ id: 'unstaged', isRow: false, el: line(options.smartCommit ? 'Nothing staged. Commit stages all changes.' : 'Nothing staged.', { dim: true }, 'notice') })
  }

  // Groups and their files.
  const visible = [...groups.staged, ...groups.changes]
  const countsOn = frame.columns >= 32
  const countsW = countsOn ? Math.max(0, ...visible.map((r) => cellWidth(countsText(r)))) : 0
  const selectable = [
    ...(groups.staged.length > 0 ? [`${GROUP_PREFIX}staged`, ...(ui.collapsed.includes('staged') ? [] : groups.staged.map((r) => r.id))] : []),
    ...(groups.changes.length > 0 ? [`${GROUP_PREFIX}changes`, ...(ui.collapsed.includes('changes') ? [] : groups.changes.map((r) => r.id))] : []),
  ]
  const saved = pane.selected.git
  const firstFile = selectable.find(id => !id.startsWith(GROUP_PREFIX))
  const stale = saved && /^(staged-|change-|group-(staged|changes)$)/.test(saved) && !selectable.includes(saved)
  const wanted = stale ? firstFile ?? selectable[0] : saved
  const graphView = await renderGraph($, e, frame, options, g, wanted, firstFile)
  selectable.unshift(...graphView.items.filter((i) => i.isRow).map((i) => i.id))
  const selected = wanted !== undefined && selectable.includes(wanted) ? wanted : graphView.defaultSelection
  const list = await gitList($)
  list.ids = selectable
  list.selected = selected
  list.rows = new Map(visible.map((r) => [r.id, r]))
  const inverseOf = (id: string) => id === selected && !(frame.isFocused && list.focused === id)

  const groupHeader = (group: Group, rows: FileRow[]) => {
    const id = `${GROUP_PREFIX}${group}`
    const collapsed = ui.collapsed.includes(group)
    const name = group === 'staged' ? 'Staged' : 'Changes'
    const count = String(rows.length)
    const acts =
      group === 'staged'
        ? [{ key: 'unstage-all', label: 'Unstage all', run: act($, () => unstageRows($, groups.staged)) }]
        : [
            { key: 'stage-all', label: 'Stage all', run: act($, () => stageRows($, groups.changes)) },
            { key: 'discard-all', label: 'Discard all', run: act($, () => askDiscardAll($, groups.changes)) },
          ]
    const base = 2 + cellWidth(name) + 1 + cellWidth(count)
    const actsW = acts.reduce((n, a) => n + 2 + cellWidth(a.label), 0)
    const showActs = base + actsW <= inner
    const nameRoom = Math.max(0, inner - cellWidth(count) - 1 - (showActs ? actsW : 0))
    const inverse = inverseOf(id)
    const toggle = act($, async () => {
      await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id }))
      await updateGitUi($, (u) => ({ ...u, collapsed: collapsed ? u.collapsed.filter((x) => x !== group) : [...u.collapsed, group] }))
    })
    return (
      <Box key={`line-${id}`} flexDirection="row">
        <Text>{gutter}</Text>
        <Button key={id} plain onPress={toggle}>
          <Text inverse={inverse}>{collapsed ? '▸' : '▾'}</Text>
          <Text dimColor inverse={inverse}>
            {padEnd(fitEnd(` ${name}`, Math.max(0, nameRoom - 1)), Math.max(0, nameRoom - 1))}
          </Text>
        </Button>
        {showActs &&
          acts.map((a) => (
            <Box key={`act-${a.key}`} flexDirection="row">
              <Text>{'  '}</Text>
              <Button key={a.key} plain dimColor onPress={a.run} label={a.label} />
            </Box>
          ))}
        <Text dimColor>{` ${count}`}</Text>
      </Box>
    )
  }

  const fileRow = (r: FileRow) => {
    const look = statusLook(r.status)
    const counts = countsOn ? countsText(r) : ''
    const cw = countsOn && countsW > 0 ? countsW : 0
    const gap = cw > 0 ? (inner >= 60 ? 2 : 1) : 0
    const room = Math.max(0, inner - 2 - gap - cw)
    const name = fitPath(baseName(r.entry.path), room)
    const dir = M ? dirName(r.entry.path) : ''
    const dirRoom = room - cellWidth(name) - 2
    const folder = dir !== '' && dirRoom >= 4 ? `  ${fitPath(dir, dirRoom)}` : ''
    const inverse = inverseOf(r.id)
    const [plus = '', minus = ''] = counts.split(' ')
    return (
      <Box key={`line-${r.id}`} flexDirection="row">
        <Text>{gutter}</Text>
        <Button key={r.id} plain onPress={act($, () => openDiff($, r))}>
          <Text color={look.color} dimColor={look.dim} weight={look.bold ? 'bold' : undefined} inverse={inverse}>
            {inner >= 2 ? look.letter || ' ' : ''}
          </Text>
          <Text inverse={inverse}>{inner >= 2 ? ` ${name}` : ''}</Text>
          <Text dimColor inverse={inverse}>
            {padEnd(folder, Math.max(0, room - cellWidth(name)))}
          </Text>
          {cw > 0 && (
            <Text inverse={inverse}>{`${' '.repeat(gap)}${' '.repeat(Math.max(0, cw - cellWidth(counts)))}`}</Text>
          )}
          {cw > 0 && plus !== '' && (
            <Text color={color('added')} inverse={inverse}>
              {plus}
            </Text>
          )}
          {cw > 0 && minus !== '' && (
            <Text color={color('removed')} inverse={inverse}>
              {` ${minus}`}
            </Text>
          )}
        </Button>
      </Box>
    )
  }

  items.push(...graphView.items)
  for (const group of ['staged', 'changes'] as const) {
    const rows = groups[group]
    if (rows.length === 0) continue
    items.push({ id: `${GROUP_PREFIX}${group}`, isRow: true, el: groupHeader(group, rows) })
    if (ui.collapsed.includes(group)) continue
    for (const r of rows) items.push({ id: r.id, isRow: true, el: fileRow(r) })
  }

  const workingActions: FilesAction[] = [
    { key: 's', run: act($, () => keyStage($)) },
    { key: 'u', run: act($, () => keyUnstage($)) },
    { key: 'd', run: act($, () => keyDiscard($)) },
    { key: 'c', run: act($, () => commitNow($, options)) },
    { key: 'g', run: act($, () => generate($, options)) },
    { key: 'e', run: act($, () => syncNow($)) },
  ]
  const actions = graphView.pinned.length ? [] : /^(graph-|group-graph$|commit-file-|checkout-|revert-|web-)/.test(selected ?? '')
    ? [...graphView.actions, ...(graphView.commitSelected ? [] : workingActions.filter(a => a.key === 'e'))]
    : workingActions

  const bodyRows = Math.max(1, frame.bodyRows)
  // A short pane drops the question's rule first, then cuts its text; its Buttons always stay.
  const pinned: RenderElement[] = ask === null ? [...graphView.pinned] : []
  if (ask !== null) {
    const withRule = 1 + askText.length + askButtons.length <= bodyRows - 1
    const text = askText.length + askButtons.length <= bodyRows ? askText : fitAskText(bodyRows - askButtons.length)
    if (withRule) pinned.push(line('─'.repeat(Math.max(0, inner)), { dim: true }, 'ask-rule'))
    text.forEach((t, i) => pinned.push(line(t, { color: color('warning') }, ask.kind === 'sensitive' ? `ask-text-${i}` : 'ask-text')))
    pinned.push(...askButtons.slice(0, Math.max(1, bodyRows - text.length)))
  }
  const room = bodyRows - pinned.length
  if (room <= 0) return { header, body: pinned.slice(0, bodyRows), actions }
  const ids = items.map((i) => i.id)
  const top = windowTop('git', ids, selected, room)
  return { header, body: [...pinned, ...items.slice(top, top + room).map((i) => i.el)], actions }
}

/** The Changes or Staged row a diff came from, and its neighbours, for `j`/`k`. */
export function groupRows(g: Repo, staged: boolean): FileRow[] {
  return groupsOf(g)[staged ? 'staged' : 'changes']
}

/**
 * Words flowed into lines of at most `width` cells, 1 space apart; the first
 * word is kept whole when it fits. A word wider than the line is cut with a
 * middle ellipsis (paths keep their basename).
 */
export function wrapWords(words: readonly string[], width: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const raw of words) {
    const w = cellWidth(raw) > width ? fitPath(raw, Math.max(1, width)) : raw
    if (cur === '') cur = w
    else if (cellWidth(cur) + 1 + cellWidth(w) <= width) cur = `${cur} ${w}`
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur !== '') out.push(cur)
  return out
}
