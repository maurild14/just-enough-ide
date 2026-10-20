import { expect, test } from 'bun:test'
import { cellWidth } from '../../core/shared/fit.ts'
import { input, searchFixture, settle } from '../../test/opencode-search.tsx'
import { paneMemory } from './pane.tsx'

const batch = (id: string, text = 'load') => ({ sessionID: 'session-a', id, matches: [{ rel: 'src/app.ts', line: 2, text: `ñ ${text} 界`, ranges: [[2, 2 + text.length]] }] })
const done = (id: string, extra: object = {}) => ({ sessionID: 'session-a', id, engine: 'rg', error: null, ms: 4, truncated: false, ...extra })

async function command(f: ReturnType<typeof searchFixture>, r: Awaited<ReturnType<typeof f.mount>>, view: 'search' | 'quickopen' | 'search.replace', id: string) {
  for (let i = 0; i < 30 && paneMemory(f.ctx)[0].panes['session-a']!.selected[view] !== id; i++) { f.key('down'); await r.flush() }
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected[view]).toBe(id)
  f.key('enter'); await r.flush()
}

test('compact Search mention command uses the last selected result', async () => {
  const f = searchFixture(), r = await f.mount(24, 5); f.key('2'); await r.flush(); input(r).insertText('load'); await settle(r)
  const id = f.calls.findLast(c => c.method === 'searchStart')!.input.id
  f.emit('searchMatches', { ...batch(id), matches: [...batch(id).matches, { rel: 'src/save.ts', line: 7, text: 'load()', ranges: [[0, 4]] }] }); input(r).submit(); await r.flush()
  f.key('down'); await r.flush(); await command(f, r, 'search', 'command:mention')
  expect(f.prompts.at(-1)?.value).toBe('src/save.ts:7 (load())')
})

test('compact Quick Open mention command uses the last selected file', async () => {
  const f = searchFixture(), r = await f.mount(24, 5); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush(); f.key('esc'); f.key('down'); await r.flush()
  await command(f, r, 'quickopen', 'command:mention')
  expect(f.prompts.at(-1)?.value).toBe('@src/save.ts ')
})

test('compact Apply file command confirms the last selected reviewed file once', async () => {
  const f = searchFixture(), r = await f.mount(24, 5)
  f.handlers.replacePlan = async () => ({ planId: 'compact', files: ['src/app.ts', 'src/save.ts'].map(rel => ({ rel, before: 'load', after: 'save', count: 1 })), skipped: [] })
  f.key('2'); await r.flush(); f.key('esc'); f.key('p'); await r.flush(); input(r, 'search-replacement').insertText('save'); input(r, 'search-replacement').submit(); await r.flush()
  f.key('down'); f.key('down'); await r.flush(); await command(f, r, 'search.replace', 'command:apply-file')
  expect(f.confirms).toHaveLength(1); expect(f.confirms[0].message).toBe('Replace 1 matches in src/save.ts?')
  expect(f.calls.some(c => c.method === 'replaceApply')).toBe(false)
})

test('colliding Search ids after a root transition ignore foreign matches and done before parsing', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); input(r).insertText('load'); await settle(r)
  const oldId = f.calls.findLast(c => c.method === 'searchStart')!.input.id
  f.setCwd('/other-app'); f.changed(); await r.flush(); input(r).insertText('save'); await settle(r)
  const id = f.calls.findLast(c => c.method === 'searchStart')!.input.id; expect(id).toBe(oldId)
  f.emit('searchMatches', batch(id, 'WRONG_ROOT'), '/acme-app'); f.emit('searchDone', done(id, { error: 'WRONG_DONE' }), '/acme-app'); await r.flush()
  expect(r.captureCharFrame()).not.toContain('WRONG_ROOT'); expect(r.captureCharFrame()).not.toContain('WRONG_DONE')
  f.emit('searchMatches', null, '/acme-app'); f.emit('searchDone', null, '/acme-app')
  f.emit('searchMatches', batch(id, 'RIGHT_ROOT')); f.emit('searchDone', done(id)); await r.flush()
  expect(r.captureCharFrame()).toContain('RIGHT_ROOT'); expect(r.captureCharFrame()).toContain('1 results'); expect(r.captureCharFrame()).not.toContain('Invalid Search reply.')
})

test('Quick Open reuses its project cache through preview Back and relists only after invalidation', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush()
  expect(f.calls.filter(c => c.method === 'quickOpenFiles')).toHaveLength(1)
  input(r).submit(); await r.flush(); f.key('q'); await r.flush()
  expect(f.calls.filter(c => c.method === 'quickOpenFiles')).toHaveLength(1); expect(r.captureCharFrame()).toContain('src/app.ts')
  f.handlers.quickOpenFiles = async () => ({ files: ['src/new.ts'] }); f.changed(); await r.flush()
  expect(f.calls.filter(c => c.method === 'quickOpenFiles')).toHaveLength(2); expect(r.captureCharFrame()).toContain('src/new.ts'); expect(r.captureCharFrame()).not.toContain('src/app.ts')
})

test('Quick Open refreshes once after panel close and reopen, including changes missed while closed', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush()
  expect(r.captureCharFrame()).toContain('src/app.ts'); expect(f.calls.filter(c => c.method === 'quickOpenFiles')).toHaveLength(1)
  r.renderer.destroy(); f.handlers.quickOpenFiles = async () => ({ files: ['src/new.ts'] }); f.changed()
  const reopened = await f.mount()
  expect(f.calls.filter(c => c.method === 'quickOpenFiles')).toHaveLength(2); expect(reopened.captureCharFrame()).toContain('src/new.ts'); expect(reopened.captureCharFrame()).not.toContain('src/app.ts')
})

test('Quick Open reports a failed refresh even while cached files remain visible', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush()
  expect(r.captureCharFrame()).toContain('src/app.ts')
  f.handlers.quickOpenFiles = async () => { throw new Error('File listing failed.\nInternal details.') }; f.changed(); await r.flush()
  expect(r.captureCharFrame()).toContain('src/app.ts')
  expect(f.notices.at(-1)).toEqual({ message: 'File listing failed. Showing cached files.', variant: 'error' })
})

test('Search preserves client error objects first-line messages and unknown-error fallback', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush()
  f.handlers.quickOpenFiles = async () => { throw { type: 'internal', message: 'File listing failed.\nInternal details.', data: {} } }; f.changed(); await r.flush()
  expect(f.notices.at(-1)).toEqual({ message: 'File listing failed. Showing cached files.', variant: 'error' })
  f.handlers.quickOpenFiles = async () => { throw { type: 'internal', message: 42 } }; f.changed(); await r.flush()
  expect(f.notices.at(-1)).toEqual({ message: 'Unable to complete Search. Showing cached files.', variant: 'error' })
})

for (const width of [24, 40, 80, 120]) test(`Search streams, previews a marked line and retains Back at ${width}x5`, async () => {
  const f = searchFixture(); const r = await f.mount(width, 5); f.key('2'); await r.flush()
  expect(input(r)).toBeDefined()
  input(r).insertText('load'); await settle(r)
  const start = f.calls.findLast(c => c.method === 'searchStart')!.input
  f.emit('searchMatches', { sessionID: 'session-a', id: start.id, matches: [{ rel: 'src/app.ts', line: 2, text: 'export function load() {}', ranges: [[16, 20]] }] }); await r.flush()
  expect(r.captureCharFrame()).toContain('load')
  input(r).submit(); await r.flush(); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('>')
  expect(r.captureCharFrame()).toContain('load')
  f.key('q'); await settle(r); expect(input(r).value).toBe('load'); expect(f.calls.filter(c => c.method === 'searchStart').length).toBe(1)
  for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
})

test('new typing cancels stale events, inputs own letters/digits, toggles/globs and exact hand-off work', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush()
  await r.mockInput.typeText('load'); await settle(r); const first = f.calls.findLast(c => c.method === 'searchStart')!.input.id
  f.emit('searchMatches', batch(first)); await r.flush(); input(r).deleteToLineStart(); await r.mockInput.typeText('save123qcx'); f.key('1'); f.key('c'); await settle(r)
  const second = f.calls.findLast(c => c.method === 'searchStart')!.input
  expect(second.query.text).toBe('save123qcx'); expect(second.query.caseSensitive).toBe(false)
  expect(f.calls.some(c => c.method === 'searchCancel' && c.input.id === first)).toBe(true)
  f.emit('searchMatches', batch(first, 'STALE')); f.emit('searchMatches', { ...batch(second.id, 'OTHER'), sessionID: 'other' }); f.emit('searchMatches', batch(second.id, 'save123qcx')); f.emit('searchDone', done(second.id)); await r.flush()
  expect(r.captureCharFrame()).not.toContain('STALE'); expect(r.captureCharFrame()).not.toContain('OTHER')
  input(r).submit(); await r.flush(); f.edit(undefined); f.key('a'); await r.flush()
  expect(f.prompts.at(-1).value).toBe('src/app.ts:2 (ñ save123qcx 界)'); expect(f.sent).toEqual([])
  f.edit('Reviewed uses.'); f.key('s'); await r.flush(); expect(f.sent.at(-1)).toEqual({ sessionID: 'session-a', text: 'Reviewed uses.' })
  f.key('c'); f.key('x'); f.key('w'); f.key('i'); await r.flush(); await r.mockInput.typeText('src/** !**/*.test.ts'); input(r, 'search-globs').submit(); await settle(r)
  expect(f.calls.findLast(c => c.method === 'searchStart')!.input.query).toEqual({ text: 'save123qcx', caseSensitive: true, regex: true, wholeWord: true, include: ['src/**'], exclude: ['**/*.test.ts'] })
})

test('Quick Open ranks touched/recent files, refreshes its list and submits a source line', async () => {
  const f = searchFixture(); f.handlers.quickOpenFiles = async () => ({ files: ['src/a.ts', 'src/recent.ts', 'src/touched.ts'] })
  f.handlers.preview = async () => ({ kind: 'csv', rows: [['table']], text: 'a,b\n"target",2\n' })
  const r = await f.mount(); const [, update] = paneMemory(f.ctx); update(d => { d.panes['session-a']!.recent = ['src/recent.ts'] })
  f.emit('activity', { rel: 'src/touched.ts', kind: 'read' }); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush()
  const frame = r.captureCharFrame(); expect(frame.indexOf('touched.ts')).toBeLessThan(frame.indexOf('recent.ts')); expect(frame.indexOf('recent.ts')).toBeLessThan(frame.indexOf('a.ts'))
  await r.mockInput.typeText('touched.ts:2'); input(r).submit(); await r.flush(); expect(r.captureCharFrame()).toContain('>'); expect(r.captureCharFrame()).toContain('target')
  f.key('q'); await r.flush(); expect(input(r).value).toBe('touched.ts:2')
  const before = f.calls.filter(c => c.method === 'quickOpenFiles').length; f.changed(); await r.flush(); expect(f.calls.filter(c => c.method === 'quickOpenFiles').length).toBeGreaterThan(before)
})

test('replacement shows reviewed diffs, confirms before applying and reports partial writes/skips', async () => {
  const f = searchFixture(); const files = [{ rel: 'src/app.ts', before: 'load\n', after: 'save\n', count: 1 }, { rel: 'src/save.ts', before: 'load\n', after: 'save\n', count: 1 }]
  f.handlers.replacePlan = async () => ({ planId: 'reviewed', files, skipped: [{ rel: 'blob.bin', reason: 'binary' }] })
  f.handlers.replaceApply = async () => ({ written: ['src/app.ts'], skipped: [{ rel: 'src/save.ts', reason: 'changed' }], error: 'Disk write failed.' })
  const r = await f.mount(); f.key('2'); await r.flush(); await r.mockInput.typeText('load'); await settle(r); const id = f.calls.findLast(c => c.method === 'searchStart')!.input.id
  f.emit('searchMatches', batch(id)); f.emit('searchDone', done(id)); input(r).submit(); await r.flush(); f.key('p'); await r.flush(); await r.mockInput.typeText('save'); input(r, 'search-replacement').submit(); await r.flush()
  expect(r.captureCharFrame()).toContain('-load'); expect(r.captureCharFrame()).toContain('+save')
  f.key('enter'); await r.flush(); expect(f.confirms.at(-1).message).toBe('Replace 1 matches in src/app.ts?'); expect(f.calls.some(c => c.method === 'replaceApply')).toBe(false)
  f.confirm(true); f.key('y'); await r.flush()
  expect(f.calls.findLast(c => c.method === 'replaceApply')!.input).toEqual({ sessionID: 'session-a', planId: 'reviewed', rels: ['src/app.ts', 'src/save.ts'] })
  expect(f.notices.at(-1).message).toBe('Replaced 1 matches in 1 files. Disk write failed.')
  expect(r.captureCharFrame()).toContain('changed'); expect(r.captureCharFrame()).toContain('binary')
})

test('malformed/unsafe wire paths are refused while colon names, summaries and resize stay visible', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); await r.mockInput.typeText('load'); await settle(r)
  let id = f.calls.findLast(c => c.method === 'searchStart')!.input.id
  f.emit('searchMatches', { ...batch(id), matches: [{ ...batch(id).matches[0], rel: 'a:b.ts' }] }); f.emit('searchDone', done(id, { engine: 'git grep', truncated: true })); await r.flush()
  expect(r.captureCharFrame()).toContain('a:b.ts'); expect(r.captureCharFrame()).toContain('Results truncated.'); expect(r.captureCharFrame()).toContain('git grep')
  for (const path of ['../outside.ts', '/outside.ts', 'a\\b.ts']) { input(r).insertText('x'); await settle(r); id = f.calls.findLast(c => c.method === 'searchStart')!.input.id; f.emit('searchMatches', { ...batch(id), matches: [{ ...batch(id).matches[0], rel: path }] }); await r.flush(); expect(r.captureCharFrame()).toContain('Invalid Search path.') }
  input(r).insertText('x'); await settle(r); id = f.calls.findLast(c => c.method === 'searchStart')!.input.id; f.emit('searchDone', done(id, { error: 'ripgrep (rg) is not installed. Install it to search.' })); await r.flush(); expect(r.captureCharFrame()).toContain('not installed')
  for (const width of [120, 24, 40, 80]) { f.setWidth(width); r.resize(width, 5); await r.flush(); for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width) }
})

test('Quick Open preserves list selection through preview Back', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); f.key('esc'); f.key('q'); await r.flush(); f.key('esc'); f.key('down'); f.key('enter'); await r.flush()
  expect(f.calls.findLast(c => c.method === 'preview')!.input.rel).toBe('src/save.ts')
  f.key('q'); await r.flush(); expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.quickopen).toBe('file-1')
})

test('replacement diff keys reach content beyond the first window', async () => {
  const f = searchFixture(), r = await f.mount(); f.handlers.replacePlan = async () => ({ planId: 'scroll', files: [{ rel: 'src/app.ts', before: 'start-old\n' + 'middle-old\n'.repeat(8) + 'end-old\n', after: 'save\n', count: 1 }], skipped: [] })
  f.key('2'); await r.flush(); f.key('esc'); f.key('p'); await r.flush(); input(r, 'search-replacement').insertText('save'); input(r, 'search-replacement').submit(); await r.flush()
  expect(r.captureCharFrame()).not.toContain('end-old')
  for (let i = 0; i < 8; i++) f.key('down'); await r.flush(); expect(r.captureCharFrame()).toContain('end-old')
})

test('native input focus protects query text even when it arrives outside Edit query', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); f.key('esc'); await r.flush(); input(r).focus(); f.key('q'); f.key('4'); await r.mockInput.typeText('q4'); await r.flush()
  expect(input(r).value).toBe('q4'); expect(paneMemory(f.ctx)[0].panes['session-a']!.stack).toEqual(['search'])
})

test('replacement remains busy across a tab remount until apply and refresh complete', async () => {
  const f = searchFixture(), r = await f.mount(); let finish!: (v: unknown) => void
  f.handlers.replacePlan = async () => ({ planId: 'held', files: [{ rel: 'src/app.ts', before: 'load', after: 'save', count: 1 }], skipped: [] })
  f.handlers.replaceApply = () => new Promise(resolve => { finish = resolve }); f.confirm(true)
  f.key('2'); await r.flush(); f.key('esc'); f.key('p'); await r.flush(); input(r, 'search-replacement').insertText('save'); input(r, 'search-replacement').submit(); await r.flush(); f.key('enter'); await r.flush()
  f.key('4'); await r.flush(); f.key('2'); await r.flush(); f.key('esc'); f.key('p'); await r.flush(); expect(!!input(r, 'search-replacement')).toBe(false)
  finish({ written: ['src/app.ts'], skipped: [] }); await r.flush(); f.key('p'); await r.flush(); expect(input(r, 'search-replacement')).toBeDefined()
})

test('a colon result remains the preview mention and editor target', async () => {
  const f = searchFixture(), r = await f.mount(); f.key('2'); await r.flush(); await r.mockInput.typeText('load'); await settle(r); const id = f.calls.findLast(c => c.method === 'searchStart')!.input.id
  f.emit('searchMatches', { ...batch(id), matches: [{ ...batch(id).matches[0], rel: 'a:b.ts' }] }); input(r).submit(); await r.flush(); f.key('enter'); await r.flush(); f.key('a'); await r.flush(); expect(f.prompts.at(-1).value).toBe('@a:b.ts ')
  f.key('o'); await r.flush(); expect(f.calls.findLast(c => c.method === 'open')!.input).toEqual({ rel: 'a:b.ts', line: 2 })
})
