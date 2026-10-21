import { expect, test } from 'bun:test'
import { currentView, initialPane, normalizePane, reducePane, type PaneState } from './pane.ts'

test('initial and tab switch', () => {
  expect(currentView(initialPane('git'))).toBe('git')
  const s = reducePane(initialPane('files'), { type: 'tab', tab: 'search' })
  expect(s.stack).toEqual(['search'])
  expect(currentView(s)).toBe('search')
})

test('open-diff pushes, back pops, back on root is a no-op', () => {
  let s = initialPane('git')
  s = reducePane(s, { type: 'select', view: 'git', id: 'src/a.ts' })
  s = reducePane(s, { type: 'open-diff', path: 'src/a.ts', source: { kind: 'working', staged: true, untracked: false } })
  expect(currentView(s)).toBe('git.diff')
  expect(s.diff).toEqual({ path: 'src/a.ts', source: { kind: 'working', staged: true, untracked: false } })
  s = reducePane(s, { type: 'back' })
  expect(currentView(s)).toBe('git')
  expect(s.selected.git).toBe('src/a.ts')
  expect(s.diff).toBeUndefined()
  expect(reducePane(s, { type: 'back' })).toEqual(s)
})

test('selection survives tab switches; stack does not', () => {
  let s = initialPane('files')
  s = reducePane(s, { type: 'select', view: 'files', id: 'a.ts' })
  s = reducePane(s, { type: 'preview', rel: 'a.ts' })
  expect(s.stack).toEqual(['files', 'files.preview'])
  s = reducePane(s, { type: 'tab', tab: 'git' })
  s = reducePane(s, { type: 'tab', tab: 'files' })
  expect(s.stack).toEqual(['files'])
  expect(s.selected.files).toBe('a.ts')
})

test('preview keeps its originating tab and back returns there', () => {
  for (const tab of ['files', 'search', 'git'] as const) {
    const s = reducePane(initialPane(tab), { type: 'preview', rel: 'a.ts', line: 42 })
    expect(s.tab).toBe(tab)
    expect(s.stack).toEqual([...initialPane(tab).stack, 'files.preview'])
    expect(s.preview).toEqual({ rel: 'a.ts', line: 42 })
    expect(normalizePane(s)).toBe(s)
    const back = reducePane(s, { type: 'back' })
    expect(currentView(back)).toBe(tab)
    expect(back.preview).toBeUndefined()
  }
  const t = reducePane(initialPane('files'), { type: 'open-diff', path: 'a.ts', source: { kind: 'working', staged: false, untracked: true } })
  expect(t.tab).toBe('git')
  expect(t.stack).toEqual(['git', 'git.diff'])
})

test('recent previews deduplicate and retain the last 50 across navigation', () => {
  let state = initialPane('search')
  for (let i = 0; i < 55; i++) state = reducePane(state, { type: 'preview', rel: `${i}.ts` })
  state = reducePane(state, { type: 'preview', rel: '50.ts' })
  expect(state.recent).toHaveLength(50)
  expect(state.recent.slice(0, 3)).toEqual(['50.ts', '54.ts', '53.ts'])
  expect(new Set(state.recent).size).toBe(50)
  state = reducePane(state, { type: 'back' })
  state = reducePane(state, { type: 'tab', tab: 'git' })
  state = reducePane(state, { type: 'branches' })
  expect(state.recent[0]).toBe('50.ts')
  const { recent: _recent, ...retained } = initialPane('files')
  expect(normalizePane(retained).recent).toEqual([])
})

test('Search subviews retain their origin through preview and Back', () => {
  for (const [tab, type, view] of [['search', 'quickopen', 'quickopen'], ['search', 'replace', 'search.replace']] as const) {
    let state = reducePane(initialPane(tab), { type: 'preview', rel: 'old.ts' })
    state = reducePane(state, { type: 'back' })
    state = reducePane(state, { type })
    expect(currentView(state)).toBe(view)
    state = reducePane(state, { type: 'preview', rel: 'next.ts', line: 3 })
    state = reducePane(state, { type: 'back' })
    expect(currentView(state)).toBe(view)
    expect(state.recent).toEqual(['next.ts', 'old.ts'])
    state = reducePane(state, { type: 'back' })
    expect(currentView(state)).toBe(tab)
  }
})

test('reducer does not mutate', () => {
  const s = initialPane('files')
  reducePane(s, { type: 'select', view: 'files', id: 'x' })
  expect(s.selected).toEqual({})
})

test('Search migrates nested Files Search and preview preserves the original tree selection', () => {
  let state = reducePane(initialPane('files'), { type: 'select', view: 'files', id: 'src/old.ts' })
  state = reducePane(state, { type: 'search' })
  state = reducePane(state, { type: 'select', view: 'search', id: 'match-25' })
  state = reducePane(state, { type: 'preview', rel: 'other/new.ts', line: 42 })
  expect(state.tab).toBe('search')
  expect(state.selected.files).toBe('src/old.ts')
  state = reducePane(state, { type: 'back' })
  expect(state.stack).toEqual(['search'])
  expect(state.selected.search).toBe('match-25')
  state = reducePane(state, { type: 'back' })
  expect(state.stack).toEqual(['files'])
  expect(state.selected.files).toBe('src/old.ts')
  const legacy = normalizePane({ tab: 'files', stack: ['files', 'search', 'quickopen'], selected: { search: 'match-25' }, recent: ['other/new.ts'] })
  expect(legacy.tab).toBe('search')
  expect(legacy.stack).toEqual(['search', 'quickopen'])
  expect(normalizePane(legacy)).toBe(legacy)
})

test('legacy working diffs normalize without losing stack, selection or flags', () => {
  for (const staged of [false, true]) for (const untracked of [false, true]) {
    const legacy = { ...initialPane('git'), stack: ['git', 'git.diff'] as const, diff: { path: 'src/a.ts', staged, untracked } }
    const state = normalizePane({ ...legacy, stack: [...legacy.stack] })
    expect(state.diff).toEqual({ path: 'src/a.ts', source: { kind: 'working', staged, untracked } })
    expect(state.stack).toEqual([...legacy.stack])
    expect(state.selected).toBe(legacy.selected)
    expect(legacy.diff).toEqual({ path: 'src/a.ts', staged, untracked })
    expect(normalizePane(state)).toBe(state)
  }
  const root = initialPane('files')
  expect(normalizePane(root)).toBe(root)
})


test('historical diff returns to its Git origin and preserves selections', () => {
  for (const source of [{ kind: 'commit', hash: 'a'.repeat(40) }, { kind: 'compare', base: 'main', head: 'other' }] as const) {
    for (const branches of [false, true]) {
      let state = initialPane('git')
      if (branches) state = reducePane(state, { type: 'branches' })
      const origin = branches ? 'git.branches' : 'git'
      state = reducePane(state, { type: 'select', view: origin, id: 'selected' })
      state = reducePane(state, { type: 'open-diff', path: 'src/a.ts', source })
      expect(state.diff).toEqual({ path: 'src/a.ts', source })
      expect(currentView(state)).toBe('git.diff')
      state = reducePane(state, { type: 'back' })
      expect(currentView(state)).toBe(origin)
      expect(state.selected[origin]).toBe('selected')
    }
  }
})

test('comparison has its own back level and selection', () => {
  let state = reducePane(initialPane('git'), { type: 'select', view: 'git', id: 'graph-selected' })
  state = reducePane(state, { type: 'branches' })
  state = reducePane(state, { type: 'select', view: 'git.branches', id: 'branch-feature' })
  state = reducePane(state, { type: 'compare' })
  state = reducePane(state, { type: 'select', view: 'git.compare', id: 'compare-file-a.ts' })
  state = reducePane(state, { type: 'open-diff', path: 'a.ts', source: { kind: 'compare', base: 'a'.repeat(40), head: 'b'.repeat(40) } })
  for (const view of ['git.compare', 'git.branches', 'git'] as const) {
    state = reducePane(state, { type: 'back' })
    expect(currentView(state)).toBe(view)
  }
  expect(state.selected).toEqual({ git: 'graph-selected', 'git.branches': 'branch-feature', 'git.compare': 'compare-file-a.ts' })
})

test('unknown retained tabs and views reset safely to Files through the generic fallback', () => {
  for (const [tab, stack] of [['symbols', ['symbols']], ['future', ['future']], ['files', ['files', 'symbols.results']], ['files', ['files', 'symbols', 'search']], ['git', ['search']], ['files', []], ['files', ['files', '__proto__']]] as const) {
    const state = normalizePane({ tab, stack: [...stack], selected: { files: 'src/a.ts', search: 'match-1' }, recent: ['src/a.ts'] } as PaneState)
    expect(state).toEqual({ tab: 'files', stack: ['files'], selected: { files: 'src/a.ts', search: 'match-1' }, recent: ['src/a.ts'] })
  }
})

for (const stack of [['git', 'search'], ['files', 'git', 'search']] as const) test(`retained Files rejects the invalid pre-Search stack ${stack.join(' > ')}`, () => {
  const state = normalizePane({ tab: 'files', stack: [...stack], selected: { files: 'src/a.ts', search: 'match-1' }, recent: ['src/a.ts'] })
  expect(state).toEqual({ tab: 'files', stack: ['files'], selected: { files: 'src/a.ts', search: 'match-1' }, recent: ['src/a.ts'] })
})

test('retained Files preview prefix migrates Search and keeps its shared preview', () => {
  const state = normalizePane({ tab: 'files', stack: ['files', 'files.preview', 'search', 'quickopen', 'files.preview'], selected: {}, recent: ['src/a.ts'], preview: { rel: 'src/a.ts', line: 2 } })
  expect(state.tab).toBe('search')
  expect(state.stack).toEqual(['search', 'quickopen', 'files.preview'])
  expect(state.preview).toEqual({ rel: 'src/a.ts', line: 2 })
})
