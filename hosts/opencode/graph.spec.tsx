import { expect, test } from 'bun:test'
import { historyFixture, hash, commit } from '../../test/opencode-history.tsx'
import { paneMemory } from './pane.tsx'
import { cellWidth } from '../../core/shared/fit.ts'
import { hintLine } from '../../core/keys.ts'

for (const width of [24, 40, 80, 120]) test(`Graph shares selection, expands and navigates commit diffs at ${width} columns and five rows`, async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], selected: { git: `graph-${hash}` } } })
  const r = await f.mount(width, 5)
  const checkFrame = (selected: string, diff = false) => {
    const frame = r.captureCharFrame(); const hint = frame.trimEnd().split('\n').at(-1)!
    expect(frame).toContain(selected)
    expect(hint).toContain('esc')
    if (diff) expect(hint).toBe(hintLine('git.diff', width))
    expect(r.captureSpans().rows).toBe(5)
    for (const line of frame.split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
  }
  checkFrame('1111111')
  for (const key of ['y', 'a', 'b', 'f', 't', 'n']) expect(r.captureCharFrame().trimEnd().split('\n').at(-1)!.split(/\s+/)).toContain(key)
  expect(r.captureCharFrame()).toContain('1111111')
  expect(r.captureCharFrame()).toContain('✦')
  f.key('y'); await r.flush(); expect(f.copied).toEqual([hash])
  f.copy(false); f.key('y'); await r.flush(); expect(f.prompts.at(-1)).toEqual({ title: 'Commit hash', value: hash })
  f.key('a'); await r.flush(); expect(f.prompts.at(-1).value).toBe('Explain commit 1111111 ("feat: update app").')
  f.key('enter'); await r.flush(); f.key('down'); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.filter(c => c.method === 'diff').at(-1)?.input).toEqual({ path: 'a.ts', source: { kind: 'commit', hash } })
  checkFrame('a.ts', true)
  f.setWidth(120); r.resize(120, 5); await r.flush(); f.setWidth(width); r.resize(width, 5); await r.flush()
  checkFrame('a.ts', true)
  f.key('j'); await r.flush(); expect(f.calls.filter(c => c.method === 'diff').at(-1)?.input.path).toBe('b.ts')
  checkFrame('b.ts', true)
  f.key('k'); await r.flush(); f.key('esc'); await r.flush(); expect(r.captureCharFrame()).toContain('a.ts')
  f.setWidth(120); r.resize(120, 5); await r.flush(); f.setWidth(width); r.resize(width, 5); await r.flush()
  expect(r.captureCharFrame()).toContain('a.ts')
  checkFrame('a.ts')
  for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
})

test('Graph filter, paging, fetch, checkout, revert and contextual create use the RPC boundary', async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  f.handlers.graph = async () => ({ commits: [commit], more: true })
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], selected: { git: `graph-${hash}` } } })
  const r = await f.mount(40, 12)
  f.edit('topic'); f.key('n'); await r.flush(); expect(f.calls.find(c => c.method === 'createBranch')?.input).toEqual({ name: 'topic', start: hash, confirmed: false })
  f.key('t'); await r.flush(); expect(f.calls.some(c => c.method === 'fetch')).toBe(true)
  f.edit('author:"Ana Rivera" branch:*'); f.key('f'); await r.flush()
  expect(f.calls.filter(c => c.method === 'graph').at(-1)?.input.filter).toBe('author:"Ana Rivera" branch:*')
  update(d => { d.panes['session-a']!.selected.git = `graph-${hash}` }); await r.flush()
  f.key('enter'); await r.flush(); f.key('down'); f.key('down'); f.key('down'); await r.flush()
  f.key('enter'); await r.flush(); expect(f.confirms.at(-1).message).toContain('detached HEAD')
  expect(f.calls.filter(c => c.method === 'checkout')).toHaveLength(1)
  f.confirm(true); f.key('enter'); await r.flush(); expect(f.calls.filter(c => c.method === 'checkout').at(-1)?.input.confirmed).toBe(true)
  f.key('down'); await r.flush(); f.key('enter'); await r.flush(); expect(f.calls.filter(c => c.method === 'revert').at(-1)?.input.confirmed).toBe(true)
  update(d => { d.panes['session-a']!.selected.git = 'graph-more' }); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.filter(c => c.method === 'graph').at(-1)?.input.count).toBe(400)
})

test('Graph retains filters on cancel, handles no matches and errors, and sends confirmed Ask text', async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], selected: { git: `graph-${hash}` } } })
  const r = await f.mount(24, 10)
  for (const key of ['y', 'a', 'b', 'f', 't', 'n']) expect(r.captureCharFrame().split('\n').at(-2)).toContain(key)
  f.edit('Explain this change.'); f.key('a'); await r.flush()
  expect(f.sent).toEqual([{ sessionID: 'session-a', text: 'Explain this change.' }])
  f.edit('author:"Ana Rivera" path:src/app.ts branch:*'); f.key('f'); await r.flush()
  f.edit(undefined); f.key('f'); await r.flush()
  expect(f.prompts.at(-1).value).toBe('author:"Ana Rivera" path:src/app.ts branch:*')
  f.handlers.fetch = async () => { throw { message: 'Fetch denied.\nprivate diagnostic' } }
  f.key('t'); await r.flush(); expect(f.notices.at(-1).message).toContain('Fetch den')
  expect(f.notices.at(-1).message).not.toContain('private diagnostic')
  f.handlers.graph = async () => ({ commits: [], more: false }); f.changed(); await r.flush()
  update(d => { d.panes['session-a']!.selected.git = 'group-graph' }); await r.flush()
  expect(r.captureCharFrame()).toContain('No commits match')
  f.handlers.graph = async () => { throw { message: 'History unavailable.' } }; f.changed(); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't load history")
})

test('Graph ignores stale pages, opens supported web links, and reports merge refusal without confirmation', async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  let release!: (value: unknown) => void
  f.handlers.graph = () => new Promise(resolve => { release = resolve })
  const r = await f.mount(80, 10)
  f.handlers.graph = async () => ({ commits: [commit], more: false }); f.changed(); await r.flush()
  release({ commits: [], more: false }); await r.flush()
  update(d => { d.panes['session-a']!.selected.git = `graph-${hash}` }); await r.flush()
  expect(r.captureCharFrame()).toContain('1111111')
  f.key('enter'); await r.flush()
  update(d => { d.panes['session-a']!.selected.git = `web-${hash}` }); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.find(c => c.method === 'openWeb')?.input).toEqual({ hash })
  f.handlers.revert = async () => { throw { message: 'Reverting a merge commit is not supported.' } }
  update(d => { d.panes['session-a']!.selected.git = `revert-${hash}` }); await r.flush(); f.key('enter'); await r.flush()
  expect(f.confirms).toHaveLength(0)
  expect(f.notices.at(-1).variant).toBe('error')
})
