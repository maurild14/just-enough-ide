import { expect, test } from 'bun:test'
import { parseOptions } from './options.ts'

test('defaults', () => {
  expect(parseOptions({})).toEqual({
    startOpen: true,
    defaultTab: 'files',
    activity: 'reads and writes',
    followAgent: true,
    glyphs: 'auto',
    editorCommand: '',
    commitModel: '',
    smartCommit: true,
    graphLimit: 200,
  })
})

test('on/off strings and numeric strings', () => {
  const o = parseOptions({ startOpen: 'off', graphLimit: '50', followAgent: 'on' })
  expect(o.startOpen).toBe(false)
  expect(o.graphLimit).toBe(50)
  expect(o.followAgent).toBe(true)
})

test('real booleans and numbers (OpenCode)', () => {
  expect(parseOptions({ startOpen: false }).startOpen).toBe(false)
  const o = parseOptions({ smartCommit: false, graphLimit: 30 })
  expect(o.smartCommit).toBe(false)
  expect(o.graphLimit).toBe(30)
})

test('invalid values fall back to defaults', () => {
  const o = parseOptions({ graphLimit: 'x', defaultTab: 'nope', glyphs: 3, activity: 'all', startOpen: 'maybe', editorCommand: 5 })
  expect(o).toEqual(parseOptions({}))
  expect(parseOptions({ graphLimit: 0 }).graphLimit).toBe(200)
  expect(parseOptions({ graphLimit: -4 }).graphLimit).toBe(200)
})

test('valid enums and strings are kept', () => {
  const o = parseOptions({ defaultTab: 'git', activity: 'none', glyphs: 'plain', editorCommand: ' code -g "{path}:{line}" ', commitModel: 'small' })
  expect(o.defaultTab).toBe('git')
  expect(o.activity).toBe('none')
  expect(o.glyphs).toBe('plain')
  expect(o.editorCommand).toBe('code -g "{path}:{line}"')
  expect(o.commitModel).toBe('small')
})
