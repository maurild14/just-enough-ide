import { expect, test } from 'bun:test'
import { currentView, initialPane, reducePane } from './pane.ts'

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

test('preview and diff from another tab switch to it', () => {
  const s = reducePane(initialPane('git'), { type: 'preview', rel: 'a.ts' })
  expect(s.tab).toBe('files')
  expect(s.stack).toEqual(['files', 'files.preview'])
  const t = reducePane(initialPane('files'), { type: 'open-diff', path: 'a.ts', source: { kind: 'working', staged: false, untracked: true } })
  expect(t.tab).toBe('git')
  expect(t.stack).toEqual(['git', 'git.diff'])
})

test('reducer does not mutate', () => {
  const s = initialPane('files')
  reducePane(s, { type: 'select', view: 'files', id: 'x' })
  expect(s.selected).toEqual({})
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
