import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { branchLine, type Branch } from '../../core/git/branches.ts'
import { latest } from '../../core/latest.ts'
import { currentView, type PaneState } from '../../core/pane.ts'
import { fitEnd } from '../../core/shared/fit.ts'
import { insideRel, joinPath } from '../../core/shared/paths.ts'
import { Graph, fileText, fullHash, historyAction, historyError, historyMemory, newBranch, readFiles, record, type HistoryProps, type HistoryRow } from './graph.tsx'

const refOf = (branch: Branch) => `refs/${branch.remote ? 'remotes' : 'heads'}/${branch.name}`
function readBranches(value: unknown): { branches: Branch[]; base: string | null } {
  const data = record(value)
  if (!(data.base === null || typeof data.base === 'string') || !Array.isArray(data.branches)) throw new Error('Invalid branches reply.')
  return { base: data.base, branches: data.branches.map(raw => {
    const branch = record(raw)
    if (typeof branch.name !== 'string' || !branch.name || !fullHash(branch.hash) || typeof branch.remote !== 'boolean' || typeof branch.current !== 'boolean' || typeof branch.gone !== 'boolean' || !(branch.upstream === null || typeof branch.upstream === 'string') || !Number.isSafeInteger(branch.ahead) || (branch.ahead as number) < 0 || !Number.isSafeInteger(branch.behind) || (branch.behind as number) < 0) throw new Error('Invalid branches reply.')
    return branch as Branch
  }) }
}
export function Branches(props: HistoryProps & { state: PaneState; height: number; header: boolean; bind: (run: (action: string) => void) => void }) {
  const memory = createMemo(() => historyMemory(props.ctx, props.sessionID, props.root))
  const ui = () => memory()[0]
  const [loaded, setLoaded] = createSignal<ReturnType<typeof readBranches>>()
  const [error, setError] = createSignal('')
  let stopped = false
  const load = latest(async (_root: string) => readBranches(await props.api.branches({})))
  createEffect(() => {
    const root = props.root; props.revision
    setError('')
    void untrack(() => load(root)).then(r => { if (!stopped && !r.stale) setLoaded(r.value) }).catch((error: unknown) => { if (!stopped) setError(`Can't list branches: ${historyError(error)}`) })
  })
  const view = () => currentView(props.state) === 'git.compare' ? 'git.compare' : 'git.branches'
  const comparing = () => view() === 'git.compare'
  const selected = () => props.state.selected[view()]
  const rows = createMemo(() => {
    const rows: HistoryRow[] = []
    if (error()) return [{ id: 'branches-error', text: error(), error: true }]
    if (!loaded()) return [{ id: 'branches-loading', text: 'Loading…', muted: true }]
    let remote = false
    for (const branch of comparing() ? [] : loaded()!.branches.filter(branch => branch.name.toLowerCase().includes(ui().branchFilter.toLowerCase()))) {
      if (branch.remote && !remote) { remote = true; rows.push({ id: 'remote-heading', text: 'Remote', muted: true }) }
      const spans = branchLine(branch, props.width - 2)
      rows.push({ id: `branch-${refOf(branch)}`, text: spans.map(span => span.text).join(''), spans,
        activate: () => props.perform('Switch branch', () => historyAction(props, 'switchBranch', { name: branch.name, remote: branch.remote })) })
    }
    if (!comparing() && !rows.length) rows.push({ id: 'branches-empty', text: 'No branches match this filter.', muted: true })
    if (comparing() && ui().compared) {
      const comparison = ui().compared!
      rows.push({ id: 'compare-heading', text: `Compared with ${comparison.label}`, muted: true })
      if (!comparison.files.length) rows.push({ id: 'compare-empty', text: 'No changes.', muted: true })
      for (const file of comparison.files) {
        const path = insideRel(props.cwd, joinPath(props.root, file.path))
        if (path) rows.push({ id: `compare-file-${path}`, text: fileText({ ...file, path }, props.width - 2), activate: () => props.dispatch({ type: 'open-diff', path, source: comparison.source }) })
      }
    }
    return rows
  })
  const selectable = () => rows().filter(row => row.activate)
  createEffect(() => { if (!selectable().some(row => row.id === selected()) && selectable()[0]) props.dispatch({ type: 'select', view: view(), id: selectable()[0]!.id }) })
  let listTop = 0
  const visible = createMemo(() => {
    const room = Math.max(1, props.height - (props.header ? 1 : 0)); const all = rows(); const at = all.findIndex(row => row.id === selected())
    if (at >= 0) listTop = Math.min(Math.max(listTop, at - room + 1), at)
    listTop = Math.max(0, Math.min(listTop, all.length - room))
    return all.slice(listTop, listTop + room)
  })
  async function run(action: string) {
    if (action === 'back') { props.dispatch({ type: 'back' }); return }
    if (action === 'move-up' || action === 'move-down') {
      const all = selectable(); const at = all.findIndex(row => row.id === selected()); const next = all[Math.max(0, Math.min(all.length - 1, at + (action === 'move-up' ? -1 : 1)))]
      if (next) props.dispatch({ type: 'select', view: view(), id: next.id }); return
    }
    if (action === 'activate' || action === 'switch') { await selectable().find(row => row.id === selected())?.activate?.(); return }
    if (action === 'new-branch') { await props.perform('Create branch', () => newBranch(props)); return }
    if (action === 'filter') { await props.perform('Filter branches', async () => { const value = await props.ctx.ui.dialog.prompt({ title: 'Filter branches', value: ui().branchFilter }); if (value !== undefined && !stopped) memory()[1](d => { d.branchFilter = value }) }); return }
    if (action === 'compare') await props.perform('Compare', async () => {
      const data = loaded(); const branch = data?.branches.find(branch => `branch-${refOf(branch)}` === selected())
      if (!data?.base) throw new Error('No main branch to compare with.')
      if (!branch) throw new Error('Select a branch first.')
      const base = data.branches.find(branch => refOf(branch) === data.base)
      if (!base) throw new Error('No main branch to compare with.')
      const reply = record(await props.api.compare({ base: refOf(base), head: refOf(branch) })); const source = record(reply.source)
      if (source.kind !== 'compare' || !fullHash(source.base) || !fullHash(source.head)) throw new Error('Invalid comparison reply.')
      const files = readFiles(reply)
      if (!stopped) memory()[1](d => { d.compared = { source: { kind: 'compare', base: source.base as string, head: source.head as string }, files, label: base.name } })
      if (!stopped) props.dispatch({ type: 'compare' })
    })
  }
  props.bind(action => { void run(action) })
  onCleanup(() => { stopped = true; props.bind(() => {}) })
  return <box flexGrow={1} minHeight={1} flexDirection="column" overflow="hidden">
    <Show when={props.header}><text height={1} flexShrink={0} fg={props.ctx.theme.text.muted} onMouseDown={() => props.dispatch({ type: 'back' })}>{' ' + fitEnd(comparing() ? 'Comparison' : 'Branches', props.width - 2)}</text></Show>
    <For each={visible()}>{row => <box height={1} flexShrink={0} backgroundColor={selected() === row.id ? props.ctx.theme.background?.action.primary.base : undefined}>
      <Graph row={row} ctx={props.ctx} width={props.width} selected={selected() === row.id} activate={() => { if (row.activate) { props.dispatch({ type: 'select', view: view(), id: row.id }); void row.activate() } }} />
    </box>}</For>
  </box>
}
