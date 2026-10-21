import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { graphLine, layoutGraph, type GraphSpan } from '../../core/git/graph.ts'
import type { LogCommit } from '../../core/git/log.ts'
import type { CommitFile } from '../../core/git/commit.ts'
import { latest } from '../../core/latest.ts'
import { isAbort } from '../../core/shared/abort.ts'
import type { DiffSource, PaneAction } from '../../core/pane.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import { insideRel, joinPath } from '../../core/shared/paths.ts'
import { handToAgent } from './hand-off.ts'
import type { JeiRpc } from './rpc.ts'
import { graphColor } from './colors.ts'

type Commit = LogCommit & { agent: boolean }
export type HistoryRow = { id: string; text: string; spans?: GraphSpan[]; muted?: boolean; error?: boolean; activate?: () => Promise<void> | void }
export type Comparison = { source: Extract<DiffSource, { kind: 'compare' }>; files: CommitFile[]; label: string }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid history reply.')
  return value as Record<string, unknown>
}
export function fullHash(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) }
export function historyError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error
  return typeof message === 'string' ? message.split(/\r?\n/).find(line => line.trim()) ?? 'Unknown error' : 'Unknown error'
}
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export function readFiles(value: unknown): CommitFile[] {
  const data = record(value)
  if (!Array.isArray(data.files)) throw new Error('Invalid history reply.')
  return data.files.map(raw => {
    const f = record(raw)
    if (typeof f.path !== 'string' || !f.path || f.from !== undefined && typeof f.from !== 'string' || typeof f.status !== 'string' || !['M', 'A', 'D', 'R', 'T'].includes(f.status) || !(f.added === null || natural(f.added)) || !(f.removed === null || natural(f.removed))) throw new Error('Invalid history reply.')
    return f as CommitFile
  })
}
function readGraph(value: unknown): { commits: Commit[]; more: boolean } {
  const data = record(value)
  if (typeof data.more !== 'boolean' || !Array.isArray(data.commits)) throw new Error('Invalid history reply.')
  return { more: data.more, commits: data.commits.map(raw => {
    const c = record(raw)
    if (!fullHash(c.hash) || !Array.isArray(c.parents) || !c.parents.every(fullHash) || typeof c.author !== 'string' || typeof c.subject !== 'string' || typeof c.time !== 'number' || !Number.isFinite(c.time) || typeof c.agent !== 'boolean' || !Array.isArray(c.refs)) throw new Error('Invalid history reply.')
    for (const raw of c.refs) { const r = record(raw); if (typeof r.kind !== 'string' || !['head', 'local', 'remote', 'tag'].includes(r.kind) || typeof r.name !== 'string') throw new Error('Invalid history reply.') }
    return c as Commit
  }) }
}
export function historyMemory(ctx: Plugin.Context, sessionID: string, root: string) {
  return ctx.storage.memory<{ filter: string; pages: number; expanded: string | null; closed: boolean; branchFilter: string; compared: Comparison | null }>(`jei.history.${sessionID}.${root}`, { initial: { filter: '', pages: 1, expanded: null, closed: false, branchFilter: '', compared: null } })
}
export type HistoryProps = {
  ctx: Plugin.Context; api: RpcClient<typeof JeiRpc>; sessionID: string; root: string; cwd: string; revision: number; width: number; graphLimit: number; active: () => boolean
  selected: string | undefined; dispatch: (action: PaneAction) => void; refresh: () => Promise<void>; perform: (label: string, run: () => Promise<void>) => Promise<void>
}
export function fileText(file: CommitFile, width: number) {
  const counts = file.added !== null && file.removed !== null ? ` +${file.added} −${file.removed}` : ''
  return `${file.status} ${fitPath(file.path, Math.max(0, width - 2 - cellWidth(counts)))}${counts}`
}
export async function historyAction(props: Pick<HistoryProps, 'ctx' | 'api' | 'refresh' | 'active'>, method: 'switchBranch' | 'createBranch' | 'checkout' | 'revert', input: Record<string, unknown>) {
  try {
    let result = record(await props.api[method]({ ...input, confirmed: false }))
    if (!props.active()) return
    if (result.ok === false && typeof result.confirm === 'string') {
      if (!await props.ctx.ui.dialog.confirm({ title: method === 'createBranch' ? 'Create branch' : method === 'switchBranch' ? 'Switch branch' : method === 'checkout' ? 'Checkout' : 'Revert', message: result.confirm, label: { confirm: 'Confirm', cancel: 'Cancel' } })) return
      if (!props.active()) return
      result = record(await props.api[method]({ ...input, confirmed: true }))
    }
    if (result.ok !== true) throw new Error('Invalid history reply.')
  } finally { await props.refresh() }
}
export async function newBranch(props: Pick<HistoryProps, 'ctx' | 'api' | 'refresh' | 'active'>, start?: string) {
  const name = await props.ctx.ui.dialog.prompt({ title: `New branch name${start ? ` from ${start.slice(0, 7)}` : ''}`, value: '' })
  if (name === undefined || !props.active()) return
  await historyAction(props, 'createBranch', { name, ...(start ? { start } : {}) })
}
export function createGraph(props: HistoryProps) {
  const memory = createMemo(() => historyMemory(props.ctx, props.sessionID, props.root))
  const ui = () => memory()[0]
  const update = (fn: Parameters<ReturnType<typeof historyMemory>[1]>[0]) => memory()[1](fn)
  const [loaded, setLoaded] = createSignal<ReturnType<typeof readGraph>>()
  const [files, setFiles] = createSignal<CommitFile[]>([])
  const [url, setUrl] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  const [filesError, setFilesError] = createSignal('')
  const [pending, setPending] = createSignal(false)
  let stopped = false
  onCleanup(() => { stopped = true })
  const load = latest(async (_root: string, filter: string, count: number, sessionID: string) => readGraph(await props.api.graph({ filter, count, sessionID })))
  createEffect(() => {
    const root = props.root; const filter = ui().filter; const count = props.graphLimit * ui().pages; const sessionID = props.sessionID; props.revision
    setError('')
    void untrack(() => load(root, filter, count, sessionID)).then(r => { if (!stopped && !r.stale) setLoaded(r.value) }).catch((error: unknown) => { if (!stopped && !isAbort(error)) setError(`Can't load history: ${historyError(error)}`) })
  })
  const detail = latest(async (hash: string) => {
    const files = readFiles(await props.api.commitFiles({ hash }))
    const value = record(await props.api.webUrl({ hash }))
    if (value.url !== null && typeof value.url !== 'string') throw new Error('Invalid history reply.')
    return { files, url: value.url }
  })
  createEffect(() => {
    const hash = ui().expanded; props.revision
    setFiles([]); setUrl(null); setFilesError(''); setPending(!!hash)
    if (!hash) return
    void untrack(() => detail(hash)).then(r => { if (!stopped && !r.stale) { setFiles(r.value.files); setUrl(r.value.url); setPending(false) } }).catch((error: unknown) => { if (!stopped) { setFilesError(`Can't list files: ${historyError(error)}`); setPending(false) } })
  })
  const rows = createMemo(() => {
    const rows: HistoryRow[] = [{ id: 'group-graph', text: `${ui().closed ? '▸' : '▾'} Graph${ui().filter ? ' (filtered)' : ''}`, activate: () => update(d => { d.closed = !d.closed }) }]
    if (ui().closed) return rows
    if (error()) { rows.push({ id: 'graph-error', text: error(), error: true }); return rows }
    if (!loaded()) { rows.push({ id: 'graph-loading', text: 'Loading…', muted: true }); return rows }
    const commits = loaded()!.commits; const glyphs = layoutGraph(commits, 'unicode'); const inner = props.width - 2
    commits.forEach((c, index) => {
      const line = graphLine(c, glyphs[index]!, inner, c.agent, Date.now())
      rows.push({ id: `graph-${c.hash}`, text: line.spans.map(s => s.text).join(''), spans: line.spans,
        activate: () => update(d => { d.expanded = d.expanded === c.hash ? null : c.hash }) })
      if (ui().expanded === c.hash) {
        if (pending()) rows.push({ id: `files-loading-${c.hash}`, text: 'Loading…', muted: true })
        else if (filesError()) rows.push({ id: `files-error-${c.hash}`, text: filesError(), error: true })
        else for (const file of files()) {
          const path = insideRel(props.cwd, joinPath(props.root, file.path))
          if (!path) continue
          rows.push({ id: `commit-file-${c.hash}-${path}`, text: fileText({ ...file, path }, inner), activate: () => props.dispatch({ type: 'open-diff', path, source: { kind: 'commit', hash: c.hash } }) })
        }
        for (const method of ['checkout', 'revert'] as const) rows.push({ id: `${method}-${c.hash}`, text: method === 'checkout' ? 'Checkout' : 'Revert', activate: () => props.perform(method === 'checkout' ? 'Checkout' : 'Revert', () => historyAction(props, method, { hash: c.hash })) })
        if (url()) rows.push({ id: `web-${c.hash}`, text: `Open on ${url()!.startsWith('https://github.com/') ? 'GitHub' : 'GitLab'}`, activate: () => props.perform('Open link', async () => { await props.api.openWeb({ hash: c.hash }) }) })
      }
      if (line.connector.length) rows.push({ id: `connector-${c.hash}`, text: line.connector.map(s => s.text).join(''), spans: line.connector })
    })
    if (loaded()!.more) rows.push({ id: 'graph-more', text: 'Load more', activate: () => update(d => { d.pages++ }) })
    if (!commits.length) rows.push({ id: 'graph-empty', text: ui().filter ? 'No commits match this filter.' : 'No commits yet.', muted: true })
    return rows
  })
  async function run(action: string): Promise<boolean> {
    if (action === 'branches') { props.dispatch({ type: 'branches' }); return true }
    if (action === 'filter') { await props.perform('Filter', async () => { const value = await props.ctx.ui.dialog.prompt({ title: 'Filter: text, author:, path:, branch:*', value: ui().filter }); if (value !== undefined && !stopped) { update(d => { d.filter = value; d.pages = 1 }); props.dispatch({ type: 'select', view: 'git', id: 'group-graph' }) } }); return true }
    if (action === 'fetch') { await props.perform('Fetch', async () => { try { await props.api.fetch({}) } finally { await props.refresh() } }); return true }
    const commit = loaded()?.commits.find(c => props.selected === `graph-${c.hash}`)
    if (!commit) return false
    if (action === 'copy-hash') { await props.perform('Copy', async () => { if (!props.ctx.renderer?.copyToClipboardOSC52(commit.hash)) await props.ctx.ui.dialog.prompt({ title: 'Commit hash', value: commit.hash }) }); return true }
    if (action === 'ask') { await props.perform('Ask OpenCode', () => handToAgent(props.ctx, props.sessionID, `Explain commit ${commit.hash.slice(0, 7)} ("${commit.subject}").`)); return true }
    if (action === 'new-branch') { await props.perform('Create branch', () => newBranch(props, commit.hash)); return true }
    return false
  }
  return { rows, run, files, ui, ready: loaded, settled: () => !!loaded() || !!error(), pending }
}

export function Graph(props: { row: HistoryRow; ctx: Plugin.Context; width: number; selected?: boolean; activate: () => void }) {
  const text = () => fitEnd(props.row.text, props.width - 2)
  return <text height={1} width={props.width} fg={props.row.error ? props.ctx.theme.text.feedback.error.base : props.row.muted ? props.ctx.theme.text.muted : props.ctx.theme.text.base} onMouseDown={props.activate}>
    {' '}{props.row.spans ? props.row.spans.map(span => <span style={{ fg: props.selected ? props.ctx.theme.text.base : graphColor(props.ctx, span) }}>{span.text}</span>) : text()}
  </text>
}
