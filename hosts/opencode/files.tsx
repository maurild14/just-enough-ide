import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import { SyntaxStyle, parseColor, RGBA, type CodeRenderable } from '@opentui/core'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import type { ActivityLog } from '../../core/activity/log.ts'
import { fitTable } from '../../core/files/csv.ts'
import { iconFor } from '../../core/files/icons.ts'
import { mentionText } from '../../core/files/mention.ts'
import type { loadPreview } from '../../core/files/service.ts'
import { filterRows, reveal, treeRows } from '../../core/files/tree.ts'
import { folderStatus, type FileStatus, type StatusEntry } from '../../core/git/status.ts'
import type { DirEntry } from '../../core/host.ts'
import { latest } from '../../core/latest.ts'
import type { Options } from '../../core/options.ts'
import { currentView, type PaneAction, type PaneState } from '../../core/pane.ts'
import { cellWidth, fitEnd, fitPath, padEnd } from '../../core/shared/fit.ts'
import { insideRel, nativeRel, joinPath, toPosix } from '../../core/shared/paths.ts'
import { activityColor } from './colors.ts'
import { handToAgent } from './hand-off.ts'
import type { JeiRpc } from './rpc.ts'
import { Search } from './search.tsx'

type Preview = Awaited<ReturnType<typeof loadPreview>>
type Listing = { entries: DirEntry[]; ignored: string[]; failed?: boolean }
const STATUS: Record<FileStatus, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: 'C', ignored: '' }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Files reply.')
  return value as Record<string, unknown>
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((s): s is string => typeof s === 'string')) throw new Error('Invalid Files reply.')
  return value
}

function readListing(value: unknown): Listing {
  const data = record(value)
  if (!Array.isArray(data.entries)) throw new Error('Invalid Files reply.')
  const entries = data.entries.map((raw): DirEntry => {
    const e = record(raw)
    if (typeof e.name !== 'string' || !e.name || /[/\\\x00-\x1f]/.test(e.name) || e.name === '.' || e.name === '..' ||
      (e.kind !== 'file' && e.kind !== 'dir' && e.kind !== 'other') || typeof e.size !== 'number' || !Number.isFinite(e.size) || e.size < 0) throw new Error('Invalid Files reply.')
    return { name: e.name, kind: e.kind, size: e.size }
  })
  return { entries, ignored: strings(data.ignored) }
}

function readPreview(value: unknown): Preview {
  const data = record(value)
  switch (data.kind) {
    case 'code': case 'markdown':
      if (typeof data.text !== 'string' || (data.language !== undefined && typeof data.language !== 'string')) throw new Error('Invalid Files reply.')
      return { kind: data.kind, text: data.text, language: data.language as string | undefined }
    case 'csv': case 'tsv':
      if (!Array.isArray(data.rows)) throw new Error('Invalid Files reply.')
      if (data.text !== undefined && typeof data.text !== 'string') throw new Error('Invalid Files reply.')
      return { kind: data.kind, rows: data.rows.slice(0, 200).map(strings), text: data.text as string | undefined }
    case 'image': case 'binary': case 'too-large': case 'empty': case 'error': return { kind: data.kind }
    default: throw new Error('Invalid Files reply.')
  }
}

export function Files(props: {
  ctx: Plugin.Context; api: RpcClient<typeof JeiRpc>; sessionID: string; cwd: string; options: Options; git: Record<string, unknown>
  state: PaneState; dispatch: (action: PaneAction) => void; activity: ActivityLog; now: number; revision: number
  quickCacheScopes: Set<string>; refresh: () => Promise<void>
  width: number; height: number; header: boolean; focused: boolean; bind: (run: (action: string) => void, editing: () => boolean) => void
}) {
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [hidden, setHidden] = createSignal(false)
  const [filtering, setFiltering] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [listings, setListings] = createSignal(new Map<string, Listing>())
  const [files, setFiles] = createSignal<string[]>([])
  const [filesError, setFilesError] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)
  const [preview, setPreview] = createSignal<Preview>()
  const [previewRel, setPreviewRel] = createSignal('')
  const [top, setTop] = createSignal(0)
  const [searchEditing, setSearchEditing] = createSignal<() => boolean>(() => false)
  let searchAction: (action: string) => void = () => {}
  let treeTop = 0
  let previewTarget: { rel: string; line: number } | undefined
  let stopped = false
  let code: CodeRenderable | undefined
  const cache = new Map<string, Promise<Listing>>()
  const cwd = createMemo(() => props.cwd)
  const selected = () => props.state.selected.files
  const isPreview = () => currentView(props.state) === 'files.preview'
  const relOf = (path: string) => insideRel(cwd(), path)
  const searching = () => ['search', 'quickopen', 'search.replace'].includes(currentView(props.state))
  const editing = () => !isPreview() && (filtering() && !searching() || searchEditing()())
  const searchRows = () => isPreview() || searching() || filtering() && props.height < 4 ? 0 : props.height >= 6 ? 3 : Math.min(1, Math.max(0, props.height - 1))
  const inner = () => Math.max(0, props.width - 2)
  const room = () => Math.max(0, props.height - searchRows() - (props.header || filtering() ? 1 : 0))
  const theme = () => props.ctx.theme
  const syntax = createMemo(() => SyntaxStyle.fromStyles(Object.fromEntries(Object.entries(theme().syntax ?? {}).map(([name, fg]) => [name, { fg: fg as RGBA }]))))
  createEffect(() => { const style = syntax(); onCleanup(() => style.destroy()) })
  onCleanup(() => { stopped = true; props.bind(() => {}, () => false) })

  createEffect(() => {
    const rel = selected()
    if (rel !== undefined) untrack(() => {
      const safe = relOf(rel)
      if (safe === null || !safe) return
      if (safe !== rel) props.dispatch({ type: 'select', view: 'files', id: safe })
      const next = reveal(expanded(), safe)
      if (next.size !== expanded().size) setExpanded(next)
    })
  })
  createEffect(() => { cwd(); props.revision; cache.clear() })
  const loadTree = latest(async (dirs: readonly string[]) => new Map(await Promise.all(dirs.map(async (rel) => {
    let promise = cache.get(rel)
    if (!promise) {
      promise = props.api.listDir({ rel }).then(readListing).catch((): Listing => ({ entries: [], ignored: [], failed: true }))
      cache.set(rel, promise)
    }
    return [rel, await promise] as const
  }))))
  createEffect(() => {
    cwd(); props.revision
    const dirs = ['', ...expanded()]
    void loadTree(dirs).then((r) => { if (!stopped && !r.stale) { setListings(r.value); setLoaded(true) } })
  })
  const loadFiles = latest(async () => strings(record(await props.api.allFiles({})).files).map(relOf).filter((p): p is string => p !== null && p !== '' && !p.split('/').includes('.git')))
  createEffect(() => {
    cwd(); props.revision
    if (!filtering()) return
    setFilesError(false)
    void loadFiles().then((r) => { if (!stopped && !r.stale) setFiles(r.value) }).catch(() => {
      if (!stopped) { setFiles([]); setFilesError(true) }
    })
  })
  const load = latest(async (rel: string | undefined) => rel === undefined ? undefined : readPreview(await props.api.preview({ rel })))
  const previewPath = createMemo(() => isPreview() ? props.state.preview?.rel || previewRel() || selected() : undefined)
  const targetLine = () => isPreview() ? props.state.preview?.line : undefined
  const source = createMemo(() => preview()?.text?.split('\n') ?? [])
  const markedLine = () => targetLine() === undefined ? undefined : Math.max(1, Math.min(source().length, targetLine()!))
  createEffect(() => {
    const rel = previewPath(), line = targetLine()
    if (!rel || line === undefined) { previewTarget = undefined; return }
    if (preview()?.text !== undefined && (previewTarget?.rel !== rel || previewTarget.line !== line)) { previewTarget = { rel, line }; setTop(markedLine()! - 1) }
  })
  createEffect(() => {
    cwd(); props.revision
    const rel = previewPath()
    setPreview(undefined)
    void load(rel).then((r) => { if (!stopped && !r.stale) setPreview(r.value) }).catch(() => { if (!stopped) setPreview({ kind: 'error' }) })
  })
  const status = createMemo(() => {
    const result = new Map<string, FileStatus>()
    if (typeof props.git.root !== 'string') return result
    const rawStatus = props.git.status
    if (!rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)) return result
    const raw = (rawStatus as Record<string, unknown>).entries
    if (!Array.isArray(raw)) return result
    const entries: StatusEntry[] = []
    for (const value of raw) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const e = record(value)
      if (typeof e.path !== 'string') continue
      const path = relOf(joinPath(props.git.root, e.path))
      const valid = (s: unknown): s is FileStatus => typeof s === 'string' && Object.hasOwn(STATUS, s)
      if (path === null || !path) continue
      const index = valid(e.index) ? e.index : null
      const worktree = valid(e.worktree) ? e.worktree : null
      entries.push({ path, index, worktree })
      const s = worktree && worktree !== 'ignored' ? worktree : index
      if (s) result.set(path, s)
    }
    for (const [dir, s] of folderStatus(entries)) result.set(dir, s)
    return result
  })
  const rows = createMemo(() => {
    if (filtering() && query()) return filterRows(files().filter((p) => hidden() || !p.split('/').some((s) => s.startsWith('.'))), query(), 200).map((rel) => ({ rel, name: rel, depth: 0, isDir: false, isExpanded: false, status: status().get(rel) ?? null, glow: props.activity.glow(rel, props.now), touched: props.activity.touched(rel) }))
    return treeRows({ root: props.cwd, expanded: expanded(), listings: new Map([...listings()].map(([rel, l]) => [rel, l.entries])), ignored: new Set([...listings().values()].flatMap((l) => l.ignored)), showHidden: hidden(), status: status(), glow: (rel) => props.activity.glow(rel, props.now), touched: (rel) => props.activity.touched(rel), limit: 500 })
  })
  const items = createMemo(() => {
    const result: { rel: string; label: string; row?: ReturnType<typeof treeRows>[number] }[] = []
    if (filtering() && filesError()) return [{ rel: '', label: "Can't list project files." }]
    if (!loaded()) return [{ rel: '', label: 'Loading…' }]
    const flattened = rows()
    for (const [index, row] of flattened.entries()) {
      result.push({ rel: row.rel, label: 'more' in row ? `${row.more} more` : row.name, row })
      if ('isDir' in row && row.isDir && row.isExpanded && (flattened[index + 1]?.depth ?? -1) <= row.depth) {
        result.push({ rel: row.rel + '/', label: listings().get(row.rel)?.failed ? "Can't read this folder." : 'This folder is empty.' })
      }
    }
    if (!result.length) result.push({ rel: '', label: filtering() && query() ? `No files match "${query()}".` : listings().get('')?.failed ? "Can't read this folder." : 'This folder is empty.' })
    return result
  })
  createEffect(() => {
    const available = rows().filter((r) => !('more' in r))
    if (available.length && (!selected() || (filtering() && query() && !available.some((r) => r.rel === selected())))) props.dispatch({ type: 'select', view: 'files', id: available[0]!.rel })
  })
  const window = createMemo(() => {
    const all = items(); const index = all.findIndex((r) => r.rel === selected()); const context = room() >= 5 ? 1 : 0
    if (index >= 0) treeTop = Math.min(Math.max(treeTop, index - room() + 1 + context), index - context)
    treeTop = Math.max(0, Math.min(treeTop, all.length - room()))
    return all.slice(treeTop, treeTop + room())
  })
  async function run(action: string) {
    const path = previewPath() || ''
    const rel = isPreview() ? path && !path.includes('\0') && nativeRel('', path, 'linux') === path ? path : null : relOf(selected() || '')
    switch (action) {
      case 'back':
        if (isPreview()) props.dispatch({ type: 'back' })
        else if (filtering()) { setFiltering(false); setQuery('') }
        return
      case 'move-up': case 'move-down': {
        const all = rows().filter((r) => !('more' in r)); const from = all.findIndex((r) => r.rel === selected())
        const next = all[Math.max(0, Math.min(all.length - 1, from + (action === 'move-up' ? -1 : 1)))]
        if (next) props.dispatch({ type: 'select', view: 'files', id: next.rel })
        return
      }
      case 'activate': {
        if (!rel) return
        const row = rows().find((r) => r.rel === rel)
        if (filtering() && (filesError() || query() && !row)) return
        if (row && 'isDir' in row && row.isDir) {
          const next = new Set(expanded())
          if (next.has(rel)) next.delete(rel)
          else { next.add(rel); if (listings().get(rel)?.failed) cache.delete(rel) }
          setExpanded(next)
        } else { setPreviewRel(rel); setTop(0); props.dispatch({ type: 'preview', rel }) }
        return
      }
      case 'filter': setFiltering(!filtering()); if (!filtering()) setQuery(''); return
      case 'toggle-hidden': setHidden(!hidden()); return
      case 'scroll-up': case 'scroll-down': {
        const by = action === 'scroll-up' ? -1 : 1
        if (targetLine() !== undefined) setTop(n => Math.max(0, Math.min(Math.max(0, source().length - 1), n + by)))
        else if (code && !code.isDestroyed && (preview()?.kind === 'code' || preview()?.kind === 'markdown')) { code.scrollY += by; setTop(code.scrollY) }
        else setTop((n) => Math.max(0, Math.min(Math.max(0, table().length - room()), n + by)))
        return
      }
      case 'mention': if (rel) await handToAgent(props.ctx, props.sessionID, mentionText([rel])); return
      case 'open-editor': {
        if (!rel) return
        const reply = await props.api.open({ rel, ...(targetLine() ? { line: targetLine() } : {}) }) as { refused?: unknown }
        if (typeof reply?.refused === 'string' && !stopped) props.ctx.ui.toast.show({ message: reply.refused, variant: 'warning' })
        return
      }
      // OpenCode always displays Markdown source, so the shared source action is already satisfied.
      case 'toggle-markdown-source': return
    }
  }
  const invoke = (action: string) => {
    if (!isPreview() && (searching() || action === 'search' || searchEditing()() && !['move-up', 'move-down'].includes(action))) { searchAction(action === 'search' && !searching() ? 'edit' : action === 'activate' && searchEditing()() ? 'submit' : action); return }
    if (!isPreview() && searchEditing()()) searchAction('blur')
    void run(action).catch(() => props.ctx.ui.toast.show({ message: 'Unable to complete Files action.', variant: 'error' }))
  }
  props.bind(invoke, editing)
  const table = createMemo(() => fitTable(preview()?.rows ?? [], inner()))
  const notice = () => {
    switch (preview()?.kind) {
      case undefined: return 'Loading…'
      case 'image': return 'Image preview is not available in OpenCode.'
      case 'binary': return 'Binary file — no preview.'
      case 'too-large': return 'Too large to preview.'
      case 'empty': return 'This file is empty.'
      case 'error': return "Can't read this file."
      default: return ''
    }
  }
  const statusSuffix = (item: ReturnType<typeof items>[number]) => item.row && 'status' in item.row && item.row.status ? ` ${STATUS[item.row.status]}` : ''
  function statusColor(item: ReturnType<typeof items>[number]) {
    const status = item.row && 'status' in item.row ? item.row.status : null
    const kind = status === 'added' || status === 'untracked' ? 'success' : status === 'deleted' ? 'error' : status === 'conflicted' ? 'info' : 'warning'
    return theme().text.feedback[kind].base
  }
  function rowText(item: ReturnType<typeof items>[number]) {
    const row = item.row
    if (!row || 'more' in row) return fitEnd(item.label, inner())
    const indent = ' '.repeat(Math.min(row.depth * (props.width < 32 ? 1 : 2), Math.floor(props.width / 4)))
    const icon = iconFor(row.name, row.isDir, row.isExpanded, props.width >= 60 ? props.options.glyphs : 'plain')
    const tail = statusSuffix(item)
    const left = `${indent}${icon} ${fitPath(item.label, inner() - cellWidth(indent) - 2 - cellWidth(tail))}`
    return padEnd(fitEnd(left, inner() - cellWidth(tail)), inner() - cellWidth(tail))
  }
  const color = (rel: string, marker = false) => {
    const kind = props.activity.kindOf(rel)
    if (!kind || (!marker && (rel === selected() || !props.activity.glow(rel, props.now)))) return theme().text.base
    const accent = parseColor(activityColor(props.ctx, kind)); const fg = parseColor(theme().text.base)
    const glow = props.activity.glow(rel, props.now)
    const weight = marker && !glow ? 1 : Math.ceil(glow * 8) / 8
    return RGBA.fromValues(fg.r + (accent.r - fg.r) * weight, fg.g + (accent.g - fg.g) * weight, fg.b + (accent.b - fg.b) * weight)
  }
  return <box flexDirection="column" flexGrow={1} minHeight={0}>
    <Show when={!isPreview() && (searching() || searchRows() > 0)}><Search {...props} height={searching() ? props.height : searchRows()} bind={(run, isEditing) => { searchAction = run; setSearchEditing(() => isEditing) }} /></Show>
    <Show when={!searching()}>
    <Show when={props.header || filtering()}>
      <Show when={filtering() && !isPreview()} fallback={<text height={1} flexShrink={0} fg={theme().text.muted}>{' ' + fitPath(isPreview() ? previewPath() || '' : toPosix(props.cwd).split('/').pop() || 'Files', inner())}</text>}>
        <box height={1} flexShrink={0} flexDirection="row"><text fg={theme().text.muted}>{fitEnd(' Filter: ', props.width)}</text><input width={Math.max(1, props.width - 14)} focused={props.focused && !searchEditing()()} value={query()} onInput={setQuery} onSubmit={() => invoke('activate')} /><text fg={theme().text.action.primary.base} onMouseDown={() => invoke('back')}> Back</text></box>
      </Show>
    </Show>
    <box flexGrow={1} minHeight={1} overflow="hidden" flexDirection="column">
      <Show when={isPreview()} fallback={<For each={window()}>{(item) => <text height={1} flexShrink={0} width={props.width} bg={item.rel === selected() ? theme().background?.action.primary.base : undefined}
        onMouseDown={() => { if (item.row && !('more' in item.row)) { props.dispatch({ type: 'select', view: 'files', id: item.rel }); invoke('activate') } }}>
        <span style={{ fg: color(item.rel, true), dim: props.activity.touched(item.rel) && !props.activity.glow(item.rel, props.now) }}>{props.activity.touched(item.rel) ? '•' : ' '}</span><span style={{ fg: filtering() && filesError() ? theme().text.feedback.error.base : color(item.rel) }}>{rowText(item)}</span><span style={{ fg: statusColor(item) }}>{statusSuffix(item)}</span>
      </text>}</For>}>
        <Show when={targetLine() !== undefined && preview()?.text !== undefined} fallback={<Show when={preview()?.kind === 'code' || preview()?.kind === 'markdown'} fallback={<For each={notice() ? [notice()] : table().slice(top(), top() + room())}>{(line) => <text height={1} flexShrink={0} fg={preview()?.kind === 'error' ? theme().text.feedback.error.base : theme().text.muted}>{' ' + fitEnd(line, inner())}</text>}</For>}>
          <code id="files-code" ref={(el) => { code = el; el.scrollY = top() }} width={inner()} height={room()} marginLeft={1} content={preview()?.text ?? ''} filetype={preview()?.language ?? (preview()?.kind === 'markdown' ? 'markdown' : undefined)} syntaxStyle={syntax()} wrapMode="char" fg={theme().text.base} conceal={false} />
        </Show>}><box flexDirection="row" height={room()} overflow="hidden"><text width={2} fg={theme().text.action.primary.base}>{source().slice(top(), top() + room()).map((_, i) => top() + i + 1 === markedLine() ? '> ' : '  ').join('\n')}</text><code id="files-target-code" width={Math.max(0, inner() - 1)} height={room()} content={source().slice(top(), top() + room()).join('\n')} filetype={preview()?.language} syntaxStyle={syntax()} wrapMode="none" fg={theme().text.base} conceal={false} /></box></Show>
      </Show>
    </box>
    </Show>
  </box>
}
