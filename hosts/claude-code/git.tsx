import type { EngineInterface, RenderElement } from 'claude-code'
import { commitPlan, discard, generateMessage, initRepo, runSteps, stage, sync, unstage } from '../../core/git/service.ts'
import type { GitSnapshot } from '../../core/git/service.ts'
import { GitError, git, gitArgv } from '../../core/git/run.ts'
import type { FileStatus, StatusEntry } from '../../core/git/status.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { shellLine, type Shell } from '../../core/shared/argv.ts'
import { cellWidth, fitEnd, fitPath, padEnd } from '../../core/shared/fit.ts'
import { toPosix } from '../../core/shared/paths.ts'
import type { JeiCommitMode, JeiGit, JeiGitUi } from '../../types/index.d.ts'
import { refreshAfterChange, refreshGit } from './activity.ts'
import { firstLine, hostFor, reason, windowTop, type FilesAction, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { readCwd, readGit, readGitUi, readPane, readTick, updateGitUi, updatePane } from './state.ts'
import { color, statusLook } from './theme.ts'

export type Repo = Extract<JeiGit, { root: string }>
export type Group = 'staged' | 'changes'
/** One file row of a group: its element key is its id. */
export type FileRow = { id: string; group: Group; entry: StatusEntry; status: FileStatus; added: number | null; removed: number | null }

const MODES: readonly { value: JeiCommitMode; label: string }[] = [
  { value: 'commit', label: 'Commit' },
  { value: 'commit-push', label: 'Commit & Push' },
  { value: 'amend', label: 'Commit (amend)' },
]
/** Cells a terminal Button draws around its label: `[ ` and ` ]`. */
const CHROME = 4
const MINUS = '−'
const GENERATE = '✦ Generate'
/** Shortest the branch part (`⎇ name`) gets before the ahead/behind counts drop. */
const BRANCH_MIN = 10
/** Steps that fire repository hooks: these go through the agent's shell when the repo has hooks. */
const HOOKED = new Set(['commit', 'push', 'pull', 'merge', 'rebase', 'checkout', 'switch'])

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

let shellTool: 'Bash' | 'PowerShell' | null = null

/** The session's shell tool, read from the tool list once: Bash, else PowerShell. */
async function agentShell($: EngineInterface): Promise<'Bash' | 'PowerShell'> {
  if (shellTool !== null) return shellTool
  const names = new Set((await $.tool.list()).map((t) => t.name))
  if (names.has('Bash')) shellTool = 'Bash'
  else if (names.has('PowerShell')) shellTool = 'PowerShell'
  else throw new Error('Claude has no shell tool in this session, so git hooks cannot run')
  return shellTool
}

/** A shell tool's error text without its `Exit code N` line, so `GitError.firstLine` is git's own. */
function shellError(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*exit code \d+\s*$/i.test(l))
    .join('\n')
}

let warnedAsk = false

/**
 * Runs git steps for the Git tab. Without hooks every step runs directly
 * (`runSteps`, argv arrays). With hooks (`viaAgentShell`), steps that fire
 * hooks run through the session's shell tool (`$.tool.call`, after
 * `$.tool.check`) so the repository's hooks run; the rest run directly. A
 * failed step throws a `GitError` naming it; the steps after it are skipped.
 */
export async function runHookAware($: EngineInterface, root: string, steps: readonly string[][], viaAgentShell: boolean): Promise<void> {
  const host = hostFor($, root)
  if (!viaAgentShell) return runSteps(host, root, steps)
  for (const step of steps) {
    if (!HOOKED.has(step[0] ?? '')) {
      await git(host, root, step)
      continue
    }
    const tool = await agentShell($)
    const shell: Shell = tool === 'Bash' ? 'bash' : 'powershell'
    const command = shellLine(['git', '-C', root, ...step], shell)
    const description = `Run git ${step[0]} so the repository's hooks run`
    const argv = gitArgv(root, step)
    const verdict = await $.tool.check({ tool, input: { command, description } })
    if (verdict.decision === 'deny') {
      throw new GitError(argv, { exitCode: 1, stdout: '', stderr: `Claude's permissions block ${tool}: ${verdict.reason ?? 'denied'}` })
    }
    if (verdict.decision === 'ask' && !warnedAsk) {
      warnedAsk = true
      $.ui.toast(`This repo has git hooks, so JEI runs git through Claude's shell. Allow ${tool}(git *) to skip the prompt.`)
    }
    const r = tool === 'Bash' ? await $.tool.call({ tool: 'Bash', command, description }) : await $.tool.call({ tool: 'PowerShell', command, description })
    if (r.deny !== undefined) throw new GitError(argv, { exitCode: 1, stdout: '', stderr: r.deny })
    if (r.isError === true) throw new GitError(argv, { exitCode: 1, stdout: '', stderr: shellError(r.text ?? '') })
  }
}

// ---------------------------------------------------------------------------
// Actions. Each refreshes git and the Files listings when it changed anything.

function act($: EngineInterface, fn: () => Promise<unknown>): () => void {
  return () => {
    void fn().catch((err: unknown) => $.ui.log(`jei: ${reason(err)}`))
  }
}

/** Runs `fn` with `label` in the repository row, then refreshes; a second operation waits its turn. */
async function busy($: EngineInterface, label: string, fn: () => Promise<void>, refresh = true): Promise<void> {
  const held = (await readGitUi($)).busy
  if (held !== null) {
    $.ui.toast(`Still working: ${held}`)
    return
  }
  await updateGitUi($, (u) => ({ ...u, busy: label }))
  try {
    await fn()
  } finally {
    await updateGitUi($, (u) => ({ ...u, busy: null }))
    if (refresh) await refreshAfterChange($, [], true)
  }
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

/** Discard runs only from the confirm row's Discard. */
async function discardNow($: EngineInterface, paths: readonly string[]): Promise<void> {
  const g = await repoOrToast($)
  await setAsk($, null)
  if (g === null) return
  const wanted = new Set(paths)
  const entries = g.status.entries.filter((e) => wanted.has(e.path))
  await busy($, 'Discarding…', async () => {
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

/** Commits as the mode says; a sensitive file asks first unless `anyway`. */
async function commitNow($: EngineInterface, options: Options, anyway = false): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const ui = await readGitUi($)
  const message = ui.message.trim()
  if (message === '') {
    $.ui.toast('Write a commit message first.')
    return
  }
  const changed = g.status.entries.some((e) => e.index !== 'ignored' && e.worktree !== 'ignored')
  if (!changed && ui.mode !== 'amend') {
    $.ui.toast('No changes to commit.')
    return
  }
  const plan = commitPlan(snapOf(g), { message, mode: ui.mode, smartCommit: options.smartCommit })
  if (!anyway && plan.sensitive.length > 0) {
    await setAsk($, { kind: 'sensitive', paths: plan.sensitive })
    return
  }
  await setAsk($, null)
  await busy($, 'Committing…', async () => {
    try {
      await runHookAware($, g.root, plan.steps, plan.viaAgentShell)
      await updateGitUi($, (u) => ({ ...u, message: '' }))
      $.ui.toast(ui.mode === 'commit-push' ? 'Committed and pushed.' : 'Committed.')
    } catch (err) {
      const pushed = err instanceof GitError && err.argv.includes('push')
      $.ui.toast(`${pushed ? 'Push' : 'Commit'} failed: ${trimDot(failure(err))}.`)
    }
  })
}

async function syncNow($: EngineInterface, choice?: 'merge' | 'rebase'): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  await setAsk($, null)
  await busy($, 'Syncing…', async () => {
    try {
      const host = hostFor($, g.root)
      const r = await sync(host, g.root, g.status.branch, choice, (steps) => runHookAware($, g.root, steps, g.hooks))
      if (r.ok) $.ui.toast('Synced.')
      else if ('divergence' in r) await setAsk($, { kind: 'divergence' })
      else $.ui.toast(`Sync failed: ${trimDot(r.error)}.`)
    } catch (err) {
      $.ui.toast(`Sync failed: ${trimDot(failure(err))}.`)
    }
  })
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
  try {
    await initRepo(hostFor($, root), root)
  } catch (err) {
    $.ui.toast(`Can't initialize the repository: ${trimDot(failure(err))}.`)
  }
  await refreshGit($)
}

async function openDiff($: EngineInterface, row: FileRow): Promise<void> {
  await updateGitUi($, (u) => ({ ...u, diffTop: 0 }))
  await updatePane($, (s) =>
    reducePane(reducePane(s, { type: 'select', view: 'git', id: row.id }), {
      type: 'open-diff',
      path: row.entry.path,
      staged: row.group === 'staged',
      untracked: row.status === 'untracked',
    }),
  )
}

// ---------------------------------------------------------------------------
// Selection: the window is anchored to the selected row's id.

/** Selectable rows as last drawn (group headers and files) and the selection they showed. */
let lastIds: string[] = []
let lastSelected: string | undefined
let lastRows = new Map<string, FileRow>()
let focused: string | undefined
const GROUP_PREFIX = 'group-'
const isRowKey = (k: string) => k.startsWith('change-') || k.startsWith('staged-') || k.startsWith(GROUP_PREFIX)

/** The ring moved onto a Git row: it becomes the selection. */
export async function focusGit($: EngineInterface, element: string | undefined): Promise<void> {
  focused = element
  if (element === undefined || !isRowKey(element)) return
  if (currentView(await readPane($)) !== 'git') return
  await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id: element }))
}

/** Scroll keys on the Git list move the selection. True when handled. */
export async function scrollGitList($: EngineInterface, by: number): Promise<boolean> {
  if (currentView(await readPane($)) !== 'git' || lastIds.length === 0) return false
  const from = lastSelected === undefined ? -1 : lastIds.indexOf(lastSelected)
  const to = Math.max(0, Math.min(lastIds.length - 1, from < 0 ? 0 : from + Math.sign(by) * Math.max(1, Math.abs(by))))
  const id = lastIds[to]!
  await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id }))
  await $.ui.focus({ requestId: 'jei', key: id }).catch(() => undefined)
  return true
}

function selectedTarget(): { row?: FileRow; group?: Group } {
  const id = lastSelected
  if (id === undefined) return {}
  if (id === `${GROUP_PREFIX}staged`) return { group: 'staged' }
  if (id === `${GROUP_PREFIX}changes`) return { group: 'changes' }
  const row = lastRows.get(id)
  return row ? { row } : {}
}

async function keyStage($: EngineInterface): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const groups = groupsOf(g)
  const t = selectedTarget()
  if (t.group === 'changes') return stageRows($, groups.changes)
  if (t.row?.group === 'changes') return stageRows($, [t.row])
  $.ui.toast(t.row ? 'That file is already staged.' : 'Select a change first.')
}

async function keyUnstage($: EngineInterface): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const groups = groupsOf(g)
  const t = selectedTarget()
  if (t.group === 'staged') return unstageRows($, groups.staged)
  if (t.row?.group === 'staged') return unstageRows($, [t.row])
  $.ui.toast('Select a staged file first.')
}

async function keyDiscard($: EngineInterface): Promise<void> {
  const g = await repoOrToast($)
  if (g === null) return
  const groups = groupsOf(g)
  const t = selectedTarget()
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
  const Input = 'Input' in els ? els.Input : undefined
  const Select = 'Select' in els ? els.Select : undefined
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
  const buttons = (key: string, list: { key: string; label: string; run: () => void; primary?: boolean }[]) => {
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
            <Button key={b.key} variant={b.primary ? 'primary' : 'secondary'} onPress={b.run}>
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
  for (const drop of ['repo', 'sync', 'hooks', 'busy', 'shorten', 'ab']) {
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

  // The open question, pinned above the list: a muted rule, one line, its Buttons.
  const asked: RenderElement[] = []
  const ask = ui.ask
  if (ask !== null) {
    const cancel = { key: 'confirm-cancel', label: 'Cancel', run: act($, () => setAsk($, null)) }
    asked.push(line('─'.repeat(Math.max(0, inner)), { dim: true }, 'ask-rule'))
    if (ask.kind === 'discard') {
      const one = ask.paths[0] ?? ''
      const untracked = !ask.all && g.status.entries.some((x) => x.path === one && x.worktree === 'untracked')
      const q = ask.all
        ? `Discard all changes (${plural(ask.paths.length, 'file')})?`
        : `${untracked ? 'Delete the untracked file' : 'Discard changes to'} ${fitPath(baseName(one), Math.max(1, inner - 28))}?`
      asked.push(line(q, { color: color('warning') }, 'ask-text')) // destructive: the question carries the emphasis
      asked.push(...buttons('ask-buttons', [{ key: 'confirm-discard', label: 'Discard', run: act($, () => discardNow($, ask.paths)) }, cancel]))
    } else if (ask.kind === 'sensitive') {
      asked.push(line(`These files look sensitive: ${ask.paths.join(', ')}`, { color: color('warning') }, 'ask-text'))
      asked.push(
        ...buttons('ask-buttons', [
          { key: 'sensitive-commit', label: 'Commit anyway', run: act($, () => commitNow($, options, true)) },
          { ...cancel, key: 'sensitive-cancel' },
        ]),
      )
    } else {
      asked.push(line('Your branch and its upstream have diverged.', { color: color('warning') }, 'ask-text'))
      asked.push(
        ...buttons('ask-buttons', [
          { key: 'diverge-merge', label: 'Merge', run: act($, () => syncNow($, 'merge')) },
          { key: 'diverge-rebase', label: 'Rebase', run: act($, () => syncNow($, 'rebase')) },
          { key: 'diverge-ask', label: 'Ask Claude', run: act($, () => askClaude($)) },
          { ...cancel, key: 'diverge-cancel' },
        ]),
      )
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
  const modeLabel = MODES.find((m) => m.value === ui.mode)?.label ?? 'Commit'
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
  else if (groups.staged.length === 0) {
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
  const wanted = pane.selected.git
  const firstFile = selectable.find((id) => !id.startsWith(GROUP_PREFIX))
  const selected = wanted !== undefined && selectable.includes(wanted) ? wanted : (firstFile ?? selectable[0])
  lastIds = selectable
  lastSelected = selected
  lastRows = new Map(visible.map((r) => [r.id, r]))
  const inverseOf = (id: string) => id === selected && !(frame.isFocused && focused === id)

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

  for (const group of ['staged', 'changes'] as const) {
    const rows = groups[group]
    if (rows.length === 0) continue
    items.push({ id: `${GROUP_PREFIX}${group}`, isRow: true, el: groupHeader(group, rows) })
    if (ui.collapsed.includes(group)) continue
    for (const r of rows) items.push({ id: r.id, isRow: true, el: fileRow(r) })
  }

  const actions: FilesAction[] = [
    { key: 's', run: act($, () => keyStage($)) },
    { key: 'u', run: act($, () => keyUnstage($)) },
    { key: 'd', run: act($, () => keyDiscard($)) },
    { key: 'c', run: act($, () => commitNow($, options)) },
    { key: 'g', run: act($, () => generate($, options)) },
    { key: 'e', run: act($, () => syncNow($)) },
  ]

  const bodyRows = Math.max(1, frame.bodyRows)
  // A short pane keeps the question whole and drops its rule first.
  const pinned = asked.length > bodyRows - 1 ? asked.slice(1) : asked
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
