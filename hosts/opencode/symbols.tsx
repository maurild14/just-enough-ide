import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { ActivityLog } from '../../core/activity/log.ts'
import { KEYS } from '../../core/keys.ts'
import { currentView, type PaneAction, type PaneState } from '../../core/pane.ts'
import type { SymbolRef } from '../../core/symbols/approx.ts'
import type { SymbolNode } from '../../core/symbols/outline.ts'
import { symbolSendText } from '../../core/symbols/service.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import { nativeRel } from '../../core/shared/paths.ts'
import { handToAgent } from './hand-off.ts'
import type { JeiRpc } from './rpc.ts'

type Subject = { rel: string; node: SymbolNode }
type Call = Subject & { id: string; name: string; direction: 'incoming' | 'outgoing'; depth: number; expanded: boolean; refs: SymbolRef[] }
type SymbolState = { rel: string; nodes: SymbolNode[]; notice: string; query: string; busy: boolean; result: { title: string; refs: SymbolRef[]; subject?: Subject } | null; calls: Call[]; subjects: Record<string, string> }
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid Symbols reply.'); return v as Record<string, unknown> }
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
function rel(v: unknown): string { if (typeof v !== 'string' || !v || v.includes('\0') || nativeRel('', v, 'linux') !== v) throw new Error('Invalid Symbols path.'); return v }
function readNodes(value: unknown): SymbolNode[] | null {
  if (value === null) return null
  let count = 0
  const read = (v: unknown, depth = 0): SymbolNode[] => {
    if (!Array.isArray(v) || depth > 2000) throw new Error('Invalid Symbols reply.')
    return v.map(raw => { const n = record(raw); if (++count > 2000 || typeof n.name !== 'string' || typeof n.kind !== 'string' || !['function', 'class', 'method', 'type', 'interface', 'enum', 'const', 'heading'].includes(n.kind) || !positive(n.line) || !positive(n.endLine) || n.endLine < n.line) throw new Error('Invalid Symbols reply.'); return { name: n.name, kind: n.kind as SymbolNode['kind'], line: n.line, endLine: n.endLine, children: read(n.children, depth + 1) } })
  }
  return read(value)
}
function readRefs(raw: unknown): SymbolRef[] {
  const v = record(raw).refs
  if (!Array.isArray(v) || v.length > 2000) throw new Error('Invalid Symbols reply.')
  return v.map(raw => { const r = record(raw); if (!positive(r.line) || typeof r.text !== 'string' || !(r.container === null || typeof r.container === 'string')) throw new Error('Invalid Symbols reply.'); return { rel: rel(r.rel), line: r.line, text: r.text, container: r.container } })
}
const flatten = (nodes: readonly SymbolNode[], depth = 0): { node: SymbolNode; depth: number }[] => nodes.flatMap(node => [{ node, depth }, ...flatten(node.children, depth + 1)])

export function Symbols(props: {
  ctx: Plugin.Context; api: RpcClient<typeof JeiRpc>; sessionID: string; cwd: string; state: PaneState; dispatch: (a: PaneAction) => void
  activity: ActivityLog; revision: number; width: number; height: number; header: boolean; focused: boolean
  bind: (run: (action: string) => void, editing: () => boolean) => void
}) {
  const [s, update] = props.ctx.storage.memory<SymbolState>(`jei.symbols.${props.sessionID}\0${props.cwd}`, { initial: { rel: '', nodes: [], notice: '', query: '', busy: false, result: null, calls: [], subjects: {} } })
  const [editing, setEditing] = createSignal(false)
  let stopped = false, generation = 0, pending: AbortController | undefined, listTop = 0
  const view = createMemo(() => currentView(props.state)), results = () => view() === 'symbols.results', selected = () => props.state.selected[view()]
  const selectedFile = createMemo(() => props.state.selected.files)
  const theme = () => props.ctx.theme, inner = () => Math.max(0, props.width - 2)
  const active = (stamp: number) => !stopped && generation === stamp && ['symbols', 'symbols.results'].includes(view())
  function stop() { generation++; pending?.abort(); update(d => { d.busy = false }); setEditing(false) }
  function select(id: string) { props.dispatch({ type: 'select', view: view(), id }); if (!id.startsWith('command:') && id !== 'notice') update(d => { d.subjects[view()] = id }) }
  const errorText = (error: unknown) => error instanceof Error ? error.message.split(/\r?\n/)[0]! : 'Unable to complete Symbols.'
  async function outline(path: string, signal: AbortSignal) {
    const raw = record(await props.api.outline({ rel: path }, { signal }))
    if (typeof raw.file !== 'boolean') throw new Error('Invalid Symbols reply.')
    return { file: raw.file, nodes: readNodes(raw.nodes) }
  }
  createEffect(() => {
    const file = selectedFile(); props.revision
    const candidates = [...new Set([file, ...Object.entries(props.activity.toJSON()).sort((a, b) => b[1].at - a[1].at).map(([path]) => path)].filter((p): p is string => !!p))]
    const stamp = ++generation; pending?.abort(); const controller = new AbortController(); pending = controller
    update(d => { d.busy = true })
    void (async () => {
      for (const path of candidates) {
        rel(path)
        const result = await outline(path, controller.signal)
        if (!active(stamp)) return
        if (result.file) { const reset = s.rel !== path || !s.nodes.length; update(d => { d.rel = path; d.nodes = result.nodes ?? []; d.notice = result.nodes === null ? 'No outline for this file type.' : '' }); if (reset && result.nodes?.length && !results()) select('node-0'); return }
      }
      if (active(stamp)) update(d => { d.rel = ''; d.nodes = []; d.notice = 'Select a file in Files.' })
    })().catch(error => { if (active(stamp)) update(d => { d.notice = errorText(error); d.nodes = [] }) }).finally(() => { if (active(stamp)) update(d => { d.busy = false }) })
    onCleanup(() => controller.abort())
  })
  async function perform(fn: (stamp: number, signal: AbortSignal) => Promise<void>) {
    if (s.busy) return
    const stamp = ++generation; pending?.abort(); pending = new AbortController(); update(d => { d.busy = true })
    try { await fn(stamp, pending.signal) } catch (error) { if (active(stamp)) props.ctx.ui.toast.show({ message: fitEnd(errorText(error), props.width), variant: 'error' }) }
    finally { if (active(stamp)) update(d => { d.busy = false }) }
  }
  function preview(path: string, line: number) { stop(); props.dispatch({ type: 'preview', rel: path, line }) }
  function show(title: string, refs: SymbolRef[], subject?: Subject) { update(d => { d.result = { title, refs, ...(subject ? { subject } : {}) }; d.calls = []; d.subjects['symbols.results'] = 'ref-0' }); setEditing(false); props.dispatch({ type: 'symbol-results' }); select('ref-0') }
  const nodes = createMemo(() => flatten(s.nodes))
  async function subjectFor(id: string, signal: AbortSignal): Promise<Subject | undefined> {
    if (!results()) { const node = nodes()[Number(id.slice(5))]?.node; return node && s.rel ? { rel: s.rel, node } : undefined }
    const call = s.calls.find(c => c.id === id); if (call) return { rel: call.rel, node: call.node }
    if (s.result?.subject && !s.calls.length) return s.result.subject
    const parent = s.calls.find(c => c.id === id.slice(0, id.lastIndexOf('/')))
    const ref = parent ? parent.refs[Number(id.slice(id.lastIndexOf('/') + 1))] : s.result?.refs[Number(id.slice(4))]
    if (!ref) return
    const data = await outline(ref.rel, signal), node = flatten(data.nodes ?? []).find(n => n.node.line === ref.line)?.node
    return node ? { rel: ref.rel, node } : undefined
  }
  async function expand(id: string) {
    const item = s.calls.find(c => c.id === id)
    if (!item || s.busy) return
    if (item.expanded) { update(d => { d.calls = d.calls.map(c => c.id === id ? { ...c, expanded: false } : c) }); return }
    await perform(async (stamp, signal) => {
      const refs = readRefs(await (item.direction === 'incoming' ? props.api.incoming({ name: item.node.name }, { signal }) : props.api.outgoing({ rel: item.rel, line: item.node.line }, { signal })))
      if (!active(stamp)) return
      const retained = s.calls.filter(c => !c.id.startsWith(`${id}/`)), room = Math.max(0, 2000 - retained.reduce((n, c) => n + (c.id === id ? 0 : c.refs.length), 0))
      if (refs.length > room) props.ctx.ui.toast.show({ message: 'Results truncated.', variant: 'warning' })
      update(d => { d.calls = retained.map(c => c.id === id ? { ...c, expanded: true, refs: refs.slice(0, room) } : c) })
    })
  }
  type Row = { id: string; text: string; passive?: boolean; target?: { rel: string; line: number } }
  const rows = createMemo(() => {
    const all: Row[] = []
    if (!results()) for (const [i, item] of nodes().entries()) all.push({ id: `node-${i}`, text: `${' '.repeat(Math.min(item.depth * (props.width < 32 ? 1 : 2), Math.floor(inner() / 3)))}${props.width >= 60 ? item.node.kind : item.node.kind[0]} ${item.node.name}  ${item.node.line}`, target: { rel: s.rel, line: item.node.line } })
    else if (s.calls.length) {
      const append = (call: Call) => {
        all.push({ id: call.id, text: `${' '.repeat(Math.min(call.depth * 2, Math.floor(inner() / 3)))}${call.expanded ? '▾' : '▸'} ${call.name} · approximate` })
        if (call.expanded) for (const [i, ref] of call.refs.entries()) { const id = `${call.id}/${i}`, child = s.calls.find(c => c.id === id); if (child) append(child); else all.push({ id, text: `${' '.repeat(Math.min((call.depth + 1) * 2, Math.floor(inner() / 3)))}${ref.container ?? ref.text.trim()} ${ref.rel}:${ref.line}`, target: ref }) }
      }
      for (const call of s.calls.filter(c => !c.id.includes('/'))) append(call)
    } else {
      let previous = ''
      for (const [i, ref] of (s.result?.refs ?? []).entries()) { if (props.height > 3 && previous !== ref.rel) all.push({ id: `group:${ref.rel}`, text: ref.rel, passive: true }); previous = ref.rel; all.push({ id: `ref-${i}`, text: `${ref.line}: ${ref.container ? ref.container + ' · ' : ''}${ref.text.trim()}`, target: ref }) }
    }
    if (!all.length) all.push({ id: 'notice', text: results() ? 'No results.' : s.notice || (s.busy ? 'Loading…' : 'No symbols.'), passive: true })
    for (const key of KEYS[view()]) if (/^[a-z]$/.test(key.key) && key.action !== 'back') all.push({ id: `command:${key.action}`, text: `${key.key} ${key.label}` })
    return all
  })
  const selectable = () => rows().filter(r => !r.passive)
  createEffect(() => { if (!selectable().some(r => r.id === selected())) { const first = selectable()[0]; if (first) select(first.id) } })
  const room = () => Math.max(0, props.height - 1 - (editing() ? 1 : 0))
  const window = createMemo(() => { const all = rows(), at = all.findIndex(r => r.id === selected()); if (at >= 0) listTop = Math.min(Math.max(listTop, at - room() + 1), at); listTop = Math.max(0, Math.min(listTop, all.length - room())); return all.slice(listTop, listTop + room()) })
  async function run(action: string): Promise<void> {
    if (action === 'back') { if (editing()) stop(); else { stop(); props.dispatch({ type: 'back' }) }; return }
    if (action === 'move-up' || action === 'move-down') { setEditing(false); const all = selectable(), at = all.findIndex(r => r.id === selected()), next = all[Math.max(0, Math.min(all.length - 1, at + (action === 'move-up' ? -1 : 1)))]; if (next) select(next.id); return }
    if (action === 'activate' && !s.calls.length) { const target = rows().find(r => r.id === selected())?.target; if (target) { preview(target.rel, target.line); return } }
    if (s.busy) return
    const id = selected() ?? '', subjectId = s.subjects[view()] ?? id
    if (action === 'activate') {
      if (id.startsWith('command:')) return run(id.slice(8))
      if (s.calls.some(c => c.id === id)) return expand(id)
      const row = rows().find(r => r.id === id)
      if (s.calls.length && row?.target) {
        await perform(async (stamp, signal) => { const subject = await subjectFor(id, signal); if (!active(stamp)) return; if (!subject) { preview(row.target!.rel, row.target!.line); return }; const parent = s.calls.find(c => c.id === id.slice(0, id.lastIndexOf('/'))); if (!parent || s.calls.length >= 2000) return; update(d => { d.calls.push({ ...subject, id, name: subject.node.name, direction: parent.direction, depth: parent.depth + 1, expanded: false, refs: [] }) }) }); return expand(id)
      }
      if (row?.target) preview(row.target.rel, row.target.line); return
    }
    if (action === 'find-symbol') { setEditing(true); return }
    await perform(async (stamp, signal) => {
      const subject = await subjectFor(subjectId, signal)
      if (!active(stamp)) return
      if (!subject) { props.ctx.ui.toast.show({ message: 'Select a symbol first.', variant: 'warning' }); return }
      if (action === 'send') { const refs = readRefs(await props.api.references({ name: subject.node.name }, { signal })); if (active(stamp)) await handToAgent(props.ctx, props.sessionID, symbolSendText(subject.node.name, { rel: subject.rel, line: subject.node.line, text: subject.node.name, container: null }, refs)); return }
      if (action === 'calls') { update(d => { d.result = { title: `Calls: ${subject.node.name}`, refs: [] }; d.calls = ['incoming', 'outgoing'].map((direction, i) => ({ ...subject, id: i ? 'calls' : 'callers', name: i ? 'Calls' : 'Callers', direction: direction as Call['direction'], depth: 0, expanded: false, refs: [] })) }); props.dispatch({ type: 'symbol-results' }); select('callers'); return }
      const refs = readRefs(await (action === 'definition' ? props.api.definitions({ name: subject.node.name, fromRel: subject.rel }, { signal }) : props.api.references({ name: subject.node.name }, { signal })))
      if (!active(stamp)) return
      if (action === 'definition' && refs.length === 1) preview(refs[0]!.rel, refs[0]!.line)
      else show(`${action === 'definition' ? 'Definitions' : 'References'}: ${subject.node.name}`, refs, action === 'references' ? subject : undefined)
    })
  }
  async function find() { const name = s.query; if (!name || /[\r\n]/.test(name)) return; setEditing(false); await perform(async (stamp, signal) => { const refs = readRefs(await props.api.findSymbol({ name }, { signal })); if (active(stamp)) show(`Symbols: ${name}`, refs) }) }
  props.bind(action => { void run(action) }, editing)
  onCleanup(() => { stopped = true; stop(); props.bind(() => {}, () => false) })
  const header = () => { const suffix = ' · approximate', title = results() ? s.result?.title ?? 'Symbols' : s.rel ? `Outline: ${s.rel}` : 'Outline'; return fitEnd(title, Math.max(0, inner() - cellWidth(suffix))) + suffix }
  return <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">
    <text height={1} flexShrink={0} fg={theme().text.muted}>{' ' + fitEnd(header(), inner())}</text>
    <Show when={editing()}><box height={1} flexShrink={0} flexDirection="row"><input id="symbols-find" width={Math.max(1, props.width - 8)} focused={props.focused} maxLength={200} value={s.query} placeholder="Find symbol" onInput={query => update(d => { d.query = query })} onSubmit={() => { void find() }} /><text fg={theme().text.action.primary.base} onMouseDown={stop}> Cancel</text></box></Show>
    <For each={window()}>{row => <text id={`symbols-row-${row.id}`} height={1} flexShrink={0} fg={row.passive ? theme().text.muted : theme().text.base} bg={row.id === selected() ? theme().background?.action.primary.base : undefined} onMouseDown={() => { if (!row.passive) { setEditing(false); select(row.id); void run('activate') } }}>{' ' + (row.text.includes('/') ? fitPath(row.text, inner()) : fitEnd(row.text, inner()))}</text>}</For>
  </box>
}
