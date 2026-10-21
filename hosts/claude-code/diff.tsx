import type { EngineInterface, RenderElement } from 'claude-code'
import { diffWindow, reviewText, toUnifiedText, type DiffFile } from '../../core/git/diff.ts'
import { DIFF_MAX_LINES, fileDiff, commitDiff, compareDiff, commitFiles, compare } from '../../core/git/service.ts'
import { logArgs, parseLog } from '../../core/git/log.ts'
import { git } from '../../core/git/run.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane, type PaneState } from '../../core/pane.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import { toPosix } from '../../core/shared/paths.ts'
import { onRefresh } from './activity.ts'
import { firstLine, hostFor, openRel, reason, type FilesAction, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { groupRows, type Repo } from './git.tsx'
import { readGit, readGitUi, readPane, readTick, updateGitUi, updatePane } from './state.ts'
import { color } from './theme.ts'

const MINUS = '−'
const REVIEW_MAX = 8000

type Loaded = { file: DiffFile | null; truncated: boolean; label?: string } | { error: string }
type Target = NonNullable<PaneState['diff']>

// The diff on screen, read once per file and dropped by every refresh (activity.ts).
let current: { key: string; p: Promise<Loaded> } | null = null
onRefresh(() => {
  current = null
})

function diffOf($: EngineInterface, root: string, d: Target): Promise<Loaded> {
  const source = d.source
  const key = `${root}\u0000${d.path}\u0000${JSON.stringify(source)}`
  if (current?.key !== key) {
    const host = hostFor($, root)
    const load = async (): Promise<Loaded> => {
      if (source.kind === 'working') return fileDiff(host, root, d.path, source)
      if (source.kind === 'compare') return { ...await compareDiff(host, root, source.base, source.head, d.path), label: `${source.base.slice(0, 7)}...${source.head.slice(0, 7)}` }
      const result = await commitDiff(host, root, source.hash, d.path)
      const commit = parseLog((await git(host, root, logArgs({ branch: source.hash }, 0))).stdout)[0]
      return { ...result, label: `${source.hash.slice(0, 7)} ${commit?.subject ?? ''}`.trim() }
    }
    const p = load().catch(
      (err: unknown): Loaded => ({ error: firstLine(err) }),
    )
    current = { key, p }
  }
  return current.p
}

/** What the last drawing showed: the file's row count and its hunk header rows. */
let lastTotal = 0
/** Rows the last window showed. */
let lastRows = 1
let lastStarts: number[] = []

/** Scroll keys and the wheel in the diff view move its first row. True when handled. */
export async function scrollDiff($: EngineInterface, by: number): Promise<boolean> {
  if (currentView(await readPane($)) !== 'git.diff') return false
  const most = Math.max(0, lastTotal - lastRows)
  await updateGitUi($, (u) => ({ ...u, diffTop: Math.max(0, Math.min(most, u.diffTop + by)) }))
  return true
}

function act($: EngineInterface, fn: () => Promise<unknown>): () => void {
  return () => {
    void fn().catch((err: unknown) => $.ui.log(`jei: ${reason(err)}`))
  }
}

async function jumpHunk($: EngineInterface, forward: boolean): Promise<void> {
  const top = (await readGitUi($)).diffTop
  const to = forward ? lastStarts.find((s) => s > top) : [...lastStarts].reverse().find((s) => s < top)
  if (to === undefined) return
  await updateGitUi($, (u) => ({ ...u, diffTop: to }))
}

/** `j`/`k`: the next or previous file of the same group, in the order the Git tab draws them. */
async function stepFile($: EngineInterface, by: 1 | -1): Promise<void> {
  const pane = await readPane($)
  const g = await readGit($)
  const d = pane.diff
  if (d === undefined || g === null || g.root === null) return
  const source = d.source
  if (source.kind !== 'working') {
    const host = hostFor($, g.root)
    const files = source.kind === 'commit' ? await commitFiles(host, g.root, source.hash) : await compare(host, g.root, source.base, source.head)
    const next = files[files.findIndex((file) => file.path === d.path) + by]
    if (!next) { $.ui.toast(by > 0 ? 'This is the last file.' : 'This is the first file.'); return }
    const view = source.kind === 'commit' ? 'git' : 'git.compare'
    const id = source.kind === 'commit' ? `commit-file-${source.hash}-${next.path}` : `compare-file-${next.path}`
    await updateGitUi($, (u) => ({ ...u, diffTop: 0 }))
    await updatePane($, (s) => reducePane(reducePane(s, { type: 'select', view, id }), { type: 'open-diff', path: next.path, source }))
    return
  }
  const rows = groupRows(g as Repo, source.staged)
  const at = rows.findIndex((r) => r.entry.path === d.path)
  const next = rows[at + by]
  if (next === undefined) {
    $.ui.toast(by > 0 ? 'This is the last file.' : 'This is the first file.')
    return
  }
  await updateGitUi($, (u) => ({ ...u, diffTop: 0 }))
  await updatePane($, (s) =>
    reducePane(reducePane(s, { type: 'select', view: 'git', id: next.id }), {
      type: 'open-diff',
      path: next.entry.path,
      source: { kind: 'working', staged: source.staged, untracked: next.status === 'untracked' },
    }),
  )
}

async function review($: EngineInterface, path: string, file: DiffFile | null): Promise<void> {
  if (file === null || file.hunks.length === 0) {
    $.ui.toast('There is no diff to review.')
    return
  }
  const r = await $.prompt.fill({ text: reviewText(path, toUnifiedText(file), REVIEW_MAX), mode: 'insert' })
  if (!r.isFilled) $.ui.toast("The prompt can't take the request right now.")
}

/**
 * The diff view: the header (file, source, +/−, pressing it goes back), then
 * the file's hunks as `Code format="diff"` in a window of the body's rows that
 * starts at `gitUi.diffTop`. Reads state, never writes it.
 */
export async function renderDiff($: EngineInterface, e: PaneRender, frame: FilesFrame, options: Options): Promise<FilesView> {
  const { Box, Text, Button, Code } = $.ui.resolve(e)
  const pane = await readPane($)
  const g = await readGit($)
  const ui = await readGitUi($)
  await readTick($) // subscribes: a refresh redraws
  const inner = frame.inner
  const line = (text: string, look: { color?: string; dim?: boolean } = {}, key?: string) => (
    <Box key={key}>
      <Text dimColor={look.dim} color={look.color} wrap="truncate-end">
        {inner > 0 ? ` ${fitEnd(text, inner)}` : ''}
      </Text>
    </Box>
  )
  const back = act($, () => updatePane($, (s) => reducePane(s, { type: 'back' })))
  const d = pane.diff
  if (d === undefined || g === null || g.root === null) {
    const header = (
      <Box flexDirection="row">
        <Text>{inner > 0 ? ' ' : ''}</Text>
        <Button key="diff-title" plain onPress={back} label={fitEnd('Git', inner)} />
      </Box>
    )
    return { header, body: [line('No diff to show.', { dim: true }, 'notice')], actions: [] }
  }
  const root = g.root
  const loaded = await diffOf($, root, d)
  const file = 'error' in loaded ? null : loaded.file

  // Header: the path (never dropped), then +/−, then the source while they fit.
  const source = d.source.kind === 'working' ? d.source.staged ? 'staged' : d.source.untracked ? 'untracked' : 'working tree' : 'error' in loaded ? d.source.kind : loaded.label ?? d.source.kind
  const plus = file ? `+${file.added}` : ''
  const minus = file ? `${MINUS}${file.removed}` : ''
  const countsW = file ? cellWidth(plus) + 1 + cellWidth(minus) : 0
  let showCounts = countsW > 0
  let showSource = true
  const pathRoom = () => inner - (showCounts ? 2 + countsW : 0) - (showSource ? 3 + cellWidth(source) : 0)
  if (pathRoom() < Math.min(cellWidth(d.path), 12)) showSource = false
  if (pathRoom() < Math.min(cellWidth(d.path), 8)) showCounts = false
  const header = (
    <Box flexDirection="row">
      <Text>{inner > 0 ? ' ' : ''}</Text>
      <Button key="diff-title" plain onPress={back}>
        <Text>{d.source.kind === 'working' ? fitPath(d.path, Math.max(0, pathRoom())) : fitEnd(source, inner)}</Text>
        {d.source.kind === 'working' && showSource && <Text dimColor>{` · ${source}`}</Text>}
        {d.source.kind === 'working' && showCounts && <Text color={color('added')}>{`  ${plus}`}</Text>}
        {d.source.kind === 'working' && showCounts && <Text color={color('removed')}>{` ${minus}`}</Text>}
      </Button>
    </Box>
  )

  const actions: FilesAction[] = [
    { key: 'n', run: act($, () => jumpHunk($, true)) },
    { key: 'p', run: act($, () => jumpHunk($, false)) },
    { key: 'j', run: act($, () => stepFile($, 1)) },
    { key: 'k', run: act($, () => stepFile($, -1)) },
    { key: 'a', run: act($, () => review($, d.path, file)) },
    { key: 'o', run: act($, () => openRel($, options, toPosix(root), d.path)) },
  ]

  if ('error' in loaded) {
    lastTotal = 0
    lastStarts = []
    return { header, body: [line(`Can't show this diff: ${loaded.error}.`, { color: color('error') }, 'notice')], actions }
  }
  if (file === null || (!file.binary && file.hunks.length === 0)) {
    lastTotal = 0
    lastStarts = []
    return { header, body: [line('No changes.', { dim: true }, 'notice')], actions }
  }
  if (file.binary) {
    lastTotal = 0
    lastStarts = []
    return { header, body: [line('Binary file. Press o to open it.', { dim: true }, 'notice')], actions }
  }
  const body: RenderElement[] = []
  if (d.source.kind !== 'working') body.push(line(d.path, {}, 'diff-path'))
  if (loaded.truncated) body.push(line(`Diff truncated at ${DIFF_MAX_LINES.toLocaleString('en-US')} lines.`, { color: color('warning') }, 'truncated'))
  const rows = Math.max(1, frame.bodyRows - body.length)
  const w = diffWindow(file, ui.diffTop, rows)
  lastTotal = w.total
  lastRows = rows
  lastStarts = w.hunkStarts
  body.push(
    // One window row is one drawn row: a long line is cut at the edge, so the hint line stays in the pane.
    <Box key="diff" paddingLeft={1} paddingRight={1} height={rows} overflow="hidden">
      <Code source={w.text} format="diff" path={d.path} wrap="truncate-end" />
    </Box>,
  )
  return { header, body, actions, scrollable: w.total > rows }
}
