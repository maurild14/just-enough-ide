import type { EngineInterface, RenderElement, Timer } from 'claude-code'
import { KEYS } from '../../core/keys.ts'
import { latest } from '../../core/latest.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { parseGlobs, type Match, type SearchQuery } from '../../core/search/rg.ts'
import { replaceAskText, sendText } from '../../core/search/results.ts'
import { parseQuery, rankFiles } from '../../core/search/quickopen.ts'
import { previewText } from '../../core/search/replace.ts'
import { applyReplace, buildReplacePlan, quickOpenFiles, search } from '../../core/search/service.ts'
import { diffWindow, parseUnifiedDiff } from '../../core/git/diff.ts'
import { fitEnd, fitPath, printable } from '../../core/shared/fit.ts'
import { toPosix } from '../../core/shared/paths.ts'
import type { JeiSearch } from '../../types/index.d.ts'
import { mutationGuard, onRefresh, refreshAfterChange } from './activity.ts'
import { firstLine, projectHost, showPreview, windowTop, type FilesAction, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { readActivity, readCwd, readPane, readSearch, readTick, updatePane, updateSearch } from './state.ts'
import { color } from './theme.ts'

type SearchDone = Awaited<ReturnType<typeof search>['done']>
type Run = { epoch: number; timer?: Timer; paint?: Timer; stream?: ReturnType<typeof search>; ids: string[]; data?: Record<string, string>; focused?: string; files?: Promise<string[]>; diffTotal?: number; diffRows?: number; done: ReturnType<typeof latest<[Promise<SearchDone>], SearchDone>> }
const runs = new Map<string, Run>()
const queryOf = (s: JeiSearch): SearchQuery => ({ text: s.text, caseSensitive: false, regex: false, wholeWord: false, ...parseGlobs(s.globs) })
async function runtime($: EngineInterface, root: string): Promise<Run> {
  const key = `${await $.session.id()}\0${root}`
  let r = runs.get(key)
  if (!r) { r = { epoch: 0, ids: [], done: latest(async (p: Promise<Awaited<ReturnType<typeof search>['done']>>) => p) }; runs.set(key, r) }
  return r
}
onRefresh(() => { for (const r of runs.values()) r.files = undefined })
function stop(r: Run): void { r.epoch++; r.timer?.cancel(); r.paint?.cancel(); r.stream?.cancel(); r.timer = r.paint = undefined; r.stream = undefined }
export async function stopSearch($: EngineInterface, closing = false): Promise<void> {
  if (!runs.size) return
  const root = await readCwd($), r = await runtime($, root)
  stop(r)
  if (closing) r.files = undefined
  await updateSearch($, root, s => s.busy ? { ...s, busy: false, summary: s.summary === 'Searching…' ? 'Search canceled.' : s.summary } : s)
}

/** Only event handlers schedule work: drawing reads retained results without starting a process. */
export async function restartSearch($: EngineInterface, immediate = false): Promise<void> {
  const root = await readCwd($), r = await runtime($, root)
  stop(r)
  const epoch = r.epoch
  const alive = async () => r.epoch === epoch && await readCwd($) === root
  const start = async () => {
    if (!await alive()) return
    const s = await readSearch($, root)
    if (!s.text) { await updateSearch($, root, u => ({ ...u, matches: [], summary: '', busy: false })); return }
    const matches: Match[] = []
    if (!await alive()) return
    await updateSearch($, root, u => r.epoch === epoch ? { ...u, matches: [], summary: 'Searching…', busy: true } : u)
    const paint = async () => { r.paint = undefined; if (await alive()) await updateSearch($, root, u => ({ ...u, matches: [...matches] })) }
    const host = await projectHost($, root)
    if (!await alive()) return
    const stream = search(host, root, queryOf(s), match => {
      if (r.epoch !== epoch) return
      matches.push(match)
      if (!r.paint) r.paint = $.clock.after(100, () => { void paint().catch(err => $.ui.log(`jei: ${firstLine(err)}`)) })
    })
    r.stream = stream
    const result = await r.done(stream.done)
    if (result.stale || !await alive()) return
    r.paint?.cancel(); r.paint = undefined; r.stream = undefined
    const value = result.value, files = new Set(matches.map(m => m.rel)).size
    await updateSearch($, root, u => ({ ...u, matches: [...matches], engine: value.engine, busy: false,
      summary: value.error || (value.truncated ? 'Results truncated.' : !matches.length ? 'No results.' : `${matches.length} results in ${files} files · ${value.ms} ms`) }))
  }
  r.timer = $.clock.after(immediate ? 1 : 150, () => { r.timer = undefined; void start().catch(async err => { if (await alive()) await updateSearch($, root, u => ({ ...u, busy: false, summary: firstLine(err) })) }) })
}

export async function searchEditing($: EngineInterface): Promise<boolean> {
  const view = currentView(await readPane($))
  return ['search', 'quickopen', 'search.replace'].includes(view) && (await readSearch($, await readCwd($))).editing !== null
}
export async function leaveSearchEditor($: EngineInterface): Promise<boolean> {
  const root = await readCwd($), s = await readSearch($, root)
  if (!s.editing && !s.confirm) return false
  await updateSearch($, root, u => ({ ...u, editing: null, confirm: null }))
  return true
}
export async function focusSearch($: EngineInterface, key: string | undefined): Promise<void> {
  const pane = await readPane($), view = currentView(pane)
  if (!['search', 'quickopen', 'search.replace'].includes(view)) return
  const root = await readCwd($), r = await runtime($, root)
  r.focused = key
  if (key?.startsWith('search-row-')) {
    const id = key.slice(11), s = await readSearch($, root), subject = r.data?.[id], mode = view as 'search' | 'quickopen' | 'search.replace'
    if (s.editing || subject !== undefined && s.subject?.[mode] !== subject) await updateSearch($, root, s => ({ ...s, editing: null, ...(subject === undefined ? {} : { subject: { ...s.subject, [mode]: subject } }) }))
    if (pane.selected[view] !== id) await updatePane($, s => reducePane(s, { type: 'select', view, id }))
  } else if (key === 'search-query' || key === 'search-globs' || key === 'search-replacement') {
    const editing = key === 'search-query' ? 'query' : key === 'search-globs' ? 'globs' : 'replacement'
    if ((await readSearch($, root)).editing !== editing) await updateSearch($, root, s => ({ ...s, editing }))
  } else if ((await readSearch($, root)).editing !== null) {
    await updateSearch($, root, s => ({ ...s, editing: null }))
  }
}
export async function scrollSearch($: EngineInterface, by: number): Promise<boolean> {
  const pane = await readPane($), view = currentView(pane)
  if (!['search', 'quickopen', 'search.replace'].includes(view)) return false
  const root = await readCwd($), r = await runtime($, root), s = await readSearch($, root)
  const from = r.ids.indexOf(pane.selected[view] ?? '')
  if (view !== 'search.replace' && by < 0 && from <= 0 && !s.editing) {
    await updateSearch($, root, u => ({ ...u, editing: 'query' }))
    await $.ui.focus({ requestId: 'jei', key: 'search-query' }).catch(() => {})
    return true
  }
  if (s.editing && (view === 'search.replace' || by <= 0)) return false
  if (s.editing) await updateSearch($, root, u => ({ ...u, editing: null }))
  if (view === 'search.replace' && s.expanded.includes(pane.selected[view] ?? s.plan[0]?.rel ?? '')) {
    const top = Math.max(0, Math.min(Math.max(0, (r.diffTotal ?? 0) - (r.diffRows ?? 1)), s.top + by))
    if (top !== s.top) { await updateSearch($, root, u => ({ ...u, top })); return true }
  }
  const id = r.ids[Math.max(0, Math.min(r.ids.length - 1, from < 0 ? 0 : from + (s.editing ? 0 : by)))]
  if (!id) return true
  if (pane.selected[view] === id && !s.editing) return true
  const subject = r.data?.[id], mode = view as 'search' | 'quickopen' | 'search.replace'
  if (subject !== undefined && s.subject?.[mode] !== subject) await updateSearch($, root, u => ({ ...u, subject: { ...u.subject, [mode]: subject } }))
  if (pane.selected[view] !== id) await updatePane($, p => reducePane(p, { type: 'select', view, id }))
  await $.ui.focus({ requestId: 'jei', key: `search-row-${id}` }).catch(() => {})
  return true
}
async function fill($: EngineInterface, text: string): Promise<void> { if (!(await $.prompt.fill({ text, mode: 'insert' })).isFilled) $.ui.toast("The prompt can't take this text right now.") }
function act($: EngineInterface, fn: () => Promise<unknown>): () => void { return () => { void fn().catch(err => $.ui.toast(firstLine(err))) } }

async function requestApply($: EngineInterface, rels: string[]): Promise<void> {
  const root = await readCwd($), s = await readSearch($, root)
  if (!s.busy && rels.length) await updateSearch($, root, u => ({ ...u, confirm: rels }))
}
async function confirmApply($: EngineInterface): Promise<void> {
  const root = await readCwd($), s = await readSearch($, root)
  if (s.busy || !s.confirm) return
  const files = s.plan.filter(file => s.confirm!.includes(file.rel))
  if (files.length !== s.confirm.length) return
  await updateSearch($, root, u => ({ ...u, busy: true, confirm: null }))
  const release = await mutationGuard($, root), written: string[] = [], skipped = [...s.skipped]
  let failure = ''
  try {
    for (const file of files) {
      if (await readCwd($) !== root) throw new Error('The project changed. Remaining files were not replaced.')
      const result = await applyReplace((await projectHost($, root)), root, [file])
      written.push(...result.written); skipped.push(...result.skipped)
    }
  } catch (err) { failure = firstLine(err) }
  finally {
    release()
    await updateSearch($, root, u => ({ ...u, busy: false, skipped, plan: u.plan.filter(file => !written.includes(file.rel) && !skipped.some(skip => skip.rel === file.rel)), summary: failure }))
    const count = files.filter(f => written.includes(f.rel)).reduce((n, f) => n + f.count, 0)
    $.ui.toast(`Replaced ${count} matches in ${written.length} files.${failure ? ` ${failure}` : ''}`)
    if (await readCwd($) === root) {
      if (written.length) await refreshAfterChange($, written)
      await restartSearch($, true)
    }
  }
}

export async function renderSearch($: EngineInterface, e: PaneRender, frame: FilesFrame, searchRows = 1): Promise<FilesView> {
  const els = $.ui.resolve(e), { Box, Text, Button, Code } = els
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const root = await readCwd($), pane = await readPane($), view = currentView(pane), s = await readSearch($, root), r = await runtime($, root)
  await readTick($)
  const inner = frame.inner, compact = frame.bodyRows <= 3, quick = view === 'quickopen', replacing = view === 'search.replace'
  const text = (value: string, key?: string, accent = false) => <Box key={key}><Text dimColor={!accent} color={accent ? color('accent') : undefined} wrap="truncate-end">{inner ? ` ${fitEnd(value, inner)}` : ''}</Text></Box>
  const edit = async (editing: JeiSearch['editing']) => { await updateSearch($, root, u => ({ ...u, editing })); await $.ui.focus({ requestId: 'jei', key: editing === 'query' ? 'search-query' : `search-${editing}` }).catch(() => {}) }
  let quickError = ''
  const files = quick ? await (r.files ??= (async () => quickOpenFiles(await projectHost($, root), root))()).catch(err => { r.files = undefined; quickError = firstLine(err); return [] }) : []
  const ranking = { touched: new Set(Object.keys(await readActivity($))), recent: pane.recent }
  const quickText = s.quickText ?? ''
  const ranked = quick ? rankFiles(parseQuery(quickText).name, files, ranking, 200) : []
  const activate = async (id: string) => {
    if (id.startsWith('command-')) { await command(id.slice(8)); return }
    if (quick) { const rel = ranked[Number(id.slice(5))]; if (rel) { await stopSearch($); await showPreview($, rel, parseQuery(quickText).line ?? undefined) }; return }
    const match = s.matches[Number(id.slice(6))]
    if (match) { await stopSearch($); await showPreview($, match.rel, match.line) }
  }
  const command = async (action: string) => {
    if (s.busy && replacing) return
    if (action === 'edit') return edit('query')
    if (action === 'quickopen' || action === 'search') {
      await stopSearch($)
      await updateSearch($, root, u => ({ ...u, editing: 'query' }))
      await updatePane($, p => reducePane(p, action === 'quickopen' ? { type: 'quickopen' } : { type: 'back' }))
      return
    }
    if (action === 'include') return edit('globs')
    if (action === 'replace') return edit('replacement')
    if (action === 'send-all') return fill($, sendText(s.text, s.matches))
    if (action === 'mention') {
      if (quick) { const rel = s.subject?.quickopen ?? ranked[0]; if (rel && files.includes(rel)) await fill($, `@${rel} `); return }
      const match = s.matches[Number((s.subject?.search ?? 'match-0').slice(6))]
      if (match) await fill($, sendText(s.text, [match]))
    }
    if (action === 'apply-all') return requestApply($, s.plan.map(f => f.rel))
    if (action === 'ask') return fill($, replaceAskText(queryOf(s), s.replacement, s.matches))
  }
  const input = (kind: 'query' | 'globs' | 'replacement'): RenderElement => {
    const value = kind === 'query' ? quick ? quickText : s.draft ?? s.text : s[kind], placeholder = kind === 'query' ? quick ? 'Go to file' : 'Search · Enter' : kind === 'globs' ? 'Include/exclude: src/** !**/*.test.ts' : 'Replace with'
    const change = async (value: string) => { await updateSearch($, root, u => ({ ...u, [kind === 'query' ? quick ? 'quickText' : 'draft' : kind]: value, editing: kind })) }
    const submit = async (value: string) => {
      await change(value); await updateSearch($, root, u => ({ ...u, editing: null }))
      if (kind === 'replacement') {
        if (s.busy) return
        stop(r)
        const epoch = r.epoch
        await updateSearch($, root, u => ({ ...u, busy: true }))
        try {
          const plan = await buildReplacePlan((await projectHost($, root)), root, queryOf(await readSearch($, root)), value)
          if (r.epoch !== epoch || await readCwd($) !== root || currentView(await readPane($)) !== view) return
          await updateSearch($, root, u => ({ ...u, plan: plan.files, skipped: plan.skipped, expanded: plan.files.map(f => f.rel), top: 0, confirm: null }))
          await updatePane($, p => reducePane(p, { type: 'replace' }))
        } finally { if (r.epoch === epoch) await updateSearch($, root, u => ({ ...u, busy: false })) }
        return
      }
      if (quick) { const best = rankFiles(parseQuery(value).name, files, ranking, 1)[0]; if (best) await showPreview($, best, parseQuery(value).line ?? undefined); return }
      if (kind === 'query') await updateSearch($, root, u => ({ ...u, text: value }))
      if (!value && kind === 'query') { await clear(); return }
      await updatePane($, p => reducePane(p, { type: 'select', view: 'search', id: 'match-0' }))
      await restartSearch($, true)
      await $.ui.focus({ requestId: 'jei', key: 'search-row-match-0' }).catch(() => {})
    }
    const cancel = s.editing ? <Button key="search-cancel" plain label="Cancel" onPress={act($, async () => { await leaveSearchEditor($); await $.ui.focus({ requestId: 'jei', key: 'search-row-match-0' }).catch(() => {}) })} /> : null
    const field = Input ? <Box flexDirection="row" width={Math.max(0, frame.columns - 1)}><Text> </Text><Text color={color('accent')}>│ </Text><Box flexGrow={1}><Input key={`search-${kind}`} submitLabel={kind === 'query' ? quick ? 'open' : 'search' : kind === 'replacement' ? 'review' : 'apply'} placeholder={placeholder} value={value} autoFocus={s.editing === kind ? true : undefined} onInput={value => act($, () => change(value))()} onSubmit={value => act($, () => submit(value))()} /></Box><Text> </Text>{cancel}{cancel && <Text> · </Text>}<Button key="search-clear" plain label="Clear" onPress={act($, clear)} /><Text color={color('accent')}> │</Text></Box>
      : <Box flexDirection="row"><Text>{fitEnd(`${placeholder}: ${value} (input unavailable)`, Math.max(0, inner - (s.editing ? 6 : 0)))}</Text>{cancel}</Box>
    return <Box key="search-field" flexDirection="column">{searchRows >= 3 && text('┌' + '─'.repeat(Math.max(0, inner - 2)) + '┐', 'search-border-top', true)}{field}{searchRows >= 3 && text('└' + '─'.repeat(Math.max(0, inner - 2)) + '┘', 'search-border-bottom', true)}</Box>
  }
  async function clear() {
    await stopSearch($)
    await updateSearch($, root, u => ({ ...u, draft: '', text: '', matches: [], summary: '', editing: null }))
    await updatePane($, p => reducePane(p, { type: 'tab', tab: 'search' }))
    await $.ui.focus({ requestId: 'jei', key: 'search-query' }).catch(() => {})
  }
  const above = replacing ? [] : [input(s.editing ?? 'query')]
  const actions = s.editing || s.confirm ? [] : KEYS[view].flatMap(k => /^[a-z0-9]$/.test(k.key) && k.action !== 'back' ? [{ key: k.key, run: act($, () => command(k.action)) }] : [])
  const items: { id: string; el: RenderElement; height?: number; passive?: boolean }[] = []
  let diffScrollable = false
  const selected = pane.selected[view] ?? (replacing ? s.plan[0]?.rel : quick ? 'file-0' : 'match-0')
  const row = (id: string, label: string, run: () => Promise<unknown>) => <Box key={`search-wrap-${id}`} flexDirection="row"><Text> </Text><Button key={`search-row-${id}`} plain onPress={act($, run)}><Text inverse={selected === id && !(frame.isFocused && r.focused === `search-row-${id}`)} wrap="truncate-end">{fitEnd(label, inner)}</Text></Button></Box>
  if (replacing) {
    if (s.confirm) {
      const files = s.plan.filter(f => s.confirm!.includes(f.rel)), count = files.reduce((n, f) => n + f.count, 0)
      return { header: text('Replace preview'), body: [text(`Replace ${count} matches in ${files.length === 1 ? files[0]!.rel : `${files.length} files`}?`, 'replace-question'), <Box flexDirection="row"><Text> </Text><Button key="replace-confirm" label="Replace" onPress={act($, () => confirmApply($))} /><Button key="replace-cancel" label="Cancel" onPress={act($, () => updateSearch($, root, u => ({ ...u, confirm: null })))} /></Box>].slice(0, frame.bodyRows), actions: [] }
    }
    for (const f of s.plan) {
      items.push({ id: f.rel, el: <Box flexDirection="row"><Text> </Text><Button key={`replace-toggle-${f.rel}`} plain label={s.expanded.includes(f.rel) ? '▾' : '▸'} onPress={act($, () => updateSearch($, root, u => ({ ...u, expanded: u.expanded.includes(f.rel) ? u.expanded.filter(rel => rel !== f.rel) : [...u.expanded, f.rel] })))} /><Text> </Text><Button key={`search-row-${f.rel}`} plain onPress={act($, () => requestApply($, [f.rel]))}><Text inverse={selected === f.rel}>{fitEnd(`${f.rel} (${f.count})`, Math.max(0, inner - 2))}</Text></Button></Box> })
      if (s.expanded.includes(f.rel) && f.rel === selected && !compact) {
        const diff = parseUnifiedDiff(previewText(f))[0]
        if (diff) {
          const height = Math.max(1, Math.min(6, frame.bodyRows - 1)), window = diffWindow(diff, s.top, height)
          r.diffTotal = window.total; r.diffRows = height
          diffScrollable = window.total > height
          items.push({ id: `${f.rel}:diff`, height, passive: true, el: <Box height={height} overflow="hidden"><Code source={window.text.replace(/\n$/, '')} format="diff" wrap="truncate-end" /></Box> })
        }
      }
    }
    if (s.skipped.length) items.push({ id: 'skipped', passive: true, el: text('Not replaced') })
    for (const skip of s.skipped) items.push({ id: `skip-${skip.rel}`, el: row(`skip-${skip.rel}`, `${skip.rel}: ${skip.reason}`, async () => {}) })
    const file = s.plan.find(f => f.rel === s.subject?.['search.replace']) ?? s.plan[0]
    items.push({ id: 'apply', el: row('apply', 'Apply file', () => requestApply($, file ? [file.rel] : [])) })
  } else if (quick) {
    if (quickError) items.push({ id: 'notice', passive: true, el: text(quickError, 'search-notice') })
    const touched = await readActivity($)
    ranked.forEach((rel, i) => items.push({ id: `file-${i}`, el: row(`file-${i}`, `${touched[rel] ? '•' : ' '} ${rel.slice(rel.lastIndexOf('/') + 1)}  ${fitPath(rel.slice(0, rel.lastIndexOf('/')), Math.floor(inner / 2))}`, () => activate(`file-${i}`)) }))
  } else {
    if (!s.matches.length) items.push({ id: 'notice', passive: true, el: text(s.summary || 'Type to search the project.', 'search-notice') })
    let last = ''
    s.matches.forEach((m, i) => {
      if (last !== m.rel && !compact) { items.push({ id: `group-${m.rel}`, passive: true, el: text(`${m.rel} (${s.matches.filter(item => item.rel === m.rel).length})`) }); last = m.rel }
      const prefix = `  ${m.line}: `, room = Math.max(0, inner - prefix.length)
      const first = m.ranges[0]?.[0] ?? 0
      let from = Math.max(0, first - Math.floor(room / 3))
      if (from > 0 && /[\uDC00-\uDFFF]/.test(m.text[from]!)) from--
      const clipped = fitEnd(m.text.slice(from), Math.max(0, room - (from ? 1 : 0)))
      const visible = clipped.endsWith('…') && clipped !== printable(m.text.slice(from)) ? clipped.slice(0, -1) : clipped
      const spans: RenderElement[] = [<Text>{from ? '…' : ''}</Text>]; let at = 0
      for (const [start, end] of m.ranges) {
        const a = Math.max(0, start - from), b = Math.min(visible.length, end - from)
        if (a > visible.length) break
        spans.push(<Text>{visible.slice(at, a)}</Text>, <Text color={color('accent')}>{visible.slice(a, b)}</Text>); at = Math.max(at, b)
      }
      spans.push(<Text>{visible.slice(at)}{visible !== clipped ? '…' : ''}</Text>)
      items.push({ id: `match-${i}`, el: <Box flexDirection="row"><Text> </Text><Button key={`search-row-match-${i}`} plain onPress={act($, () => activate(`match-${i}`))}><Text inverse={selected === `match-${i}` && !(frame.isFocused && r.focused === `search-row-match-${i}`)}>{prefix}{spans}</Text></Button></Box> })
    })
  }
  // Every command also lives in the list: compact hint Buttons cannot bind all ten letters at 24 cells.
  if (quick) items.push({ id: 'command-edit', el: row('command-edit', 'Edit query', () => edit('query')) })
  for (const k of KEYS[view]) if (/^[a-z0-9]$/.test(k.key) && k.action !== 'back') items.push({ id: `command-${k.action}`, el: row(`command-${k.action}`, `${k.key} ${k.label}`, () => command(k.action)) })
  r.ids = items.filter(item => !item.passive).map(item => item.id)
  r.data = replacing ? Object.fromEntries(s.plan.map(f => [f.rel, f.rel])) : quick ? Object.fromEntries(ranked.map((rel, i) => [`file-${i}`, rel])) : Object.fromEntries(s.matches.map((_, i) => [`match-${i}`, `match-${i}`]))
  const pinned: RenderElement[] = []
  if (!replacing && !quick && !compact && s.globs) pinned.push(text(s.globs, 'search-globs-label'))
  const room = Math.max(0, frame.bodyRows - pinned.length - (!compact && !replacing ? 1 : 0))
  const ids = items.map(item => item.id), top = windowTop(`${root}:${view}`, ids, selected, room)
  const body = [...pinned]
  let left = room
  for (const item of items.slice(top)) { const height = item.height ?? 1; if (height > left) break; body.push(item.el); left -= height; if (!left) break }
  if (!compact && !replacing) body.push(text((quick ? quickError || `${ranked.length} files` : s.summary) + (!quick && s.engine === 'git grep' ? ' · git grep' : ''), 'search-summary'))
  return { header: text(replacing ? 'Replace preview' : quick ? 'Quick Open' : toPosix(root).replace(/\/+$/, '').split('/').pop() || 'Files'), above, body: body.slice(0, frame.bodyRows), actions: actions as FilesAction[], scrollable: diffScrollable || items.reduce((total, item) => total + (item.height ?? 1), 0) > room }
}
