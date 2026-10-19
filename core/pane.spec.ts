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
  s = reducePane(s, { type: 'open-diff', path: 'src/a.ts', staged: true, untracked: false })
  expect(currentView(s)).toBe('git.diff')
  expect(s.diff).toEqual({ path: 'src/a.ts', staged: true, untracked: false })
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
  const t = reducePane(initialPane('files'), { type: 'open-diff', path: 'a.ts', staged: false, untracked: true })
  expect(t.tab).toBe('git')
  expect(t.stack).toEqual(['git', 'git.diff'])
})

test('reducer does not mutate', () => {
  const s = initialPane('files')
  reducePane(s, { type: 'select', view: 'files', id: 'x' })
  expect(s.selected).toEqual({})
})
