import type { EngineInterface, RenderElement } from 'claude-code'
import { KEYS } from '../../core/keys.ts'
import { latest } from '../../core/latest.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { decodeUtf8 } from '../../core/search/rg.ts'
import { joinPath, nativeRel } from '../../core/shared/paths.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import { parseLsp, type LspOp } from '../../core/symbols/lsp.ts'
import { fileOutline, definitions, findSymbol, references, incoming, outgoing, symbolSendText } from '../../core/symbols/service.ts'
import type { SymbolNode } from '../../core/symbols/outline.ts'
import type { SymbolRef } from '../../core/symbols/approx.ts'
import type { JeiSymbols } from '../../types/index.d.ts'
import { onRefresh } from './activity.ts'
import { firstLine, projectHost, showPreview, windowTop, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { readActivity, readCwd, readPane, readSymbols, readTick, updatePane, updateSymbols } from './state.ts'

type Parsed = ReturnType<typeof parseLsp>
type Input = { operation: LspOp; filePath: string; line: number; character: number; query?: string }
type Runtime = { epoch: number; ids: string[]; focused?: string; pending?: Input; fresh: boolean; load: ReturnType<typeof latest<[() => Promise<unknown>], unknown>> }
const runtimes = new Map<string, Runtime>()
async function runtime($: EngineInterface, root: string): Promise<Runtime> {
  const key = `${await $.session.id()}\0${root}`
  let r = runtimes.get(key)
  if (!r) { r = { epoch: 0, ids: [], fresh: false, load: latest(async (run: () => Promise<unknown>) => run()) }; runtimes.set(key, r) }
  return r
}
onRefresh(() => {
  for (const r of runtimes.values()) { r.fresh = false; r.pending = undefined }
})
export async function stopSymbols($: EngineInterface): Promise<void> { if (runtimes.size) (await runtime($, await readCwd($))).epoch++ }
const flatten = (nodes: readonly SymbolNode[], depth = 0): { node: SymbolNode; depth: number }[] => nodes.flatMap(node => [{ node, depth }, ...flatten(node.children, depth + 1)])
function act($: EngineInterface, fn: () => Promise<unknown>): () => void { return () => { void fn().catch(err => $.ui.toast(firstLine(err))) } }

/** Full bounded UTF-8 read and realpath check before deriving a tool's one-based source position. */
async function source($: EngineInterface, root: string, rel: string): Promise<string | null> {
  const host = (await projectHost($, root)), safe = nativeRel(root, rel, host.platform)
  if (!safe) return null
  const path = joinPath(root, safe), [info, rootInfo] = await Promise.all([host.stat(path), host.stat(root)])
  if (!info || !rootInfo || info.kind !== 'file' || info.size > 4 * 1024 * 1024 || !Number.isSafeInteger(info.size) || info.size < 0 || nativeRel(rootInfo.realPath, info.realPath, host.platform) === null) return null
  const bytes = await host.readHead(path, info.size + 1)
  return bytes && bytes.length === info.size && !bytes.includes(0) ? decodeUtf8(bytes) : null
}
async function inputFor($: EngineInterface, root: string, operation: LspOp, rel: string, node?: SymbolNode, query?: string): Promise<Input | null> {
  const text = await source($, root, rel)
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
async function exact($: EngineInterface, root: string, input: Input | null, deliberate = false): Promise<Parsed> {
  if (!input) return null
  const r = await runtime($, root)
  const epoch = r.epoch
  const current = async () => r.epoch === epoch && await readCwd($) === root && (await readPane($)).tab === 'symbols'
  try {
    const verdict = await $.tool.check({ tool: 'LSP', input })
    if (!await current()) return null
    if (verdict.decision === 'ask' && !deliberate) {
      r.pending = input
      await updateSymbols($, root, s => ({ ...s, permission: true }))
      return null
    }
    if (verdict.decision === 'deny') { r.pending = undefined; await updateSymbols($, root, s => ({ ...s, permission: false })); return null }
    r.pending = undefined
    await updateSymbols($, root, s => ({ ...s, permission: false }))
    const result = await $.tool.call({ tool: 'LSP', ...input } as never)
    if (!await current()) return null
    if ('deny' in result || result.isError || !result.text) return null
    return parseLsp(input.operation, result.text, root, (await projectHost($, root)).platform)
  } catch { return null }
}

export async function enterSymbols($: EngineInterface): Promise<void> {
  const root = await readCwd($), pane = await readPane($), r = await runtime($, root), old = await readSymbols($, root)
  try { await projectHost($, root) } catch (err) { await updateSymbols($, root, s => ({ ...s, rel: '', nodes: [], source: 'approximate', notice: firstLine(err), busy: false })); return }
  const activity = await readActivity($)
  const touched = Object.entries(activity).sort((a, b) => b[1].at - a[1].at).map(([rel]) => rel)
  let rel = ''
  for (const candidate of [pane.selected.files, ...touched]) {
    if (candidate && await source($, root, candidate) !== null) { rel = candidate; break }
  }
  if (r.fresh && old.rel === rel) return
  r.fresh = true
  const epoch = ++r.epoch
  const result = await r.load(async () => {
    const nodes = rel ? await fileOutline((await projectHost($, root)), root, rel) : null
    const parsed = rel ? await exact($, root, await inputFor($, root, 'documentSymbol', rel)) : null
    return { nodes: parsed?.symbols ?? nodes ?? [], source: parsed?.symbols ? 'lsp' as const : 'approximate' as const, notice: !rel ? 'Select a file in Files.' : nodes === null && !parsed?.symbols ? 'No outline for this file type.' : '' }
  })
  if (!result.stale && r.epoch === epoch && await readCwd($) === root) {
    const data = result.value as Pick<JeiSymbols, 'nodes' | 'source' | 'notice'>
    await updateSymbols($, root, s => ({ ...s, ...data, rel, busy: false }))
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
    await updateSymbols($, root, s => ({ ...s, editing: false }))
    await updatePane($, s => reducePane(s, { type: 'select', view, id: key.slice(12) }))
  } else if (key === 'symbols-find' && !(await readSymbols($, root)).editing) await updateSymbols($, root, s => ({ ...s, editing: true }))
}
export async function scrollSymbols($: EngineInterface, by: number): Promise<boolean> {
  const pane = await readPane($), view = currentView(pane)
  if (view !== 'symbols' && view !== 'symbols.results') return false
  const root = await readCwd($), r = await runtime($, root)
  if ((await readSymbols($, root)).editing) return false
  const from = r.ids.indexOf(pane.selected[view] ?? ''), id = r.ids[Math.max(0, Math.min(r.ids.length - 1, from < 0 ? 0 : from + by))]
  if (id) {
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
  const selectedNode = nodes[Number((pane.selected.symbols ?? 'node-0').slice(5))]?.node
  let requestEpoch = r.epoch
  const current = async () => r.epoch === requestEpoch && await readCwd($) === root && (await readPane($)).tab === 'symbols'
  const text = (value: string, key?: string) => <Box key={key}><Text dimColor wrap="truncate-end">{inner ? ` ${fitEnd(value, inner)}` : ''}</Text></Box>
  const row = (id: string, label: string, run: () => Promise<unknown>, key = `symbols-row-${id}`) => <Box flexDirection="row"><Text> </Text><Button key={key} plain onPress={act($, run)}><Text inverse={selected === id && !(frame.isFocused && r.focused === key)} wrap="truncate-end">{fitEnd(label, inner)}</Text></Button></Box>
  const showResults = async (title: string, refs: SymbolRef[], exact: boolean) => {
    if (!await current()) return
    await updateSymbols($, root, u => ({ ...u, result: { title, refs, source: exact ? 'lsp' : 'approximate' }, calls: [], editing: false }))
    await updatePane($, p => reducePane(p, { type: 'symbol-results' }))
  }
  const request = async (operation: LspOp, rel: string, node: SymbolNode, deliberate = false) => exact($, root, await inputFor($, root, operation, rel, node), deliberate)
  const expand = async (id: string) => {
    const fresh = await readSymbols($, root), item = fresh.calls.find(item => item.id === id)
    if (!item || fresh.busy) return
    if (item.expanded) { await updateSymbols($, root, u => ({ ...u, calls: u.calls.map(c => c.id === id ? { ...c, expanded: false } : c) })); return }
    await operation(async () => {
      const parsed = await request(item.direction, item.rel, item.node)
      if (!await current()) return
      const refs = parsed?.refs ?? await (item.direction === 'incomingCalls' ? incoming((await projectHost($, root)), root, item.node.name) : outgoing((await projectHost($, root)), root, item.rel, item.node))
      if (!await current()) return
      const room = Math.max(0, 2000 - fresh.calls.filter(c => c.id !== id).reduce((n, c) => n + c.refs.length, 0))
      if (refs.length > room) $.ui.toast('Results truncated.')
      await updateSymbols($, root, u => ({ ...u, calls: u.calls.map(c => c.id === id ? { ...c, expanded: true, refs: refs.slice(0, room), source: parsed?.refs ? 'lsp' : 'approximate' } : c) }))
    })
  }
  const operation = async (fn: () => Promise<unknown>) => {
    if ((await readSymbols($, root)).busy) return
    const epoch = ++r.epoch
    requestEpoch = epoch
    await updateSymbols($, root, u => ({ ...u, busy: true }))
    try { await fn() } finally { if (r.epoch === epoch) await updateSymbols($, root, u => ({ ...u, busy: false })) }
  }
  const command = async (action: string) => {
    if (s.busy) return
    if (action === 'find-symbol') { await updateSymbols($, root, u => ({ ...u, editing: true })); await $.ui.focus({ requestId: 'jei', key: 'symbols-find' }).catch(() => {}); return }
    if (action === 'send') {
      if (!selectedNode) return
      const refs = s.result?.refs ?? await references((await projectHost($, root)), root, selectedNode.name)
      return fill($, symbolSendText(selectedNode.name, { rel: s.rel, line: selectedNode.line, text: selectedNode.name, container: null }, refs))
    }
    if (!selectedNode || !s.rel) { $.ui.toast('Select a symbol first.'); return }
    if (action === 'calls') {
      await updateSymbols($, root, u => ({ ...u, result: { title: `Calls: ${selectedNode.name}`, source: 'approximate', refs: [] }, calls: ['incomingCalls', 'outgoingCalls'].map((direction, i) => ({ id: i ? 'calls' : 'callers', name: i ? 'Calls' : 'Callers', rel: s.rel, node: selectedNode, direction: direction as 'incomingCalls' | 'outgoingCalls', depth: 0, expanded: false, source: 'approximate', refs: [] })) }))
      await updatePane($, p => reducePane(p, { type: 'symbol-results' })); return
    }
    await operation(async () => {
      const op = action === 'definition' ? 'goToDefinition' : 'findReferences'
      const parsed = await request(op, s.rel, selectedNode)
      if (!await current()) return
      const refs = parsed?.refs ?? await (op === 'goToDefinition' ? definitions((await projectHost($, root)), root, selectedNode.name, s.rel) : references((await projectHost($, root)), root, selectedNode.name))
      if (!await current()) return
      if (op === 'goToDefinition' && refs.length === 1) { await showPreview($, refs[0]!.rel, refs[0]!.line); return }
      await showResults(`${op === 'goToDefinition' ? 'Definitions' : 'References'}: ${selectedNode.name}`, refs, !!parsed?.refs)
    })
  }
  if (view === 'symbols') {
    for (const [i, { node, depth }] of nodes.entries()) rows.push({ id: `node-${i}`, el: row(`node-${i}`, `${' '.repeat(Math.min(depth * 2, Math.floor(inner / 3)))}${node.kind[0]} ${node.name}`, () => showPreview($, s.rel, node.line)) })
    if (!nodes.length) rows.push({ id: 'notice', el: text(s.notice || 'No symbols.') })
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
          if (!node) { await showPreview($, ref.rel, ref.line); return }
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
      rows.push({ id: `ref-${i}`, el: row(`ref-${i}`, `${ref.line}: ${ref.container ? `${ref.container} · ` : ''}${ref.text.trim()}`, () => showPreview($, ref.rel, ref.line)) })
    }
    if (!s.result?.refs.length) rows.push({ id: 'notice', el: text('No results.') })
  }
  if (s.permission && r.pending) rows.push({ id: 'permission', el: row('permission', 'Use LSP', async () => {
    const input = r.pending
    if (!input) return
    const parsed = await exact($, root, input, true)
    if (!parsed) return
    if (input.operation === 'documentSymbol') await updateSymbols($, root, u => ({ ...u, nodes: parsed.symbols ?? u.nodes, source: parsed.symbols ? 'lsp' : 'approximate' }))
    else await showResults(input.operation, parsed.refs ?? [], true)
  }, 'symbols-use-lsp') })
  for (const k of KEYS[view]) if (/^[a-z0-9]$/.test(k.key) && k.action !== 'back') rows.push({ id: `command-${k.action}`, el: row(`command-${k.action}`, `${k.key} ${k.label}`, () => command(k.action)) })
  r.ids = rows.filter(row => !row.id.startsWith('group-') && row.id !== 'notice').map(row => row.id)
  const pinned: RenderElement[] = []
  if (s.editing) pinned.push(Input ? <Box flexDirection="row"><Text> </Text><Input key="symbols-find" placeholder="Find symbol" value={s.query} autoFocus onInput={value => act($, () => updateSymbols($, root, u => ({ ...u, query: value })) )()} onSubmit={value => act($, () => operation(async () => {
    const parsed = await exact($, root, await inputFor($, root, 'workspaceSymbol', s.rel, undefined, value))
    if (!await current()) return
    await showResults(`Symbols: ${value}`, parsed?.refs ?? await findSymbol((await projectHost($, root)), root, value), !!parsed?.refs)
    if (await current()) await updateSymbols($, root, u => ({ ...u, query: value, editing: false }))
  }))()} /><Button key="symbols-cancel" plain label="Cancel" onPress={act($, () => leaveSymbolsEditor($))} /></Box> : text(`Find symbol: ${s.query} (input unavailable)`, 'symbols-find'))
  if (s.permission && frame.bodyRows > 5) pinned.push(text('Exact symbols need permission to use the LSP tool.'))
  const title = view === 'symbols' ? s.rel ? `Outline: ${fitPath(s.rel, Math.max(1, inner - 24))}` : 'Outline' : s.result?.title ?? 'Symbols'
  const sourceLabel = view === 'symbols' ? s.source : s.result?.source ?? 'approximate'
  const suffix = ` · ${sourceLabel === 'lsp' ? 'LSP' : 'approximate'}`, header = text(`${fitEnd(title, Math.max(0, inner - cellWidth(suffix)))}${suffix}`)
  if (e.props.scroll.bodyRows < 6 && frame.bodyRows > pinned.length) pinned.push(header)
  const top = windowTop(`${root}:${view}`, rows.map(row => row.id), selected, frame.bodyRows - pinned.length)
  return { header, body: [...pinned, ...rows.slice(top, top + Math.max(0, frame.bodyRows - pinned.length)).map(row => row.el)], actions: s.editing ? [] : KEYS[view].flatMap(k => /^[a-z0-9]$/.test(k.key) && k.action !== 'back' ? [{ key: k.key, run: act($, () => command(k.action)) }] : []) }
}
