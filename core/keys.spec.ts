import { expect, test } from 'bun:test'
import { hintLine, KEYS, TAB_KEYS, type View } from './keys.ts'

const views = Object.keys(KEYS) as View[]
const named = ['enter', 'esc', 'up', 'down']

test('every key is a letter, digit or a named key', () => {
  for (const view of views)
    for (const k of KEYS[view]) expect(/^[a-z0-9]$/.test(k.key) || named.includes(k.key)).toBe(true)
})

test('no view repeats a key', () => {
  for (const view of views) {
    const keys = KEYS[view].map((k) => k.key)
    expect(new Set(keys).size).toBe(keys.length)
  }
})

test('actions are kebab-case and labels are non-empty', () => {
  for (const view of views)
    for (const k of KEYS[view]) {
      expect(/^[a-z]+(-[a-z]+)*$/.test(k.action)).toBe(true)
      expect(k.label.length).toBeGreaterThan(0)
    }
})

const has = (view: View, keys: string[]) => {
  const have = KEYS[view].map((k) => k.key)
  for (const k of keys) expect(have).toContain(k)
}

test('required keys per view', () => {
  has('files', ['f', 'a', 'o', 'h', 'enter'])
  has('files.preview', ['m', 'a', 'o', 'esc'])
  has('git', ['s', 'u', 'd', 'c', 'g', 'e', 'enter'])
  has('git.diff', ['n', 'p', 'j', 'k', 'a', 'o', 'esc'])
})

test('tab keys', () => {
  expect(TAB_KEYS).toEqual({ '1': 'files', '2': 'search', '3': 'symbols', '4': 'git' })
})

test('hint line fits every width and has no help key', () => {
  for (const view of views)
    for (const w of [1, 10, 24, 31, 32, 40, 80, 120]) {
      const line = hintLine(view, w)
      expect(line.length).toBeLessThanOrEqual(w)
      expect(line.length).toBeGreaterThan(0)
      expect(line).not.toContain('?')
    }
})

test('hint line at 24, 40, 80, 120 and 10', () => {
  expect(hintLine('git', 40)).toBe('↑↓ move · enter open · s stage')
  expect(hintLine('files', 24)).toBe('↑↓ enter a o f h esc')
  expect(hintLine('files', 80)).toBe('↑↓ move · enter open · a mention · o open in editor · f filter · h hidden')
  expect(hintLine('files', 120)).toBe('↑↓ move · enter open · a mention · o open in editor · f filter · h hidden · esc back')
  expect(hintLine('git.diff', 10)).toBe('↑↓ n p j k')
  expect(hintLine('git', 10)).toBe('↑↓ enter s')
  expect(hintLine('git', 1)).toBe('↑')
})

test('wider hint lines extend narrower ones (drop from the end)', () => {
  expect(hintLine('git', 80).startsWith(hintLine('git', 40))).toBe(true)
})
