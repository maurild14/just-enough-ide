import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { ActivityLog } from '../../core/activity/log.ts'
import { diffWindow, parseUnifiedDiff } from '../../core/git/diff.ts'
import { KEYS } from '../../core/keys.ts'
import { currentView, type PaneState, type PaneAction } from '../../core/pane.ts'
import { parseQuery, rankFiles } from '../../core/search/quickopen.ts'
import { previewText, type ReplaceFile, type Skipped } from '../../core/search/replace.ts'
import { parseGlobs, type Match, type SearchQuery } from '../../core/search/rg.ts'
import { sendText } from '../../core/search/results.ts'
import { cellWidth, fitEnd, fitPath, printable } from '../../core/shared/fit.ts'
import { nativeRel } from '../../core/shared/paths.ts'
import { handToAgent } from './hand-off.ts'
import type { JeiRpc } from './rpc.ts'

type SearchState = { text: string; globs: string; replacement: string; caseSensitive: boolean; regex: boolean; wholeWord: boolean; matches: Match[]; summary: string; engine: string; planId: string; files: ReplaceFile[]; skipped: Skipped[]; busy: boolean; applying: boolean; serial: number; revision: number }
const initial = (): SearchState => ({ text: '', globs: '', replacement: '', caseSensitive: false, regex: false, wholeWord: false, matches: [], summary: '', engine: 'rg', planId: '', files: [], skipped: [], busy: false, applying: false, serial: 0, revision: -1 })
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid Search reply.'); return v as Record<string, unknown> }
function rel(v: unknown): string { if (typeof v !== 'string' || !v || v.includes('\0') || nativeRel('', v, 'linux') !== v) throw new Error('Invalid Search path.'); return v }
function strings(v: unknown): string[] { if (!Array.isArray(v) || !v.every((x): x is string => typeof x === 'string')) throw new Error('Invalid Search reply.'); return v }
function matches(v: unknown): Match[] {
  if (!Array.isArray(v) || v.length > 200) throw new Error('Invalid Search reply.')
  return v.map(raw => {
    const m = record(raw)
    if (!natural(m.line) || !m.line || typeof m.text !== 'string' || !Array.isArray(m.ranges)) throw new Error('Invalid Search reply.')
    const ranges = m.ranges.map((r): [number, number] => { if (!Array.isArray(r) || r.length !== 2 || !natural(r[0]) || !natural(r[1]) || r[1] < r[0] || r[1] > (m.text as string).length) throw new Error('Invalid Search reply.'); return [r[0], r[1]] })
    return { rel: rel(m.rel), line: m.line, text: m.text, ranges }
  })
}
function skips(v: unknown): Skipped[] {
  if (!Array.isArray(v)) throw new Error('Invalid Search reply.')
  return v.map(raw => { const s = record(raw); if (typeof s.reason !== 'string' || !['binary', 'not-utf8', 'changed', 'regex-differs', 'outside-root', 'too-large', 'unreadable', 'unsupported-path'].includes(s.reason)) throw new Error('Invalid Search reply.'); return { rel: rel(s.rel), reason: s.reason as Skipped['reason'] } })
}

export function Search(props: {
  ctx: Plugin.Context; api: RpcClient<typeof JeiRpc>; sessionID: string; cwd: string; state: PaneState; dispatch: (a: PaneAction) => void
  activity: ActivityLog; revision: number; refresh: () => Promise<void>; width: number; height: number; header: boolean; focused: boolean
  bind: (run: (action: string) => void, editing: () => boolean) => void
}) {
  const [s, update] = props.ctx.storage.memory<SearchState>(`jei.search.${props.sessionID}\0${props.cwd}`, { initial: initial() })
  const [editing, setEditing] = createSignal<'query' | 'globs' | 'replacement' | null>(s.text ? null : 'query')
  const [files, setFiles] = createSignal<string[]>([])
  const [quickError, setQuickError] = createSignal('')
  const [quickLoading, setQuickLoading] = createSignal(false)
  const [expanded, setExpanded] = createSignal<string[]>(s.files.map(f => f.rel))
  const [top, setTop] = createSignal(0)
  let stopped = false, epoch = 0, runId = '', listTop = 0
  let timer: ReturnType<typeof setTimeout> | undefined, pending: AbortController | undefined
  const view = createMemo(() => currentView(props.state)), quick = createMemo(() => view() === 'quickopen'), replacing = createMemo(() => view() === 'search.replace')
  const theme = () => props.ctx.theme, inner = () => Math.max(0, props.width - 2)
  const compact = () => props.height <= 3
  const query = (): SearchQuery => ({ text: s.text, caseSensitive: s.caseSensitive, regex: s.regex, wholeWord: s.wholeWord, ...parseGlobs(s.globs) })
  const selected = () => props.state.selected[view()]
  function stop() {
    epoch++; clearTimeout(timer); pending?.abort(); pending = undefined
    if (runId) { const id = runId; runId = ''; void props.api.searchCancel({ sessionID: props.sessionID, id }).catch(() => {}) }
    if (!s.applying) update(d => { d.busy = false })
  }
  function restart() {
    stop()
    if (quick() || replacing()) return
    const generation = epoch
    update(d => { d.matches = []; d.summary = '' })
    if (!s.text && !s.regex) return
    timer = setTimeout(() => {
      if (stopped || generation !== epoch) return
      update(d => { d.serial++; d.busy = true; d.summary = 'Searching…' })
      const id = String(s.serial); runId = id
      void props.api.searchStart({ sessionID: props.sessionID, id, query: query() }).catch(error => { if (!stopped && generation === epoch) { runId = ''; update(d => { d.busy = false; d.summary = reason(error) }) } })
    }, 150)
  }
  const reason = (error: unknown) => error instanceof Error ? error.message.split(/\r?\n/)[0]! : 'Unable to complete Search.'
  function fail(error: unknown) { if (!stopped) props.ctx.ui.toast.show({ message: fitEnd(reason(error), Math.max(1, props.width)), variant: 'error' }) }
  const offMatches = props.api.events.on('searchMatches', event => {
    try { const e = record(event.data); if (e.sessionID !== props.sessionID || e.id !== runId || !runId || stopped) return; const batch = matches(e.matches), first = s.matches.length === 0; update(d => { d.matches = [...d.matches, ...batch].slice(0, 2000) }); if (first && batch.length) props.dispatch({ type: 'select', view: 'search', id: 'match-0' }) } catch (error) { stop(); update(d => { d.summary = reason(error) }) }
  })
  const offDone = props.api.events.on('searchDone', event => {
    try {
      const e = record(event.data); if (e.sessionID !== props.sessionID || e.id !== runId || !runId || stopped) return
      if ((e.engine !== 'rg' && e.engine !== 'git grep') || !(e.error === null || typeof e.error === 'string') || typeof e.ms !== 'number' || !Number.isFinite(e.ms) || e.ms < 0 || typeof e.truncated !== 'boolean') throw new Error('Invalid Search reply.')
      runId = ''; update(d => { d.busy = false; d.engine = e.engine as string; d.summary = (e.error as string | null) || (e.truncated ? 'Results truncated.' : d.matches.length ? `${d.matches.length} results in ${new Set(d.matches.map(m => m.rel)).size} files · ${e.ms} ms` : 'No results.') })
    } catch (error) { stop(); update(d => { d.summary = reason(error) }) }
  })
  createEffect(() => {
    const revision = props.revision
    if (quick()) {
      const controller = new AbortController(); setQuickError(''); setQuickLoading(true)
      void props.api.quickOpenFiles({}, { signal: controller.signal }).then(raw => { if (!stopped && !controller.signal.aborted) setFiles(strings(record(raw).files).slice(0, 50_000).map(rel)) }).catch(error => { if (!stopped && !controller.signal.aborted) setQuickError(reason(error)) }).finally(() => { if (!stopped && !controller.signal.aborted) setQuickLoading(false) })
      onCleanup(() => controller.abort())
    } else if (s.revision !== revision && !replacing()) { update(d => { d.revision = revision }); if (s.text || s.regex) restart() }
  })
  const ranked = createMemo(() => rankFiles(parseQuery(s.text).name, files(), { touched: new Set(Object.keys(props.activity.toJSON())), recent: props.state.recent }, 200))
  type Row = { id: string; label?: string; match?: Match; passive?: boolean; diff?: string }
  const rows = createMemo(() => {
    const all: Row[] = []
    if (replacing()) {
      for (const file of s.files) {
        all.push({ id: file.rel, label: `${file.rel} (${file.count})` }, { id: `toggle:${file.rel}`, label: `${expanded().includes(file.rel) ? '▾ Collapse' : '▸ Expand'} diff` })
        if (expanded().includes(file.rel) && selected() === file.rel && !compact()) {
          const diff = parseUnifiedDiff(previewText(file))[0]
          if (diff) for (const [i, line] of diffWindow(diff, top(), Math.max(1, Math.min(6, props.height - 2))).text.trimEnd().split('\n').entries()) all.push({ id: `diff:${i}`, diff: line, passive: true })
        }
      }
      if (s.skipped.length) all.push({ id: 'skipped', label: 'Not replaced', passive: true })
      for (const skip of s.skipped) all.push({ id: `skip:${skip.rel}`, label: `${skip.rel}: ${skip.reason}` })
    } else if (quick()) for (const [i, path] of ranked().entries()) all.push({ id: `file-${i}`, label: `${props.activity.touched(path) ? '•' : ' '} ${path}` })
    else {
      let previous = ''; const counts = new Map<string, number>(); for (const m of s.matches) counts.set(m.rel, (counts.get(m.rel) ?? 0) + 1)
      for (const [i, m] of s.matches.entries()) { if (!compact() && m.rel !== previous) all.push({ id: `group:${m.rel}`, label: `${m.rel} (${counts.get(m.rel)})`, passive: true }); previous = m.rel; all.push({ id: `match-${i}`, match: m }) }
    }
    if (!all.length) all.push({ id: 'notice', label: quick() ? quickError() || 'Type to find a file.' : s.summary || (replacing() ? 'No replacements.' : 'Type to search the project.'), passive: true })
    if (!replacing()) all.push({ id: 'command:edit', label: 'Edit query' })
    for (const key of KEYS[view()]) if (/^[a-z]$/.test(key.key) && key.action !== 'back') all.push({ id: `command:${key.action}`, label: `${key.key} ${key.label}` })
    return all
  })
  const selectable = () => rows().filter(r => !r.passive)
  createEffect(() => { if (quick() && quickLoading()) return; if (!selectable().some(r => r.id === selected())) { const first = selectable()[0]; if (first) props.dispatch({ type: 'select', view: view(), id: first.id }) } })
  const pinned = () => !replacing() ? 1 + (!compact() && !quick() ? 1 : 0) : props.header ? 1 : 0
  const room = () => Math.max(0, props.height - pinned() - (!compact() && !quick() && !replacing() && s.summary ? 1 : 0))
  const window = createMemo(() => { const all = rows(), at = all.findIndex(r => r.id === selected()); if (at >= 0) listTop = Math.min(Math.max(listTop, at - room() + 1), at); listTop = Math.max(0, Math.min(listTop, all.length - room())); return all.slice(listTop, listTop + room()) })
  const preview = (path: string, line?: number) => { stop(); props.dispatch({ type: 'preview', rel: path, ...(line ? { line } : {}) }) }
  async function apply(rels: string[]) {
    if (s.busy || !rels.length) return
    const generation = epoch, files = s.files.filter(f => rels.includes(f.rel)), planId = s.planId
    update(d => { d.busy = true })
    try {
      const count = files.reduce((n, f) => n + f.count, 0)
      if (!await props.ctx.ui.dialog.confirm({ title: 'Replace', message: `Replace ${count} matches in ${files.length === 1 ? files[0]!.rel : `${files.length} files`}?` }) || stopped || generation !== epoch) return
      update(d => { d.applying = true })
      const raw = record(await props.api.replaceApply({ sessionID: props.sessionID, planId, rels })), written = strings(raw.written).map(rel), skipped = skips(raw.skipped)
      if (written.some(path => !rels.includes(path)) || raw.error !== undefined && typeof raw.error !== 'string') throw new Error('Invalid Search reply.')
      const replaced = files.filter(f => written.includes(f.rel)).reduce((n, f) => n + f.count, 0)
      update(d => { d.skipped = [...d.skipped, ...skipped]; d.files = d.files.filter(f => !written.includes(f.rel) && !skipped.some(s => s.rel === f.rel)) })
      if (!stopped) props.ctx.ui.toast.show({ message: `Replaced ${replaced} matches in ${written.length} files.${raw.error ? ` ${raw.error}` : ''}`, variant: raw.error ? 'error' : 'info' })
    } finally { try { await props.refresh() } finally { update(d => { d.applying = false; d.busy = false }) } }
  }
  async function submit() {
    if (s.applying) return
    const field = editing(); setEditing(null)
    if (quick()) { const path = ranked()[0]; if (path) preview(path, parseQuery(s.text).line ?? undefined); return }
    if (field !== 'replacement') return
    if (s.busy) stop()
    const generation = epoch; pending = new AbortController(); update(d => { d.busy = true })
    try {
      const raw = record(await props.api.replacePlan({ sessionID: props.sessionID, query: query(), replacement: s.replacement }, { signal: pending.signal }))
      if (stopped || generation !== epoch) return
      if (typeof raw.planId !== 'string' || !Array.isArray(raw.files)) throw new Error('Invalid Search reply.')
      const files = raw.files.map((raw): ReplaceFile => { const f = record(raw); if (typeof f.before !== 'string' || typeof f.after !== 'string' || !natural(f.count) || !f.count) throw new Error('Invalid Search reply.'); return { rel: rel(f.rel), before: f.before, after: f.after, count: f.count } })
      const skipped = skips(raw.skipped)
      update(d => { d.planId = raw.planId as string; d.files = files; d.skipped = skipped }); setExpanded(files.map(f => f.rel)); setTop(0); props.dispatch({ type: 'replace' })
    } finally { if (generation === epoch) update(d => { d.busy = false }) }
  }
  async function run(action: string): Promise<void> {
    if (action === 'back') { if (editing()) { stop(); setEditing(null) } else { stop(); props.dispatch({ type: 'back' }) }; return }
    if (action === 'move-up' || action === 'move-down' || action === 'scroll-up' || action === 'scroll-down') {
      setEditing(null)
      const file = replacing() && expanded().includes(selected() ?? '') ? s.files.find(f => f.rel === selected()) : undefined
      const diff = file ? parseUnifiedDiff(previewText(file))[0] : undefined
      if (diff && !compact()) { const next = top() + (action.endsWith('up') ? -1 : 1), total = diffWindow(diff, 0, 1).total; if (next >= 0 && next < total) { setTop(next); return } }
      const all = selectable(), at = all.findIndex(r => r.id === selected()), next = all[Math.max(0, Math.min(all.length - 1, at + (action.endsWith('up') ? -1 : 1)))]
      if (next) { setTop(0); props.dispatch({ type: 'select', view: view(), id: next.id }) }; return
    }
    if (s.applying || s.busy && replacing()) return
    const id = selected() ?? ''
    if ((action === 'activate' || action === 'apply-file') && id.startsWith('command:')) return run(id.slice(8))
    if (action === 'edit') { setEditing('query'); return }
    if (action === 'include' || action === 'replace') { setEditing(action === 'include' ? 'globs' : 'replacement'); return }
    if (action.startsWith('toggle-')) { const field = action === 'toggle-case' ? 'caseSensitive' : action === 'toggle-regex' ? 'regex' : 'wholeWord'; update(d => { d[field] = !d[field] }); restart(); return }
    if (action === 'quickopen' || action === 'search') { stop(); update(d => { d.text = '' }); setEditing('query'); props.dispatch(action === 'quickopen' ? { type: 'quickopen' } : { type: 'back' }); return }
    if (action === 'apply-file') {
      if (id.startsWith('toggle:')) { const path = id.slice(7); setExpanded(old => old.includes(path) ? old.filter(p => p !== path) : [...old, path]); return }
      return apply(s.files.some(f => f.rel === id) ? [id] : [])
    }
    if (action === 'apply-all') return apply(s.files.map(f => f.rel))
    if (action === 'activate') { if (quick()) { const path = ranked()[Number(id.slice(5))]; if (path) preview(path, parseQuery(s.text).line ?? undefined) } else { const m = s.matches[Number(id.slice(6))]; if (m) preview(m.rel, m.line) }; return }
    if (action === 'mention') { if (quick()) { const path = ranked()[Number(id.slice(5))]; if (path) await handToAgent(props.ctx, props.sessionID, `@${path} `) } else { const m = s.matches[Number(id.slice(6))]; if (m) await handToAgent(props.ctx, props.sessionID, sendText(s.text, [m])) }; return }
    if (action === 'send-all') return handToAgent(props.ctx, props.sessionID, sendText(s.text, s.matches))
    if (action === 'ask') {
      const text = `Replace ${JSON.stringify(s.text)} with ${JSON.stringify(s.replacement)} in: `
      const locations = s.matches.map(m => `${m.rel}:${m.line}`); let result = text, count = 0
      for (const location of locations) { const suffix = `, …and ${locations.length - count - 1} more.`; if (result.length + location.length + 2 + suffix.length > 12_000) break; result += (count ? ', ' : '') + location; count++ }
      if (count < locations.length) result = result.slice(0, 11_950) + `, …and ${locations.length - count} more.`
      return handToAgent(props.ctx, props.sessionID, result.slice(0, 12_000))
    }
  }
  const invoke = (action: string) => { void run(action).catch(fail) }
  props.bind(invoke, () => editing() !== null)
  onCleanup(() => { stopped = true; stop(); offMatches(); offDone(); props.bind(() => {}, () => false) })
  const field = () => editing() ?? 'query'
  const fieldValue = () => field() === 'query' ? s.text : field() === 'globs' ? s.globs : s.replacement
  const markers = () => compact() && !quick() && field() === 'query' ? [s.caseSensitive ? '[Aa]' : '', s.regex ? '[.*]' : '', s.wholeWord ? '[\\b]' : '', s.engine === 'git grep' ? 'git grep' : '', s.summary === 'Results truncated.' ? 'truncated' : ''].filter(Boolean).join(' ') : ''
  const change = (value: string) => { const key = field() === 'query' ? 'text' : field() === 'globs' ? 'globs' : 'replacement'; if (s[key] === value) return; update(d => { d[key] = value }); if (key !== 'replacement' && !quick()) restart() }
  function matchSpans(m: Match) {
    const prefix = `${m.line}: `, width = Math.max(0, inner() - cellWidth(prefix)), first = m.ranges[0]?.[0] ?? 0
    let from = Math.max(0, first - Math.floor(width / 3)); if (/[\uDC00-\uDFFF]/.test(m.text[from] ?? '')) from--
    const text = fitEnd(m.text.slice(from), Math.max(0, width - (from ? 1 : 0))), visible = text.endsWith('…') ? text.slice(0, -1) : text
    const pieces: { text: string; hit?: boolean }[] = [{ text: prefix + (from ? '…' : '') }]; let at = 0
    for (const [start, end] of m.ranges) { const a = Math.max(at, start - from), b = Math.min(visible.length, end - from); if (a > visible.length) break; if (b < a) continue; pieces.push({ text: visible.slice(at, a) }, { text: visible.slice(a, b), hit: true }); at = b }
    pieces.push({ text: visible.slice(at) + (visible !== text ? '…' : '') }); return pieces.map(p => ({ ...p, text: printable(p.text) }))
  }
  return <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
    <Show when={!replacing()} fallback={<Show when={props.header}><text height={1}>{' Replace preview'}</text></Show>}>
      <box height={1} flexShrink={0} flexDirection="row">
        <Show when={markers()}><text fg={theme().text.muted}>{fitEnd(markers(), Math.max(0, props.width - 12)) + ' '}</text></Show>
        <input id={`search-${field()}`} width={Math.max(1, props.width - (editing() ? 8 : 1) - (markers() ? Math.min(cellWidth(markers()), Math.max(0, props.width - 12)) + 1 : 0))} focused={props.focused && editing() !== null} value={fieldValue()} placeholder={field() === 'replacement' ? 'Replace with' : field() === 'globs' ? 'Include/exclude: src/** !**/*.test.ts' : quick() ? 'Go to file' : 'Search'} onInput={change} onSubmit={() => { void submit().catch(fail) }} onMouseDown={() => setEditing(field())} on:focused={() => setEditing(field())} on:blurred={() => setEditing(null)} />
        <Show when={editing()}><text fg={theme().text.action.primary.base} onMouseDown={() => invoke('back')}> Cancel</text></Show>
      </box>
      <Show when={!compact() && !quick()}><text height={1} flexShrink={0} fg={theme().text.muted}>{fitEnd(` ${s.caseSensitive ? '[Aa]' : 'Aa'} ${s.regex ? '[.*]' : '.*'} ${s.wholeWord ? '[\\b]' : '\\b'} ${s.globs}${s.engine === 'git grep' ? ' · git grep (first match per line)' : ''}`, props.width)}</text></Show>
    </Show>
    <For each={window()}>{row => <text id={`search-row-${row.id}`} height={1} flexShrink={0} bg={row.id === selected() ? theme().background?.action.primary.base : undefined} onMouseDown={() => { if (!row.passive) { setEditing(null); props.dispatch({ type: 'select', view: view(), id: row.id }); invoke(replacing() ? 'apply-file' : 'activate') } }}>
      {' '}<Show when={row.match} fallback={<span style={{ fg: row.diff ? row.diff.startsWith('+') ? theme().diff?.text.added : row.diff.startsWith('-') ? theme().diff?.text.removed : theme().diff?.text.hunkHeader : row.passive ? theme().text.muted : theme().text.base }}>{row.diff ? fitEnd(row.diff, inner()) : row.label?.includes('/') ? fitPath(row.label, inner()) : fitEnd(row.label ?? '', inner())}</span>}>{(m: () => Match) => <For each={matchSpans(m())}>{p => <span style={{ fg: p.hit ? theme().text.action.primary.base : theme().text.base }}>{p.text}</span>}</For>}</Show>
    </text>}</For>
    <Show when={!compact() && !quick() && !replacing() && s.summary}><text height={1} flexShrink={0} fg={theme().text.muted}>{fitEnd(s.summary + (s.engine === 'git grep' ? ' · git grep' : ''), props.width)}</text></Show>
  </box>
}
