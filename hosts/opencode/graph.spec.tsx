import { expect, test } from 'bun:test'
import { RGBA } from '@opentui/core'
import { historyFixture, hash, commit, repo } from '../../test/opencode-history.tsx'
import { paneMemory } from './pane.tsx'
import { cellWidth } from '../../core/shared/fit.ts'
import { hintLine, KEYS } from '../../core/keys.ts'

for (const action of ['stage', 'unstage', 'discard'] as const) test(`working selection remains reachable after ${action} with history`, async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  const entry = (path: string, staged = false) => ({ path, index: staged ? 'modified' : null, worktree: staged ? null : 'modified' })
  f.setGit(repo([entry('src/app.ts', action === 'unstage'), entry('other.ts')]))
  f.handlers[action] = async () => { f.setGit(repo(action === 'discard' ? [entry('other.ts')] : [entry('src/app.ts', action === 'stage'), entry('other.ts')])); return {} }
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], recent: [], selected: { git: `${action === 'unstage' ? 'staged' : 'changes'}-src/app.ts` } } })
  const r = await f.mount(24, 5)
  f.confirm(true); f.key(action === 'stage' ? 's' : action === 'unstage' ? 'u' : 'd'); await r.flush()
  expect(f.calls.some(call => call.method === action)).toBe(true)
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.git).toBe(`group-${action === 'stage' ? 'staged' : 'changes'}`)
  expect(r.captureCharFrame()).toContain(action === 'stage' ? 'Staged' : 'Changes')
  f.key('s'); await r.flush()
  expect(f.calls.filter(call => call.method === 'stage').length).toBeGreaterThan(0)
})

test('history colors stay chromatic when primary equals base, with readable selected rows', async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  f.ctx.theme.text.action.primary.base = f.ctx.theme.text.base
  f.handlers.graph = async () => ({ commits: [{ ...commit, refs: [{ kind: 'head', name: 'HEAD' }] }], more: false })
  const r = await f.mount(120, 12)
  let spans = r.captureSpans().lines.flatMap(line => line.spans)
  for (const text of ['●', '[HEAD]']) expect(spans.find(span => span.text.includes(text))?.fg).toEqual(RGBA.fromHex('#ff00ff'))
  update(d => { d.panes['session-a']!.selected.git = `graph-${hash}` }); await r.flush()
  spans = r.captureSpans().lines.flatMap(line => line.spans)
  expect(spans.find(span => span.text.includes('[HEAD]'))?.fg).toEqual(RGBA.fromHex('#ffffff'))
})

test('selection falls back to working groups without history and to Graph after the final change disappears', async () => {
  const f = historyFixture()
  f.handlers.graph = async () => ({ commits: [], more: false })
  const r = await f.mount(24, 5)
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.git).toBe('group-staged')
  const [, update] = paneMemory(f.ctx)
  update(d => { d.panes['session-a']!.selected.git = 'changes-src/app.ts' })
  f.handlers.graph = async () => ({ commits: [commit], more: false })
  f.setGit(repo([])); f.changed(); await r.flush()
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.git).toBe('group-graph')
})

test('colored history rows end with hashes and precede working groups', async () => {
  const f = historyFixture()
  f.handlers.graph = async () => ({ commits: [{ ...commit, refs: [
    { kind: 'head', name: 'HEAD' }, { kind: 'local', name: 'main' },
    { kind: 'remote', name: 'origin/main' }, { kind: 'tag', name: 'v1' },
  ] }], more: false })
  const r = await f.mount(120, 24)
  const frame = r.captureCharFrame()
  expect(frame.indexOf('Graph')).toBeLessThan(frame.indexOf('Staged'))
  const line = r.captureSpans().lines.find(line => line.spans.some(span => span.text.includes('1111111')))!
  expect(line.spans.map(span => span.text).join('').trimEnd()).toEndWith('1111111')
  expect(line.spans.find(span => span.text.includes('[local main]'))?.fg).toEqual(RGBA.fromHex('#008000'))
  expect(line.spans.find(span => span.text.includes('[remote origin/main]'))?.fg).toEqual(RGBA.fromHex('#ffff00'))
})

test('visible Back and q return through diff, comparison, branches and Graph one level at a time', async () => {
  const f = historyFixture(); const r = await f.mount(24, 5)
  f.key('b'); await r.flush()
  expect(r.captureCharFrame()).toContain('Back')
  f.key('down'); await r.flush(); f.key('c'); await r.flush()
  expect(paneMemory(f.ctx)[0].panes['session-a']!.stack).toEqual(['git', 'git.branches', 'git.compare'])
  f.key('enter'); await r.flush()
  for (const view of ['git.compare', 'git.branches', 'git'] as const) {
    expect(r.captureCharFrame()).toContain('Back')
    f.key('q'); await r.flush()
    expect(paneMemory(f.ctx)[0].panes['session-a']!.stack.at(-1)).toBe(view)
  }
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected['git.branches']).toBe('branch-refs/heads/feature')
})

for (const input of ['keyboard', 'mouse'] as const) test(`Back survives a failed state refresh via ${input}`, async () => {
  const f = historyFixture(); const r = await f.mount(24, 5)
  f.key('b'); await r.flush()
  f.handlers.state = async () => { throw new Error('State unavailable.') }
  f.changed(); await r.flush()
  expect(r.captureCharFrame()).toContain('State unavailable.')
  expect(r.captureCharFrame()).toContain('q Back')
  if (input === 'keyboard') f.key('q')
  else {
    const lines = r.captureCharFrame().split('\n'); const y = lines.findIndex(line => line.includes('Back'))
    await r.mockMouse.click(lines[y]!.indexOf('Back') + 1, y)
  }
  await r.flush()
  expect(paneMemory(f.ctx)[0].panes['session-a']!.stack).toEqual(['git'])
})

test('a full Graph page collapses so working changes remain reachable', async () => {
  const f = historyFixture()
  f.handlers.graph = async () => ({ commits: Array.from({ length: 200 }, (_, i) => ({ ...commit, hash: i.toString(16).padStart(40, '0'), parents: [], refs: [], subject: `Change ${i}` })), more: false })
  const r = await f.mount(24, 5)
  expect(r.captureCharFrame()).toContain('Graph')
  f.key('enter'); await r.flush()
  f.key('down'); await r.flush()
  expect(r.captureCharFrame()).toContain('Staged')
  f.key('down'); await r.flush(); f.key('u'); await r.flush()
  expect(f.calls.some(call => call.method === 'unstage')).toBe(true)
})

test('merge topology preserves fork connectors and side-lane positions through narrow resize', async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  const left = '2'.repeat(40); const right = '3'.repeat(40); const parent = '4'.repeat(40)
  f.handlers.graph = async () => ({ commits: [
    { ...commit, parents: [left, right] },
    { ...commit, hash: left, parents: [parent], agent: false },
    { ...commit, hash: right, parents: [parent], agent: false },
    { ...commit, hash: parent, parents: [], agent: false },
  ], more: false })
  const r = await f.mount(80, 24)
  expect(r.captureCharFrame()).toContain('├─╮')
  expect(r.captureCharFrame().split('\n').find(line => line.includes('3333333'))?.trim()).toMatch(/^│ ● .*3333333$/)
  update(d => { d.panes['session-a']!.selected.git = `graph-${right}` })
  f.setWidth(24); r.resize(24, 5); await r.flush()
  expect(r.captureCharFrame().split('\n').find(line => line.includes('3333333'))?.trim()).toMatch(/^│ ● .*3333333$/)
  expect(r.captureSpans().rows).toBe(5)
  for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(24)
})

test('expanded commit files show a muted nonselectable loading row until the reply arrives', async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], recent: [], selected: { git: `graph-${hash}` } } })
  let release!: (value: unknown) => void
  const files = f.handlers.commitFiles!
  f.handlers.commitFiles = () => new Promise(resolve => { release = resolve })
  const r = await f.mount(40, 12)
  f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('Loading…')
  const loading = r.captureSpans().lines.find(line => line.spans.some(span => span.text.includes('Loading…')))
  expect(loading?.spans.find(span => span.text.includes('Loading…'))?.fg).toEqual(RGBA.fromHex('#808080'))
  f.key('down'); await r.flush()
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.git).toBe(`checkout-${hash}`)
  release(await files({ hash })); await r.flush()
  expect(r.captureCharFrame()).not.toContain('Loading…')
  expect(r.captureCharFrame()).toContain('a.ts')
})

for (const width of [24, 40]) test(`working hints omit commit-only keys at ${width} columns`, async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], recent: [], selected: { git: 'changes-src/app.ts' } } })
  const r = await f.mount(width, 5)
  const hint = () => r.captureCharFrame().trimEnd().split('\n').at(-1)!
  expect(hint()).toBe(hintLine('git', width, KEYS.git.filter(key => !['copy-hash', 'ask', 'new-branch'].includes(key.action))))
  for (const key of ['y', 'a', 'n']) expect(hint().split(/\s+/)).not.toContain(key)
  for (const key of ['g', 'e']) expect(hint().split(/\s+/)).toContain(key)
  update(d => { d.panes['session-a']!.selected.git = `graph-${hash}` }); await r.flush()
  for (const key of ['y', 'a', 'n']) expect(hint().split(/\s+/)).toContain(key)
})

for (const width of [24, 40, 80, 120]) test(`Graph shares selection, expands and navigates commit diffs at ${width} columns and five rows`, async () => {
  const f = historyFixture(); const [, update] = paneMemory(f.ctx)
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], recent: [], selected: { git: `graph-${hash}` } } })
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
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], recent: [], selected: { git: `graph-${hash}` } } })
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
  update(d => { d.panes['session-a'] = { tab: 'git', stack: ['git'], recent: [], selected: { git: `graph-${hash}` } } })
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
