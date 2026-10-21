import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import { ActivityLog, shimmerPhase } from '../../core/activity/log.ts'
import { prepareFsOp, planFsOp, fsOpCommand, verifyFsOp, type FsOp } from '../../core/fsops.ts'
import { KEYS } from '../../core/keys.ts'
import { fitTable } from '../../core/files/csv.ts'
import { iconFor } from '../../core/files/icons.ts'
import { mentionText } from '../../core/files/mention.ts'
import { allFiles, listDir, loadPreview, openFile } from '../../core/files/service.ts'
import { filterRows, treeRows, visibleTreePath, type TreeRow } from '../../core/files/tree.ts'
import { folderStatus, type FileStatus, type StatusEntry } from '../../core/git/status.ts'
import type { DirEntry, Host } from '../../core/host.ts'
import { latest } from '../../core/latest.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { fitEnd, fitPath, padEnd } from '../../core/shared/fit.ts'
import { joinPath, parentDirs, platformOf, toPosix, projectRel } from '../../core/shared/paths.ts'
import type { JeiGit } from '../../types/index.d.ts'
import { claudeHost } from './host.ts'
import {
  bumpTick,
  readActivity,
  readCwd,
  readGit,
  readPane,
  readPreview,
  readTick,
  readTree,
  updatePane,
  updatePreview,
  updateTree,
  claimFilesPane, releaseFilesPane, filesPaneOwned, publishFilesPane, publishFilesTree,
} from './state.ts'
import { activityColor, color, statusLook } from './theme.ts'
import { refreshGit, forgetViews } from './activity.ts'

export type PaneRender = RenderInput<'Pane'>

/** What the pane gives the Files tab: the room it draws in. */
export type FilesFrame = {
  searchRows?: number
  operationsRows?: number
  /** The pane's body width. */
  columns: number
  /** Cells between the gutter (column 0) and the empty last column. */
  inner: number
  /** Rows the body may take. */
  bodyRows: number
  /** The pane holds the keyboard: the focus ring then marks the selected row. */
  isFocused: boolean
}

/** A letter key of the hint line and what pressing it does. */
export type FilesAction = { key: string; run: () => void }

export type FilesView = { header: RenderElement; body: RenderElement[]; above?: RenderElement[]; actions: FilesAction[]; scrollable?: boolean }

const ROW_PREFIX = 'row-'
const ENTRY_LIMIT = 500
const FILTER_MAX = 200
const MB = 1024 * 1024

export const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))
// A refusal from beneath reads `<plugin>: $.<noun>.<event>: <why>`: keep the why.
export const firstLine = (err: unknown) =>
  reason(err)
    .replace(/^[\w-]+: \$\.[\w.]+: /, '')
    .split(/\r?\n/)[0]!
    .trim()
    .replace(/\.+$/, '')
const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1)
const absOf = (root: string, rel: string) => (rel === '' ? toPosix(root) : joinPath(toPosix(root), rel))

export function hostFor($: EngineInterface, root: string): Host {
  return claudeHost($, platformOf(root))
}

/** A double slash alone cannot distinguish POSIX from UNC; only canonical native metadata can. */
export async function projectHost($: EngineInterface, root: string): Promise<Host> {
  if (!root.startsWith('//')) return hostFor($, root)
  const real = (await $.fs.stat(root, { resolve: true })).realPath
  if (real && (/^[a-z]:[\\/]/i.test(real) || real.startsWith('\\\\'))) return claudeHost($, 'win32')
  if (real?.startsWith('/') && !real.startsWith('//')) return claudeHost($, 'linux')
  throw new Error('Cannot determine the project path platform.')
}

// ---------------------------------------------------------------------------
// Read-through caches. Listings, the project file list and previews are not
// session state: they are re-read from disk when missing, and dropped by file
// events (activity.ts). A hot reload empties them, which only costs a re-read.

type Listing = { entries: DirEntry[]; ignored: string[]; failed: boolean }
type Preview = Awaited<ReturnType<typeof loadPreview>> & { size?: number; message?: string }

const listings = new Map<string, Promise<Listing>>()
/** Folders whose last read failed: dropped on the next toggle or refresh, never retried per frame. */
const failed = new Set<string>()
/** Only the preview on screen is kept; showPreview clears it. */
let current: { key: string; p: Promise<Preview> } | null = null
const fileLists = new Map<string, Promise<string[]>>()
const fileListEpochs = new Map<string, number>()
const at = (root: string, rel: string) => `${root}\u0000${rel}`
const guardedAllFiles = latest(allFiles)

function listingOf(host: Host, root: string, rel: string): Promise<Listing> {
  const key = at(root, rel)
  let p = listings.get(key)
  if (p === undefined) {
    p = listDir(host, root, rel).then(
      (r) => ({ ...r, failed: false }),
      () => {
        failed.add(key)
        return { entries: [], ignored: [], failed: true }
      },
    )
    listings.set(key, p)
  }
  return p
}

function filesOf(host: Host, root: string): Promise<string[]> {
  let p = fileLists.get(root)
  if (p === undefined) {
    p = allFiles(host, root).catch(err => { fileLists.delete(root); throw err })
    fileLists.set(root, p)
  }
  return p
}

function previewOf(host: Host, root: string, rel: string): Promise<Preview> {
  const key = at(root, rel)
  if (current?.key !== key) {
    const p = (async (): Promise<Preview> => {
      const loaded = await loadPreview(host, root, rel)
      if (loaded.kind !== 'too-large') return loaded
      return { ...loaded, size: (await host.stat(absOf(root, rel)))?.size ?? 0 }
    })().catch((err: unknown): Preview => ({ kind: 'error', message: firstLine(err) }))
    current = { key, p }
  }
  return current.p
}

/** Drops one listing and every listing below it. */
function forgetListing(root: string, rel: string): void {
  const key = at(root, rel)
  const below = rel === '' ? at(root, '') : `${key}/`
  for (const k of [...listings.keys()]) {
    if (k === key || k.startsWith(below)) {
      listings.delete(k)
      failed.delete(k)
    }
  }
}

/**
 * Drops what a change to these paths makes stale: the root's and every
 * ancestor folder's listing (a new folder shows in its parent), the path's own
 * listing and those below it, and its preview.
 */
export function forgetPaths(root: string, rels: readonly string[]): void {
  for (const rel of rels) {
    for (const dir of ['', ...parentDirs(rel)]) {
      listings.delete(at(root, dir))
      failed.delete(at(root, dir))
    }
    forgetListing(root, rel)
    if (current?.key === at(root, rel)) current = null
  }
}

/** Drops every listing and the preview for a root: a shell command may have changed anything. */
export function forgetAll(root: string): void {
  forgetListing(root, '')
  if (current?.key.startsWith(at(root, ''))) current = null
}

/** Drops the filter's file list; it is re-read when the filter next draws. */
export function forgetFileList(root: string): void {
  fileListEpochs.set(root, (fileListEpochs.get(root) ?? 0) + 1)
  fileLists.delete(root)
}

/** Re-reads the project file list behind the filter; only the latest call lands. */
export async function refreshFileList(host: Host, root: string): Promise<void> {
  const epoch = fileListEpochs.get(root)
  try {
    const r = await guardedAllFiles(host, root)
    if (!r.stale && fileListEpochs.get(root) === epoch) fileLists.set(root, Promise.resolve(r.value))
  } catch (err) { if (fileListEpochs.get(root) === epoch) fileLists.delete(root); throw err }
}

// ---------------------------------------------------------------------------
// Selection and scrolling. The window is anchored to the selected row's id.

let lastIds: string[] = []
let lastPreviewLines = 0
/** The element the pane's focus ring last landed on (`ui.focus`). */
let focused: string | undefined
const lastTop = new Map<string, number>()

/** First row in view so the selected one shows, with a row of context once the body has 5 rows. */
export function windowTop(mode: string, ids: readonly string[], selected: string | undefined, rows: number): number {
  const room = Math.max(1, rows)
  const ctx = room >= 5 ? 1 : 0
  let top = lastTop.get(mode) ?? 0
  const s = selected === undefined ? -1 : ids.indexOf(selected)
  if (s >= 0) {
    if (s < top + ctx) top = s - ctx
    if (s > top + room - 1 - ctx) top = s - room + 1 + ctx
  }
  top = Math.max(0, Math.min(top, ids.length - room))
  lastTop.set(mode, top)
  return top
}

/** The ring moved onto a row: it becomes the selection. */
export async function focusFiles($: EngineInterface, element: string | undefined): Promise<void> {
  const changed = focused !== element
  focused = element
  const pane = await readPane($)
  if (currentView(pane) !== 'files') return
  if ((await readTree($)).operation) { if (changed) await bumpTick($); return }
  if (element === 'filter') {
    if (!(await readTree($)).editing) await updateTree($, t => ({ ...t, editing: true }))
  } else if (element !== 'files-cancel' && element !== 'files-clear' && (await readTree($)).editing) await updateTree($, t => ({ ...t, editing: false }))
  if (element === undefined || !element.startsWith(ROW_PREFIX) || pane.selected.files === element.slice(ROW_PREFIX.length)) {
    if (changed) await bumpTick($)
    return
  }
  const id = element.slice(ROW_PREFIX.length)
  await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id }))
}

/** Scroll keys and the wheel: move the selection (tree) or the first line (preview). True when handled. */
export async function scrollFiles($: EngineInterface, by: number): Promise<boolean> {
  const view = currentView(await readPane($))
  if (view === 'files.preview') {
    const most = Math.max(0, lastPreviewLines - 1)
    await updatePreview($, (p) => ({ ...p, top: Math.max(0, Math.min(most, p.top + by)) }))
    return true
  }
  if (view !== 'files' || lastIds.length === 0) return false
  if ((await readTree($)).operation) return true
  const editing = (await readTree($)).editing
  if (editing) await updateTree($, t => ({ ...t, editing: false }))
  const sel = (await readPane($)).selected.files
  const from = sel === undefined ? -1 : lastIds.indexOf(sel)
  const to = Math.max(0, Math.min(lastIds.length - 1, from < 0 ? 0 : from + (editing ? 0 : Math.sign(by) * Math.max(1, Math.abs(by)))))
  const id = lastIds[to]!
  if (id !== sel) await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id }))
  if (focused !== `${ROW_PREFIX}${id}`) await $.ui.focus({ requestId: 'jei', key: `${ROW_PREFIX}${id}` }).catch(() => undefined)
  return true
}

// ---------------------------------------------------------------------------
// Actions.

let operationSerial = 0

export async function cancelFilesOperation($: EngineInterface): Promise<void> {
  const held = (await readTree($)).operation
  if (!held) return
  await releaseFilesPane($, held.prepared.root, held.id)
  await updateTree($, t => t.operation?.id !== held.id ? t : { ...t, operation: null, operationBusy: t.operation.working || t.operationBusy !== held.id ? t.operationBusy : null })
}

async function beginFilesOperation($: EngineInterface, kind: FsOp, root: string, source: string): Promise<void> {
  let acquired = false, installed = false
  const id = String(++operationSerial)
  try {
    if (!await claimFilesPane($, root, id)) { $.ui.toast('A Files operation is already running.'); return }
    await updateTree($, t => { acquired = t.filesRoot === root && !t.operationBusy; return acquired ? { ...t, operationBusy: id } : t })
    if (!acquired) { $.ui.toast('A Files operation is already running.'); return }
    const prepared = await prepareFsOp(await projectHost($, root), root, { kind, source })
    if (await readCwd($) !== root || currentView(await readPane($)) !== 'files' || (await readTree($)).operationBusy !== id) throw new Error('The project changed. Start again.')
    const written = await updateTree($, t => t.filesRoot === root && t.operationBusy === id ? { ...t, editing: false, operation: { id, prepared, working: false, value: kind === 'rename' ? baseName(source) : kind === 'move' ? source : '' } } : t)
    if (written.filesRoot !== root || written.operationBusy !== id || written.operation?.id !== id) throw new Error('The project changed. Start again.')
    installed = true
    if (kind !== 'delete') await $.ui.focus({ requestId: 'jei', key: 'files-operation-input' }).catch(() => {})
  } catch (error) { $.ui.toast(`Files operation failed: ${firstLine(error)}.`) }
  finally {
    if (!installed) {
      const remaining = await updateTree($, t => t.operation?.id === id && t.operation.working ? t : { ...t, operation: t.operation?.id === id ? null : t.operation, operationBusy: t.operationBusy === id ? null : t.operationBusy })
      if (remaining.operation?.id !== id || !remaining.operation.working) await releaseFilesPane($, root, id)
    }
  }
}

async function applyFilesOperation($: EngineInterface, id: string, value: string | undefined, confirmed = false): Promise<void> {
  const held = (await readTree($)).operation
  if (!held || held.id !== id || held.working || held.prepared.kind === 'delete' && !confirmed) return
  let acquired = false
  await updateTree($, t => { acquired = t.operationBusy === id && t.operation?.id === id && !t.operation.working; return acquired && t.operation ? { ...t, operation: { ...t.operation, working: true } } : t })
  if (!acquired) return
  const root = held.prepared.root
  let attempted = false, completed = false, failure = '', notice = '', selected: string | undefined
  try {
    const host = await projectHost($, root)
    const active = async () => { if (await readCwd($) !== root || !await filesPaneOwned($, root, id) || (await readTree($)).operation?.id !== id || currentView(await readPane($)) !== 'files') throw new Error('The Files operation was canceled or the project changed.') }
    await active()
    const plan = await planFsOp(host, held.prepared, value)
    const fresh = await planFsOp(host, held.prepared, value)
    if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw new Error('The destination parent has changed. Start again.')
    const command = fsOpCommand(plan, host.platform)
    await active()
    attempted = true
    // shortcut: path APIs cannot close the external-writer check/use window; directory-handle effects require a different host API.
    if (command === null) await $.fs.write(absOf(root, plan.destination!), '')
    else {
      const result = await host.run(command.argv, { cwd: root, env: command.env })
      if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || `Process exited with ${result.exitCode}.`)
    }
    const requested = await verifyFsOp(host, plan)
    completed = true
    selected = visibleTreePath(requested)
    if (selected !== requested) notice = `Operation completed: ${plan.destination === null ? plan.source : requested}. .git is hidden; showing its parent.`
    const target = selected
    await publishFilesTree($, root, id, t => ({ ...t, filter: '', filtering: false, editing: false, origin: undefined, revealed: target || undefined, expanded: [...new Set([...(plan.kind === 'new' ? t.expanded : t.expanded.filter(rel => rel !== plan.source && !rel.startsWith(plan.source + '/'))), ...parentDirs(target)])] }))
    await publishFilesPane($, root, id, p => reducePane(p, { type: 'select', view: 'files', id: target }))
  } catch (error) { failure = `Files operation failed: ${firstLine(error)}.` }
  finally {
    if (attempted) {
      forgetAll(root); forgetFileList(root); forgetViews()
      if (await readCwd($) === root) {
        try {
          await refreshGit($)
          const listing = await listingOf(await projectHost($, root), root, '')
          if (listing.failed) throw new Error('Cannot read the project folder.')
          if (completed && selected === '') {
            const tree = await readTree($)
            const first = treeRows({ root, expanded: new Set(), listings: new Map([['', listing.entries]]), ignored: new Set(listing.ignored), showHidden: tree.showHidden, status: new Map(), glow: () => 0, touched: () => false, limit: ENTRY_LIMIT })[0]
            if (first && !('more' in first)) await publishFilesPane($, root, id, pane => pane.selected.files === '' ? reducePane(pane, { type: 'select', view: 'files', id: first.rel }) : pane)
          }
        } catch (error) { failure = `${failure || (completed ? 'Operation completed.' : 'Operation attempted.')} Refresh failed: ${firstLine(error)}.` }
      }
      await bumpTick($)
    }
    await releaseFilesPane($, root, id)
    await updateTree($, t => ({ ...t, operation: t.operation?.id === id ? null : t.operation, operationBusy: t.operationBusy === id ? null : t.operationBusy }))
    if (failure) $.ui.toast(failure)
    else if (notice && await readCwd($) === root) $.ui.toast(notice)
  }
}

function act($: EngineInterface, fn: () => Promise<unknown>): () => void {
  return () => {
    void fn().catch((err: unknown) => $.ui.log(`jei: ${reason(err)}`))
  }
}

async function mention($: EngineInterface, rel: string | undefined): Promise<void> {
  if (rel === undefined || rel === '') {
    $.ui.toast('Select a file or folder first.')
    return
  }
  const r = await $.prompt.fill({ text: mentionText([rel]), mode: 'insert' })
  if (!r.isFilled) $.ui.toast("The prompt can't take a mention right now.")
}

/** Opens a file in the editor (`editorCommand` or the OS opener); a refusal or a failure toasts. */
export async function openRel($: EngineInterface, options: Options, root: string, rel: string | undefined): Promise<void> {
  if (rel === undefined) {
    $.ui.toast('Select a file or folder first.')
    return
  }
  const host = hostFor($, root)

  try {
    const refused = await openFile(host, options, absOf(root, rel))
    if (refused !== null) $.ui.toast(refused)
  } catch (err) {
    $.ui.toast(`Can't open ${baseName(rel) || rel}: ${firstLine(err)}.`)
  }
}

export async function showPreview($: EngineInterface, rel: string, line?: number): Promise<void> {
  await projectHost($, await readCwd($))
  current = null
  await updatePreview($, () => ({ rel, source: line !== undefined, top: Math.max(0, (line ?? 1) - 1), ...(line === undefined ? {} : { line }) }))
  await updatePane($, (s) => reducePane(s, { type: 'preview', rel, line }))
}

// ---------------------------------------------------------------------------
// Drawing.

type Look = { color?: string; dim: boolean; bold: boolean; inverse: boolean }

function statusMaps(g: JeiGit | null, root: string): Map<string, FileStatus> {
  const out = new Map<string, FileStatus>()
  if (g === null || g.root === null) return out
  const entries: StatusEntry[] = []
  for (const e of g.status.entries) {
    const rel = projectRel(root, joinPath(g.root, e.path))
    if (rel === null || rel === '') continue
    entries.push({ ...e, path: rel })
    const s = e.worktree !== null && e.worktree !== 'ignored' ? e.worktree : e.index
    if (s !== null && s !== 'ignored') out.set(rel, s)
  }
  for (const [dir, s] of folderStatus(entries)) out.set(dir, s)
  return out
}

function sizeText(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`
}

/**
 * The Files tab: the tree (or the filter's results) and the preview, sized to
 * the frame on every draw. Reads state and the caches, never writes state.
 */
export async function renderFiles($: EngineInterface, e: PaneRender, frame: FilesFrame, options: Options): Promise<FilesView> {
  const els = $.ui.resolve(e)
  const { Box, Text, Button, Code, Markdown } = els
  // Mobile draws no Input: the filter then shows as text.
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const root = await readCwd($)
  const pane = await readPane($)
  const view = currentView(pane)
  await readTick($) // subscribes: a bump redraws
  const inner = frame.inner
  const line = (text: string, look: Partial<Look> = {}, key?: string) => (
    <Box key={key}>
      <Text dimColor={look.dim} color={look.color} wrap="truncate-end">
        {inner > 0 ? ` ${fitEnd(text, inner)}` : ''}
      </Text>
    </Box>
  )

  if (root === '') return { header: line('Files'), body: [line('Loading…', { dim: true }, 'notice')], actions: [] }
  const host = hostFor($, root)

  const operation = view === 'files' ? (await readTree($)).operation : null
  if (operation) {
    const held = operation
    const cancel = <Button key="files-operation-cancel" plain label={frame.bodyRows < 2 ? 'Enlarge · Cancel' : 'Cancel'} onPress={act($, () => cancelFilesOperation($))} />
    if (frame.bodyRows < 3) return { header: line('Files'), body: [...(frame.bodyRows >= 2 ? [line('Enlarge the pane.', { dim: true })] : []), <Box key="files-operation-tiny">{cancel}</Box>], actions: [] }
    const title = held.prepared.kind === 'delete' ? held.prepared.sourceKind === 'dir' ? 'Delete recursively?' : 'Delete file?' : held.prepared.kind === 'new' ? 'New file or folder' : held.prepared.kind === 'rename' ? 'Rename' : 'Move to project path'
    const input = held.prepared.kind === 'delete' ? line(fitPath(held.prepared.source, inner), {}, 'files-operation-path') : Input ? <Input key="files-operation-input" value={held.value} autoFocus submitLabel={held.prepared.kind === 'new' ? 'Create' : held.prepared.kind === 'rename' ? 'Rename' : 'Move'} onInput={value => act($, () => updateTree($, t => t.operation?.id === held.id ? { ...t, operation: { ...t.operation, value } } : t))()} onSubmit={value => act($, () => applyFilesOperation($, held.id, value))()} /> : line('Enlarge on a desktop surface.', { dim: true })
    const label = held.prepared.kind === 'delete' ? 'Delete' : held.prepared.kind === 'new' ? 'Create' : held.prepared.kind === 'rename' ? 'Rename' : 'Move'
    return { header: line('Files'), body: [line(title, { color: color(held.prepared.kind === 'delete' ? 'warning' : 'fg') }, 'files-operation-title'), input, <Box key="files-operation-buttons" flexDirection="row"><Text> </Text>{held.working ? <Text dimColor>Working… · </Text> : <Box flexDirection="row"><Button key={held.prepared.kind === 'delete' ? 'files-operation-confirm' : 'files-operation-submit'} plain label={label} onPress={act($, () => applyFilesOperation($, held.id, held.prepared.kind === 'delete' ? undefined : held.value, held.prepared.kind === 'delete'))} /><Text> · </Text></Box>}{cancel}</Box>], actions: [] }
  }

  if (view === 'files.preview') {
    const held = await readPreview($)
    const target = pane.preview
    const state = target && (target.rel !== held.rel || target.line !== held.line) ? { rel: target.rel, line: target.line, source: target.line !== undefined, top: Math.max(0, (target.line ?? 1) - 1) } : held
    const rel = pane.preview?.rel ?? state.rel
    const header = (
      <Box flexDirection="row">
        <Text>{inner > 0 ? ' ' : ''}</Text>
        <Button key="preview-title" plain onPress={act($, () => updatePane($, (s) => reducePane(s, { type: 'back' })))}>
          <Text wrap="truncate-end">{fitPath(rel, inner)}</Text>
        </Button>
      </Box>
    )
    const actions: FilesAction[] = [
      { key: 'a', run: act($, () => mention($, rel)) },
      { key: 'o', run: act($, () => openRel($, options, root, rel)) },
      { key: 'm', run: act($, () => updatePreview($, (p) => ({ ...p, source: !p.source }))) },
    ]
    const rows = Math.max(1, frame.bodyRows)
    const notice = (text: string) => ({ header, body: [line(text, { dim: true }, 'notice')], actions })
    let pv: Preview
    try { pv = await previewOf(await projectHost($, root), root, rel) }
    catch (err) { return notice(firstLine(err)) }
    const sliced = (text: string) => {
      const all = text.replace(/\r?\n$/, '').split(/\r?\n/)
      lastPreviewLines = all.length
      const top = Math.max(0, Math.min(state.top, all.length - 1))
      return { top, text: all.slice(top, top + rows).join('\n') }
    }
    // One window row is one drawn row: Code cuts a long line at the edge instead of wrapping it, and the
    // box clips what Markdown wraps, so the hint line (the letter keys) never leaves a docked pane.
    const pad = (child: RenderElement) => (
      <Box key="preview" paddingLeft={1} paddingRight={1} height={rows} overflow="hidden">
        {child}
      </Box>
    )
    if (state.line !== undefined && pv.text !== undefined) {
      const s = sliced(pv.text)
      const target = Math.min(state.line, lastPreviewLines)
      return { header, body: s.text.split('\n').map((source, i) => <Box key={`preview-line-${s.top + i + 1}`} flexDirection="row"><Text color={color('accent')}>{s.top + i + 1 === target ? '›' : ' '}</Text><Code source={source} language={pv.language} path={baseName(rel)} wrap="truncate-end" /></Box>), actions, scrollable: lastPreviewLines > rows }
    }
    switch (pv.kind) {
      case 'code': {
        const s = sliced(pv.text ?? '')
        const code =
          pv.language !== undefined ? (
            <Code source={s.text} language={pv.language} startLine={inner >= 40 ? s.top + 1 : undefined} wrap="truncate-end" />
          ) : (
            <Code source={s.text} path={baseName(rel)} startLine={inner >= 40 ? s.top + 1 : undefined} wrap="truncate-end" />
          )
        return { header, body: [pad(code)], actions, scrollable: lastPreviewLines > rows }
      }
      case 'markdown': {
        const s = sliced(pv.text ?? '')
        const body = state.source ? <Code source={s.text} language="markdown" wrap="truncate-end" /> : <Markdown key="markdown" text={s.text} />
        return { header, body: [pad(body)], actions, scrollable: lastPreviewLines > rows }
      }
      case 'csv':
      case 'tsv': {
        const lines = fitTable(pv.rows ?? [], inner)
        lastPreviewLines = lines.length
        const top = Math.max(0, Math.min(state.top, lines.length - 1))
        return { header, body: lines.slice(top, top + rows).map((l, i) => line(l, {}, `table-${top + i}`)), actions, scrollable: lines.length > rows }
      }
      case 'image': {
        lastPreviewLines = 0
        const alt = `Image: ${baseName(rel)}.`
        if (e.surface === 'terminal' && /\.png$/i.test(rel) && inner > 0) {
          const { Image } = $.ui.resolve(e)
          const image = <Image source={{ file: absOf(root, rel), format: 'png' }} columns={Math.min(255, inner)} rows={Math.min(255, rows)} alt={alt} />
          return { header, body: [pad(image)], actions }
        }
        return notice('No image preview here. Press o to open it.')
      }
      case 'binary':
        return notice('Binary file. Press o to open it.')
      case 'too-large':
        return notice(`Too large to preview (${sizeText(pv.size ?? 0)}).`)
      case 'empty':
        return notice('This file is empty.')
      case 'error':
        return { header, body: [line(pv.message ? `Can't read this file: ${pv.message}.` : "Can't read this file.", { color: color('error') }, 'notice')], actions }
    }
  }

  // Tree, or the filter's results.
  const tree = await readTree($)
  const activity = await readActivity($)
  const log = ActivityLog.from(activity)
  const now = Object.keys(activity).length > 0 ? await $.clock.now() : 0
  const status = statusMaps(await readGit($), root)
  const glyphs = frame.columns >= 60 ? options.glyphs : 'plain'
  const selected = pane.selected.files

  const begin = async () => {
    await updateTree($, t => ({ ...t, editing: true, origin: t.filtering ? t.origin : pane.selected.files }))
    await $.ui.focus({ requestId: 'jei', key: 'filter' }).catch(() => {})
  }
  const change = async (value: string) => {
    await updateTree($, t => ({ ...t, filter: value, filtering: value !== '', editing: true, origin: t.filtering ? t.origin : pane.selected.files }))
    if (!value) { if (tree.origin) await updatePane($, p => reducePane(p, { type: 'select', view: 'files', id: tree.origin! })); return }
    const best = filterRows(await filesOf(host, root), value, 1)[0]
    if (best && await readCwd($) === root && currentView(await readPane($)) === 'files' && (await readTree($)).filter === value) await updatePane($, p => reducePane(p, { type: 'select', view: 'files', id: best }))
  }
  const cancel = tree.editing ? <Button key="files-cancel" plain label="Cancel" onPress={act($, async () => { await updateTree($, t => ({ ...t, editing: false })); await $.ui.focus({ requestId: 'jei', key: `row-${selected ?? ''}` }).catch(() => {}) })} /> : null
  const filterHeader = <Box key="files-search-field" flexDirection="column">
    {(frame.searchRows ?? 0) >= 3 && line('┌' + '─'.repeat(Math.max(0, inner - 2)) + '┐', { color: color('accent') })}
    <Box flexDirection="row" width={Math.max(0, frame.columns - 1)}><Text> </Text><Text color={color('accent')}>│ </Text><Box flexGrow={1}>
      {Input ? <Input key="filter" submitLabel="open" placeholder="Find files by name" value={tree.filter} autoFocus={tree.editing ? true : undefined}
        onInput={value => act($, () => change(value))()} onSubmit={value => act($, async () => { await change(value); const best = filterRows(await filesOf(host, root), value, 1)[0]; await updateTree($, t => ({ ...t, editing: false })); if (best && value && await readCwd($) === root && currentView(await readPane($)) === 'files') await showPreview($, best) })()} /> : <Text>{fitEnd(tree.filter || 'Find files by name', Math.max(0, inner - 18))}</Text>}
    </Box><Text> </Text>{cancel}{cancel && <Text> · </Text>}<Button key="files-clear" plain label="Clear" onPress={act($, () => clearFileSearch($))} /><Text color={color('accent')}> │</Text></Box>
    {(frame.searchRows ?? 0) >= 3 && line('└' + '─'.repeat(Math.max(0, inner - 2)) + '┘', { color: color('accent') })}
  </Box>
  const operationActions: FilesAction[] = KEYS.files.filter(key => ['new', 'rename', 'move', 'delete'].includes(key.action)).map(key => ({ key: key.key, run: act($, () => beginFilesOperation($, key.action as FsOp, root, selected ?? '')) }))
  const above = [...((frame.searchRows ?? 0) > 0 ? [filterHeader] : []), ...(frame.operationsRows ? [<Box key="files-operations" flexDirection="row"><Text> </Text>{operationActions.map(action => <Button key={`key-${action.key}`} plain={tree.filtering ? true : undefined} hotkey={action.key} label={tree.filtering ? '' : action.key} onPress={action.run} />)}{tree.filtering && <Button key="back" plain hotkey={KEYS.files.find(key => key.action === 'back')!.key} label="Back" onPress={act($, () => clearFileSearch($))} />}</Box>] : [])]
  const rootName = toPosix(root).replace(/\/+$/, '').split('/').pop() || 'Files'
  const header = line(rootName)
  const actions: FilesAction[] = tree.editing ? [] : [
    ...(frame.columns >= 32 ? operationActions : []),
    { key: 's', run: act($, begin) },
    { key: 'a', run: act($, () => mention($, selected)) },
    { key: 'o', run: act($, () => openRel($, options, root, selected)) },
    { key: 'f', run: act($, begin) },
    { key: 'h', run: act($, () => updateTree($, (t) => ({ ...t, showHidden: !t.showHidden, revealed: undefined }))) },
  ]

  type Item = { id: string; isRow: boolean; el: RenderElement }
  const items: Item[] = []
  const step = inner < 32 ? 1 : 2
  const maxIndent = Math.floor(inner / 4)

  const statusW = (rels: readonly string[]) => (rels.some((r) => status.has(r)) ? 1 : 0)
  const rowEl = (rel: string, label: string, opts: { isDir: boolean; depth: number; isExpanded: boolean; sw: number }) => {
    const gap = opts.sw > 0 ? (inner >= 60 ? 2 : 1) : 0
    const room = Math.max(0, inner - gap - opts.sw)
    const indent = ' '.repeat(Math.min(opts.depth * step, maxIndent))
    const icon = iconFor(baseName(rel), opts.isDir, opts.isExpanded, glyphs)
    const nameRoom = room - indent.length - 2
    const left = nameRoom >= 1 ? `${indent}${icon} ${fitPath(label, nameRoom)}` : fitEnd(`${indent}${icon} ${label}`, room)
    const s = status.get(rel)
    const look = s === undefined ? undefined : statusLook(s)
    const kind = log.kindOf(rel)
    const phase = shimmerPhase(log.glow(rel, now))
    const isSel = rel === selected
    // The focus ring marks the row it is on; any other selected row is inverted.
    const inverse = isSel && !(frame.isFocused && focused === `${ROW_PREFIX}${rel}`)
    const nameLook: Look =
      phase !== 'none' && !isSel && kind !== null
        ? { color: activityColor(kind), dim: phase === 'dim', bold: phase === 'bold', inverse }
        : { dim: opts.isDir, bold: false, inverse }
    const mark = phase !== 'none' ? 'glow' : log.touched(rel) ? 'mark' : 'gut'
    const markLook: Look | null =
      kind === null || mark === 'gut' ? null : { color: activityColor(kind), dim: mark === 'mark' || phase === 'dim', bold: phase === 'bold', inverse: false }
    return (
      <Box key={`line-${rel}`} flexDirection="row">
        <Box key={`${mark}-${rel}`}>
          <Text color={markLook?.color} dimColor={markLook?.dim} weight={markLook?.bold ? 'bold' : undefined}>
            {inner > 0 ? (markLook ? '•' : ' ') : ''}
          </Text>
        </Box>
        <Button key={`${ROW_PREFIX}${rel}`} plain onPress={act($, () => press(rel, opts.isDir))}>
          <Text color={nameLook.color} dimColor={nameLook.dim} weight={nameLook.bold ? 'bold' : undefined} inverse={nameLook.inverse}>
            {padEnd(left, room)}
          </Text>
          {opts.sw > 0 && (
            <Text color={look?.color} dimColor={look?.dim} weight={look?.bold ? 'bold' : undefined} inverse={inverse}>
              {`${' '.repeat(gap)}${look?.letter || ' '}`}
            </Text>
          )}
        </Button>
      </Box>
    )
  }
  const press = async (rel: string, isDir: boolean) => {
    if (!isDir) return showPreview($, rel)
    if (failed.has(at(root, rel))) forgetListing(root, rel)
    await updateTree($, (t) => ({ ...t, expanded: t.expanded.includes(rel) ? t.expanded.filter((x) => x !== rel) : [...t.expanded, rel] }))
    await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id: rel }))
  }

  let mode = 'tree'
  if (tree.filtering && tree.filter !== '') {
    mode = 'filter'
    let files: string[]
    try { files = await filesOf(host, root) }
    catch (err) { return { header, above, body: [line(firstLine(err), { color: color('error') }, 'notice')], actions } }
    const hits = filterRows(files, tree.filter, FILTER_MAX)
    const sw = statusW(hits)
    for (const rel of hits) items.push({ id: rel, isRow: true, el: rowEl(rel, rel, { isDir: false, depth: 0, isExpanded: false, sw }) })
    if (hits.length === 0) items.push({ id: 'empty', isRow: false, el: line(`No files match "${tree.filter}".`, { dim: true }, 'notice') })
  } else {
    const expanded = new Set(tree.expanded)
    const lmap = new Map<string, DirEntry[]>()
    const ignored = new Set<string>()
    const unreadable = new Set<string>()
    const walk = async (rel: string): Promise<void> => {
      const l = await listingOf(host, root, rel)
      lmap.set(rel, l.entries)
      for (const i of l.ignored) ignored.add(i)
      if (l.failed) unreadable.add(rel)
      await Promise.all(
        l.entries.filter((x) => x.kind === 'dir' && expanded.has(joinPath(rel, x.name))).map((x) => walk(joinPath(rel, x.name))),
      )
    }
    await walk('')
    const rows: TreeRow[] = treeRows({
      root,
      expanded,
      listings: lmap,
      ignored,
      showHidden: tree.showHidden,
      status,
      glow: (rel) => log.glow(rel, now),
      touched: (rel) => log.touched(rel),
      limit: ENTRY_LIMIT,
      revealed: tree.filesRoot === root && tree.revealed === selected ? tree.revealed : undefined,
    })
    const sw = statusW(rows.map((r) => r.rel))
    rows.forEach((r, i) => {
      if ('more' in r) {
        const indent = ' '.repeat(Math.min(r.depth * step, maxIndent))
        items.push({ id: r.rel, isRow: false, el: line(`${indent}${r.more} more`, { dim: true }, `more-${r.rel}`) })
        return
      }
      items.push({ id: r.rel, isRow: true, el: rowEl(r.rel, r.name, { isDir: r.isDir, depth: r.depth, isExpanded: r.isExpanded, sw }) })
      const next = rows[i + 1]
      if (r.isDir && r.isExpanded && (next === undefined || next.depth <= r.depth)) {
        const indent = ' '.repeat(Math.min((r.depth + 1) * step, maxIndent))
        const el = unreadable.has(r.rel)
          ? line(`${indent}Can't read this folder.`, { color: color('error') }, `empty-${r.rel}`)
          : line(`${indent}This folder is empty.`, { dim: true }, `empty-${r.rel}`)
        items.push({ id: `${r.rel}/`, isRow: false, el })
      }
    })
    if (rows.length === 0) {
      items.push({ id: 'empty', isRow: false, el: unreadable.has('') ? line("Can't read this folder.", { color: color('error') }, 'notice') : line('This folder is empty.', { dim: true }, 'notice') })
    }
  }

  const ids = items.map((i) => i.id)
  lastIds = items.filter((i) => i.isRow).map((i) => i.id)
  const rows = Math.max(0, frame.bodyRows)
  const top = windowTop(mode, ids, selected, rows)
  return { header, above, body: items.slice(top, top + rows).map((i) => i.el), actions, scrollable: items.length > rows }
}

export async function clearFileSearch($: EngineInterface): Promise<void> {
  const tree = await readTree($)
  await updateTree($, t => ({ ...t, filter: '', filtering: false, editing: false, origin: undefined }))
  if (tree.origin) await updatePane($, p => reducePane(p, { type: 'select', view: 'files', id: tree.origin! }))
  await $.ui.focus({ requestId: 'jei', key: `row-${tree.origin ?? (await readPane($)).selected.files ?? ''}` }).catch(() => {})
}
