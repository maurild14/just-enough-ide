import { expect, test } from 'bun:test'
import { historyFixture, hash, other } from '../../test/opencode-history.tsx'
import { cellWidth } from '../../core/shared/fit.ts'
import { hintLine } from '../../core/keys.ts'

for (const width of [24, 40, 80, 120]) test(`Branches switches, creates, compares and preserves selection at ${width} columns and five rows`, async () => {
  const f = historyFixture(); const r = await f.mount(width, 5)
  const checkFrame = (selected: string, diff = false) => {
    const frame = r.captureCharFrame(); const hint = frame.trimEnd().split('\n').at(-1)!
    expect(frame).toContain(selected)
    expect(hint).toBe(hintLine(diff ? 'git.diff' : 'git.branches', width))
    expect(r.captureSpans().rows).toBe(5)
    for (const line of frame.split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
  }
  f.key('b'); await r.flush(); expect(r.captureCharFrame()).toContain('main')
  checkFrame('main')
  f.key('down'); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.find(c => c.method === 'switchBranch')?.input).toEqual({ name: 'feature', remote: false, confirmed: false })
  f.key('c'); await r.flush(); f.key('down'); f.key('down'); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.filter(c => c.method === 'diff').at(-1)?.input).toEqual({ path: 'a.ts', source: { kind: 'compare', base: hash, head: other } })
  checkFrame('a.ts', true)
  f.setWidth(120); r.resize(120, 5); await r.flush(); f.setWidth(width); r.resize(width, 5); await r.flush()
  checkFrame('a.ts', true)
  f.key('j'); await r.flush(); expect(f.calls.filter(c => c.method === 'diff').at(-1)?.input.path).toBe('b.ts')
  checkFrame('b.ts', true)
  f.key('esc'); await r.flush(); expect(r.captureCharFrame()).toContain('a.ts')
  checkFrame('b.ts')
  f.edit('new-topic'); f.key('n'); await r.flush(); expect(f.calls.find(c => c.method === 'createBranch')?.input).toEqual({ name: 'new-topic', confirmed: false })
  f.setWidth(120); r.resize(120, 5); await r.flush(); f.setWidth(width); r.resize(width, 5); await r.flush()
  expect(r.captureCharFrame()).toContain('a.ts')
  checkFrame('b.ts')
  for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
  f.key('esc'); await r.flush(); expect(f.calls.some(c => c.method === 'graph')).toBe(true)
})

test('Branches retains filtered state across dirty confirmation, refuses cancellation and reports errors', async () => {
  const f = historyFixture(); const r = await f.mount(24, 5)
  f.key('b'); await r.flush(); f.edit('feature'); f.key('f'); await r.flush()
  expect(r.captureCharFrame()).toContain('feature')
  f.handlers.switchBranch = async i => i.confirmed ? { ok: true } : { ok: false, confirm: 'You have uncommitted changes. Switch and carry them over?' }
  f.key('enter'); await r.flush(); expect(f.confirms.at(-1).message).toContain('uncommitted')
  expect(f.calls.filter(c => c.method === 'switchBranch')).toHaveLength(1)
  f.confirm(true); f.key('enter'); await r.flush(); expect(f.calls.filter(c => c.method === 'switchBranch').at(-1)?.input.confirmed).toBe(true)
  f.handlers.compare = async () => { throw new Error('Comparison unavailable.') }
  f.key('c'); await r.flush(); expect(f.notices.at(-1).variant).toBe('error')
})

test('Branches preserves cancelled filters, uses remote provenance, and reports a missing comparison base', async () => {
  const f = historyFixture(); const r = await f.mount(40, 10)
  f.key('b'); await r.flush(); f.key('down'); f.key('down'); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.find(c => c.method === 'switchBranch')?.input).toEqual({ name: 'origin/feature', remote: true, confirmed: false })
  f.edit('feature'); f.key('f'); await r.flush(); f.edit(undefined); f.key('f'); await r.flush()
  expect(f.prompts.at(-1).value).toBe('feature')
  f.handlers.branches = async () => ({ branches: [], base: null }); f.changed(); await r.flush()
  f.key('c'); await r.flush(); expect(f.notices.at(-1).message).toContain('No main branch')
  f.edit('missing'); f.key('f'); await r.flush(); expect(r.captureCharFrame()).toContain('No branches match')
})

test('Branches compares with the exact custom remote base even when local main exists', async () => {
  const f = historyFixture(); const initial = await f.handlers.branches!({}) as { branches: object[] }
  f.handlers.branches = async () => ({ ...initial, base: 'refs/remotes/main', branches: [...initial.branches,
    { name: 'main', remote: true, current: false, upstream: null, gone: false, ahead: 0, behind: 0, hash: '3'.repeat(40) }] })
  const r = await f.mount(40, 5); f.key('b'); await r.flush(); f.key('down'); await r.flush(); f.key('c'); await r.flush()
  expect(f.calls.find(c => c.method === 'compare')?.input).toEqual({ base: 'refs/remotes/main', head: 'refs/heads/feature' })
})
