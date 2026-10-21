import type { EngineInterface, RenderElement } from 'claude-code'
import { KEYS } from '../../core/keys.ts'
import { latest } from '../../core/latest.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { joinPath } from '../../core/shared/paths.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import { parseLsp, type LspOp } from '../../core/symbols/lsp.ts'
import { fileOutline, definitions, findSymbol, readSource, references, incoming, outgoing, symbolSendText } from '../../core/symbols/service.ts'
import type { SymbolNode } from '../../core/symbols/outline.ts'
import type { SymbolRef } from '../../core/symbols/approx.ts'
import type { Host } from '../../core/host.ts'
import type { JeiSymbols } from '../../types/index.d.ts'
import { onRefresh } from './activity.ts'
import { firstLine, projectHost, showPreview, windowTop, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { readActivity, readCwd, readPane, readSymbols, readTick, updatePane, updateSymbols } from './state.ts'

type Parsed = ReturnType<typeof parseLsp>
type Input = { operation: LspOp; filePath: string; line: number; character: number; query?: string }
type Runtime = { epoch: number; controller: AbortController; ids: string[]; focused?: string; pending?: { input: Input; call?: string }; fresh: boolean; load: ReturnType<typeof latest<[() => Promise<unknown>], unknown>> }
const runtimes = new Map<string, Runtime>()
async function runtime($: EngineInterface, root: string): Promise<Runtime> {
  const key = `${await $.session.id()}\0${root}`
  let r = runtimes.get(key)
  if (!r) { r = { epoch: 0, controller: new AbortController(), ids: [], fresh: false, load: latest(async (run: () => Promise<unknown>) => run()) }; runtimes.set(key, r) }
  return r
}
onRefresh(() => {
  for (const r of runtimes.values()) { r.fresh = false; r.pending = undefined }
})
export async function stopSymbols($: EngineInterface): Promise<void> {
  if (!runtimes.size) return
  const root = await readCwd($), r = await runtime($, root), epoch = ++r.epoch
  r.pending = undefined
  r.controller.abort()
  await updateSymbols($, root, s => r.epoch === epoch ? { ...s, busy: false, loading: false, editing: false, permission: false } : s)
}
function begin(r: Runtime): number { r.controller.abort(); r.controller = new AbortController(); return ++r.epoch }
/** One captured signal covers the whole fallback, including sequential callee searches. */
async function symbolHost($: EngineInterface, root: string): Promise<Host> {
  const signal = (await runtime($, root)).controller.signal, host = await projectHost($, root)
  signal.throwIfAborted()
  return { ...host,
    stream(argv, options) { signal.throwIfAborted(); return host.stream(argv, { ...options, signal }) },
    async run(argv, options) { signal.throwIfAborted(); const result = await host.run(argv, { ...options, signal }); signal.throwIfAborted(); return result },
  }
}
const flatten = (nodes: readonly SymbolNode[], depth = 0): { node: SymbolNode; depth: number }[] => nodes.flatMap(node => [{ node, depth }, ...flatten(node.children, depth + 1)])
function act($: EngineInterface, fn: () => Promise<unknown>): () => void { return () => { void fn().catch(err => $.ui.toast(firstLine(err))) } }

async function inputFor($: EngineInterface, root: string, operation: LspOp, rel: string, node?: SymbolNode, query?: string): Promise<Input | null> {
  const text = await readSource(await projectHost($, root), root, rel)
  if (text === null) return null
  let line = 1, character = 1
  if (node) {
    line = node.line
    const raw = text.split('\n')[line - 1]
    if (raw === undefined) return null
    const name = node.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hits = [...raw.matchAll(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g'))]
    if (hits.length !== 1) return null
    character = hits[0]!.index + 1
  }
  return { operation, filePath: joinPath(root, rel), line, character, ...(query ? { query } : {}) }
}
async function exact($: EngineInterface, root: string, input: Input | null, deliberate = false, call?: string): Promise<Parsed> {
  if (!input) return null
  const r = await runtime($, root)
  const epoch = r.epoch
  const current = async () => r.epoch === epoch && await readCwd($) === root && ['symbols', 'symbols.results'].includes(currentView(await readPane($)))
  try {
    if (!await current()) return null
    const verdict = await $.tool.check({ tool: 'LSP', input })
    if (!await current()) return null
    if (verdict.decision === 'ask' && !deliberate) {
      r.pending = { input, ...(call ? { call } : {}) }
      await updateSymbols($, root, s => ({ ...s, permission: true }))
      return null
    }
    if (verdict.decision === 'deny') { r.pending = undefined; await updateSymbols($, root, s => ({ ...s, permission: false })); if (deliberate) $.ui.toast('LSP request refused.'); return null }
    r.pending = undefined
    await updateSymbols($, root, s => ({ ...s, permission: false }))
    const result = await $.tool.call({ tool: 'LSP', ...input } as never)
    if (!await current()) return null
    if ('deny' in result || result.isError || !result.text) { if (deliberate) $.ui.toast('LSP request failed or was refused.'); return null }
    const parsed = parseLsp(input.operation, result.text, root, (await projectHost($, root)).platform)
    if (!parsed && deliberate) $.ui.toast('LSP returned unsupported results.')
    return parsed
  } catch (err) { if (deliberate && await current()) $.ui.toast(`LSP request failed: ${firstLine(err)}.`); return null }
}

export async function enterSymbols($: EngineInterface): Promise<void> {
  const root = await readCwd($), pane = await readPane($), r = await runtime($, root), old = await readSymbols($, root)
  try { await projectHost($, root) } catch (err) { await updateSymbols($, root, s => ({ ...s, rel: '', nodes: [], source: 'approximate', notice: firstLine(err), busy: false, loading: false })); return }
  const activity = await readActivity($)
  const touched = Object.entries(activity).sort((a, b) => b[1].at - a[1].at).map(([rel]) => rel)
  let rel = ''
  for (const candidate of [pane.selected.files, ...touched]) {
    if (candidate && await readSource(await projectHost($, root), root, candidate) !== null) { rel = candidate; break }
  }
  if (r.fresh && old.rel === rel) { if (r.controller.signal.aborted) begin(r); return }
  r.fresh = true
  const epoch = begin(r)
  await updateSymbols($, root, s => ({ ...s, rel, nodes: old.rel === rel ? s.nodes : [], source: old.rel === rel ? s.source : 'approximate', notice: '', loading: true }))
  const result = await r.load(async () => {
    const nodes = rel ? await fileOutline((await projectHost($, root)), root, rel) : null
    if (r.epoch !== epoch || await readCwd($) !== root) return null
    await updateSymbols($, root, s => ({ ...s, nodes: nodes ?? [], source: 'approximate', notice: !rel ? 'Select a file in Files.' : nodes === null ? 'No outline for this file type.' : '' }))
    const parsed = rel ? await exact($, root, await inputFor($, root, 'documentSymbol', rel)) : null
    return { nodes: parsed?.symbols ?? nodes ?? [], source: parsed?.symbols ? 'lsp' as const : 'approximate' as const, notice: !rel ? 'Select a file in Files.' : nodes === null && !parsed?.symbols ? 'No outline for this file type.' : '' }
  })
  if (!result.stale && r.epoch === epoch && await readCwd($) === root) {
    const data = result.value as Pick<JeiSymbols, 'nodes' | 'source' | 'notice'>
    await updateSymbols($, root, s => ({ ...s, ...data, rel, busy: false, loading: false }))
  }
}
export async function symbolsEditing($: EngineInterface): Promise<boolean> { return ['symbols', 'symbols.results'].includes(currentView(await readPane($))) && (await readSymbols($, await readCwd($))).editing }
export async function leaveSymbolsEditor($: EngineInterface): Promise<boolean> {
  const root = await readCwd($)
  if (!(await readSymbols($, root)).editing) return false
  await stopSymbols($)
  await updateSymbols($, root, s => ({ ...s, editing: false, busy: false })); return true
}
export async function focusSymbols($: EngineInterface, key: string | undefined): Promise<void> {
  const pane = await readPane($), view = currentView(pane)
  if (view !== 'symbols' && view !== 'symbols.results') return
  const root = await readCwd($), r = await runtime($, root)
  r.focused = key
  if (key?.startsWith('symbols-row-')) {
    const id = key.slice(12)
    const s = await readSymbols($, root), data = !id.startsWith('command-') && id !== 'permission'
    if (s.editing || data && s.selection?.[view] !== id) await updateSymbols($, root, s => ({ ...s, editing: false, ...(data ? { selection: { ...s.selection, [view]: id } } : {}) }))
    if (pane.selected[view] !== id) await updatePane($, s => reducePane(s, { type: 'select', view, id }))
  } else if (key === 'symbols-find' && !(await readSymbols($, root)).editing) await updateSymbols($, root, s => ({ ...s, editing: true }))
  else if (key !== 'symbols-find' && (await readSymbols($, root)).editing) await updateSymbols($, root, s => ({ ...s, editing: false }))
}
export async function scrollSymbols($: EngineInterface, by: number): Promise<boolean> {
  const pane = await readPane($), view = currentView(pane)
  if (view !== 'symbols' && view !== 'symbols.results') return false
  const root = await readCwd($), r = await runtime($, root)
  if ((await readSymbols($, root)).editing) return false
  const from = r.ids.indexOf(pane.selected[view] ?? ''), id = r.ids[Math.max(0, Math.min(r.ids.length - 1, from < 0 ? 0 : from + by))]
  if (id && id !== pane.selected[view]) {
    const s = await readSymbols($, root)
    if (!id.startsWith('command-') && id !== 'permission' && s.selection?.[view] !== id) await updateSymbols($, root, u => ({ ...u, selection: { ...u.selection, [view]: id } }))
    await updatePane($, s => reducePane(s, { type: 'select', view, id }))
    await $.ui.focus({ requestId: 'jei', key: `symbols-row-${id}` }).catch(() => {})
  }
  return true
}
async function fill($: EngineInterface, text: string): Promise<void> { if (!(await $.prompt.fill({ text, mode: 'insert' })).isFilled) $.ui.toast("The prompt can't take this text right now.") }

export async function renderSymbols($: EngineInterface, e: PaneRender, frame: FilesFrame): Promise<FilesView> {
  const els = $.ui.resolve(e), { Box, Text, Button } = els, Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const root = await readCwd($), pane = await readPane($), s = await readSymbols($, root), r = await runtime($, root), view = currentView(pane)
  await readTick($)
  const inner = frame.inner, rows: { id: string; el: RenderElement }[] = [], nodes = flatten(s.nodes)
  const selected = pane.selected[view] ?? (view === 'symbols' ? 'node-0' : s.calls.length ? 'callers' : 'ref-0')
  const outlineId = s.selection?.symbols ?? (pane.selected.symbols?.startsWith('node-') ? pane.selected.symbols : 'node-0')
  const selectedNode = nodes[Number(outlineId.slice(5))]?.node
  let requestEpoch = r.epoch
  const current = async () => r.epoch === requestEpoch && await readCwd($) === root && ['symbols', 'symbols.results'].includes(currentView(await readPane($)))
  const text = (value: string, key?: string) => <Box key={key}><Text dimColor wrap="truncate-end">{inner ? ` ${fitEnd(value, inner)}` : ''}</Text></Box>
  const row = (id: string, label: string, run: () => Promise<unknown>, key = `symbols-row-${id}`) => <Box flexDirection="row"><Text> </Text><Button key={key} plain onPress={act($, run)}><Text inverse={selected === id && !(frame.isFocused && r.focused === key)} wrap="truncate-end">{fitEnd(label, inner)}</Text></Button></Box>
  const preview = async (rel: string, line: number) => { await stopSymbols($); await showPreview($, rel, line) }
  const showResults = async (title: string, refs: SymbolRef[], exact: boolean, subject?: { rel: string; node: SymbolNode }) => {
    if (!await current()) return
    await updateSymbols($, root, u => ({ ...u, result: { title, refs, source: exact ? 'lsp' : 'approximate', ...(subject ? { subject } : {}) }, calls: [], editing: false, selection: { ...u.selection, 'symbols.results': 'ref-0' } }))
    await updatePane($, p => reducePane(p, { type: 'symbol-results' }))
    await updatePane($, p => reducePane(p, { type: 'select', view: 'symbols.results', id: 'ref-0' }))
  }
  const request = async (operation: LspOp, rel: string, node: SymbolNode, deliberate = false, call?: string) => exact($, root, await inputFor($, root, operation, rel, node), deliberate, call)
  const publishCalls = async (id: string, refs: SymbolRef[], source: 'lsp' | 'approximate') => {
    if (!await current()) return
    const fresh = await readSymbols($, root)
    if (!fresh.calls.some(item => item.id === id)) return
    const retained = fresh.calls.filter(item => !item.id.startsWith(`${id}/`))
    const room = Math.max(0, 2000 - retained.filter(c => c.id !== id).reduce((n, c) => n + c.refs.length, 0))
    if (refs.length > room) $.ui.toast('Results truncated.')
    await updateSymbols($, root, u => ({ ...u, calls: retained.map(item => item.id === id ? { ...item, expanded: true, refs: refs.slice(0, room), source } : item) }))
    await updatePane($, p => reducePane(p, { type: 'select', view: 'symbols.results', id }))
    await $.ui.focus({ requestId: 'jei', key: `symbols-row-${id}` }).catch(() => {})
  }
  const expand = async (id: string) => {
    const fresh = await readSymbols($, root), item = fresh.calls.find(item => item.id === id)
    if (!item || fresh.busy) return
    if (item.expanded) { await updateSymbols($, root, u => ({ ...u, calls: u.calls.map(c => c.id === id ? { ...c, expanded: false } : c) })); return }
    await operation(async () => {
      const parsed = await request(item.direction, item.rel, item.node, false, id)
      if (!await current()) return
      const refs = parsed?.refs ?? await (item.direction === 'incomingCalls' ? incoming((await symbolHost($, root)), root, item.node.name) : outgoing((await symbolHost($, root)), root, item.rel, item.node))
      if (!await current()) return
      await publishCalls(id, refs, parsed?.refs ? 'lsp' : 'approximate')
    })
  }
  const operation = async (fn: () => Promise<unknown>) => {
    if ((await readSymbols($, root)).busy) return
    const epoch = begin(r)
    requestEpoch = epoch
    await updateSymbols($, root, u => ({ ...u, busy: true, loading: false }))
    try { await fn() } finally { if (r.epoch === epoch) await updateSymbols($, root, u => ({ ...u, busy: false })) }
  }
  const command = async (action: string) => {
    if (s.busy) return
    if (action === 'find-symbol') { await updateSymbols($, root, u => ({ ...u, editing: true })); await $.ui.focus({ requestId: 'jei', key: 'symbols-find' }).catch(() => {}); return }
    if (action === 'send') return operation(async () => {
      let subject = view === 'symbols' && selectedNode ? { rel: s.rel, node: selectedNode } : s.result?.subject
      const id = s.selection?.['symbols.results'] ?? selected
      const call = s.calls.find(item => item.id === id)
      if (call) subject = { rel: call.rel, node: call.node }
      else if (view === 'symbols.results' && !subject) {
        const parent = s.calls.find(item => item.id === id.slice(0, id.lastIndexOf('/')))
        const ref = parent ? parent.refs[Number(id.slice(id.lastIndexOf('/') + 1))] : s.result?.refs[Number(id.startsWith('ref-') ? id.slice(4) : 0)]
        if (ref) {
          const node = flatten(await fileOutline((await projectHost($, root)), root, ref.rel) ?? []).find(item => item.node.line === ref.line)?.node
          if (node) subject = { rel: ref.rel, node }
        }
      }
      if (!subject) { $.ui.toast('Select a symbol first.'); return }
      if (!await current()) return
      const refs = await references((await symbolHost($, root)), root, subject.node.name)
      if (await current()) return fill($, symbolSendText(subject.node.name, { rel: subject.rel, line: subject.node.line, text: subject.node.name, container: null }, refs))
      return
    })
    if (!selectedNode || !s.rel) { $.ui.toast('Select a symbol first.'); return }
    if (action === 'calls') {
      await updateSymbols($, root, u => ({ ...u, result: { title: `Calls: ${selectedNode.name}`, source: 'approximate', refs: [] }, selection: { ...u.selection, 'symbols.results': 'callers' }, calls: ['incomingCalls', 'outgoingCalls'].map((direction, i) => ({ id: i ? 'calls' : 'callers', name: i ? 'Calls' : 'Callers', rel: s.rel, node: selectedNode, direction: direction as 'incomingCalls' | 'outgoingCalls', depth: 0, expanded: false, source: 'approximate', refs: [] })) }))
      await updatePane($, p => reducePane(p, { type: 'symbol-results' }))
      await updatePane($, p => reducePane(p, { type: 'select', view: 'symbols.results', id: 'callers' })); return
    }
    await operation(async () => {
      const op = action === 'definition' ? 'goToDefinition' : 'findReferences'
      const parsed = await request(op, s.rel, selectedNode)
      if (!await current()) return
      const refs = parsed?.refs ?? await (op === 'goToDefinition' ? definitions((await symbolHost($, root)), root, selectedNode.name, s.rel) : references((await symbolHost($, root)), root, selectedNode.name))
      if (!await current()) return
      if (op === 'goToDefinition' && refs.length === 1) { await preview(refs[0]!.rel, refs[0]!.line); return }
      await showResults(`${op === 'goToDefinition' ? 'Definitions' : 'References'}: ${selectedNode.name}`, refs, !!parsed?.refs, op === 'findReferences' ? { rel: s.rel, node: selectedNode } : undefined)
    })
  }
  if (view === 'symbols') {
    for (const [i, { node, depth }] of nodes.entries()) rows.push({ id: `node-${i}`, el: row(`node-${i}`, `${' '.repeat(Math.min(depth * 2, Math.floor(inner / 3)))}${node.kind[0]} ${node.name}`, () => preview(s.rel, node.line)) })
    if (!nodes.length) rows.push({ id: 'notice', el: text(s.notice || (s.loading ? 'Loading outline…' : 'No symbols.')) })
  } else if (s.calls.length) {
    const appendCall = (item: JeiSymbols['calls'][number]): void => {
      rows.push({ id: item.id, el: row(item.id, `${' '.repeat(Math.min(item.depth * 2, Math.floor(inner / 3)))}${item.expanded ? '▾' : '▸'} ${item.name} · ${item.source === 'lsp' ? 'LSP' : 'approximate'}`, () => expand(item.id)) })
      if (item.expanded) for (const [i, ref] of item.refs.entries()) {
        const id = `${item.id}/${i}`
        const child = s.calls.find(c => c.id === id)
        if (child) { appendCall(child); continue }
        rows.push({ id, el: row(id, `${' '.repeat(Math.min((item.depth + 1) * 2, Math.floor(inner / 3)))}${ref.container ?? ref.text.trim()} ${ref.rel}:${ref.line}`, async () => {
          const fresh = await readSymbols($, root)
          if (fresh.calls.some(c => c.id === id)) return expand(id)
          const candidates = flatten(await fileOutline((await projectHost($, root)), root, ref.rel) ?? [])
          const node = candidates.find(c => c.node.line === ref.line)?.node
          if (!node) { await preview(ref.rel, ref.line); return }
          if (fresh.calls.length >= 2000) { $.ui.toast('Results truncated.'); return }
          await updateSymbols($, root, u => ({ ...u, calls: [...u.calls, { id, name: node.name, rel: ref.rel, node, direction: item.direction, depth: item.depth + 1, expanded: false, source: 'approximate', refs: [] }] }))
          await expand(id)
        }) })
      }
    }
    for (const item of s.calls.filter(item => !item.id.includes('/'))) appendCall(item)
  } else {
    let last = ''
    for (const [i, ref] of (s.result?.refs ?? []).entries()) {
      if (last !== ref.rel && frame.bodyRows > 3) { rows.push({ id: `group-${ref.rel}`, el: text(ref.rel) }); last = ref.rel }
      rows.push({ id: `ref-${i}`, el: row(`ref-${i}`, `${ref.line}: ${ref.container ? `${ref.container} · ` : ''}${ref.text.trim()}`, () => preview(ref.rel, ref.line)) })
    }
    if (!s.result?.refs.length) rows.push({ id: 'notice', el: text('No results.') })
  }
  if (s.permission && r.pending) rows.push({ id: 'permission', el: row('permission', 'Use LSP', async () => {
    const pending = r.pending
    if (!pending) return
    await operation(async () => {
      const parsed = await exact($, root, pending.input, true, pending.call)
      if (!parsed || !await current()) return
      if (pending.call) await publishCalls(pending.call, parsed.refs ?? [], 'lsp')
      else if (pending.input.operation === 'documentSymbol') await updateSymbols($, root, u => ({ ...u, nodes: parsed.symbols ?? u.nodes, source: parsed.symbols ? 'lsp' : 'approximate' }))
      else if (pending.input.operation === 'goToDefinition' && parsed.refs?.length === 1) await preview(parsed.refs[0]!.rel, parsed.refs[0]!.line)
      else await showResults(pending.input.operation === 'workspaceSymbol' ? `Symbols: ${s.query}` : `${pending.input.operation === 'goToDefinition' ? 'Definitions' : 'References'}: ${selectedNode?.name ?? ''}`, parsed.refs ?? [], true, pending.input.operation === 'findReferences' && selectedNode ? { rel: s.rel, node: selectedNode } : undefined)
    })
  }) })
  for (const k of KEYS[view]) if (/^[a-z0-9]$/.test(k.key) && k.action !== 'back') rows.push({ id: `command-${k.action}`, el: row(`command-${k.action}`, `${k.key} ${k.label}`, () => command(k.action)) })
  r.ids = rows.filter(row => !row.id.startsWith('group-') && row.id !== 'notice').map(row => row.id)
  const pinned: RenderElement[] = []
  if (s.editing) pinned.push(Input ? <Box flexDirection="row"><Text> </Text><Input key="symbols-find" placeholder="Find symbol" value={s.query} autoFocus onInput={value => act($, () => updateSymbols($, root, u => ({ ...u, query: value })) )()} onSubmit={value => act($, () => operation(async () => {
    const parsed = await exact($, root, await inputFor($, root, 'workspaceSymbol', s.rel, undefined, value))
    if (!await current()) return
    await showResults(`Symbols: ${value}`, parsed?.refs ?? await findSymbol((await symbolHost($, root)), root, value), !!parsed?.refs)
    if (await current()) await updateSymbols($, root, u => ({ ...u, query: value, editing: false }))
  }))()} /><Button key="symbols-cancel" plain label="Cancel" onPress={act($, () => leaveSymbolsEditor($))} /></Box> : text(`Find symbol: ${s.query} (input unavailable)`, 'symbols-find'))
  if (s.permission && frame.bodyRows > 5) pinned.push(text('Exact symbols need permission to use the LSP tool.'))
  if (s.loading && nodes.length) pinned.push(text('Loading LSP outline…', 'symbols-loading'))
  const title = view === 'symbols' ? s.rel ? `Outline: ${fitPath(s.rel, Math.max(1, inner - 24))}` : 'Outline' : s.result?.title ?? 'Symbols'
  const sourceLabel = view === 'symbols' ? s.source : s.calls.length ? s.calls.every(c => c.source === 'lsp') ? 'lsp' : s.calls.some(c => c.source === 'lsp') ? 'mixed' : 'approximate' : s.result?.source ?? 'approximate'
  const suffix = ` · ${sourceLabel === 'lsp' ? 'LSP' : sourceLabel === 'mixed' ? 'LSP / approximate' : 'approximate'}`, header = text(`${fitEnd(title, Math.max(0, inner - cellWidth(suffix)))}${suffix}`)
  if (e.props.scroll.bodyRows < 6 && frame.bodyRows > pinned.length) pinned.push(header)
  const top = windowTop(`${root}:${view}`, rows.map(row => row.id), selected, frame.bodyRows - pinned.length)
  return { header, body: [...pinned, ...rows.slice(top, top + Math.max(0, frame.bodyRows - pinned.length)).map(row => row.el)], actions: s.editing ? [] : KEYS[view].flatMap(k => /^[a-z0-9]$/.test(k.key) && k.action !== 'back' ? [{ key: k.key, run: act($, () => command(k.action)) }] : []), scrollable: rows.length > frame.bodyRows - pinned.length }
}
