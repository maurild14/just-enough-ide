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
  has('git', ['s', 'u', 'd', 'c', 'y', 'a', 'b', 'f', 't', 'n', 'g', 'e', 'enter'])
  has('git.branches', ['up', 'down', 'enter', 'n', 'c', 'f', 'esc'])
  has('git.diff', ['n', 'p', 'j', 'k', 'a', 'o', 'esc'])
})

test('every submenu has shared q back alongside the OpenCode escape alias', () => {
  for (const view of views) {
    expect(KEYS[view].find(key => key.key === 'q')?.action).toBe('back')
    expect(KEYS[view].find(key => key.key === 'esc')?.action).toBe('back')
  }
})

test('tab keys', () => {
  expect(TAB_KEYS).toEqual({ '1': 'files', '2': 'search', '3': 'symbols', '4': 'git' })
})

test('hint line fits every width and has no help key', () => {
  for (const view of views)
    for (const w of [1, 10, 24, 31, 32, 40, 80, 120]) {
      const line = hintLine(view, w)
      expect(line.length).toBeLessThanOrEqual(w)
      expect(line).not.toContain('?')
    }
})

test('hint line at 24, 40, 80 and 10', () => {
  expect(hintLine('git', 40)).toBe('↑↓ enter s u d c y a b f t n g e q esc')
  expect(hintLine('git', 24)).toBe('↑↓ s u d c y a b f t esc')
  expect(hintLine('files', 24)).toBe('↑↓ enter a o f h q esc')
  expect(hintLine('files', 40)).toBe('↑↓ move · enter open · a o f h q esc')
  expect(hintLine('files', 80)).toBe('↑↓ move · enter open · a mention · o open in editor · f filter · h q esc')
  expect(hintLine('files', 120)).toBe('↑↓ move · enter open · a mention · o open in editor · f filter · h hidden · q back · esc back')
  expect(hintLine('git.diff', 10)).toBe('↑↓ n p esc')
  expect(hintLine('git', 10)).toBe('↑↓ s u esc')
})

test('hint line at every width: fits, whole words, keys never drop, esc kept', () => {
  for (const view of views) {
    const names = new Set(KEYS[view].map((k) => (k.key === 'up' || k.key === 'down' ? '↑↓' : k.key)))
    const words = new Set(KEYS[view].flatMap((k) => k.label.split(' ')))
    let prev = 0
    for (let w = 0; w <= 140; w++) {
      const line = hintLine(view, w)
      expect(line.length).toBeLessThanOrEqual(w)
      const tokens = line.split(/ · | /).filter(Boolean)
      for (const t of tokens) expect(names.has(t) || words.has(t)).toBe(true)
      const count = tokens.filter((t) => names.has(t)).length
      expect(count).toBeGreaterThanOrEqual(prev)
      prev = count
      if (w >= 3 && names.has('esc')) expect(tokens).toContain('esc')
    }
  }
})

test('hint line edge widths', () => {
  expect(hintLine('git', 3)).toBe('esc')
  expect(hintLine('git', 2)).toBe('↑↓')
  expect(hintLine('git', 1)).toBe('s')
  expect(hintLine('git', 0)).toBe('')
})

test('the OpenCode hint line never shows a colon and separates the bare tail', () => {
  for (const view of views)
    for (const w of [24, 40, 80, 120]) {
      const line = hintLine(view, w)
      expect(line).not.toContain(':')
      // A labelled prefix and a bare tail meet at ` · `, never at a lone space after a label.
      const words = new Set(KEYS[view].flatMap((k) => k.label.split(' ')))
      const parts = line.split(' · ')
      for (const part of parts.slice(0, -1)) expect(words.has(part.split(' ').at(-1)!) || part.split(' ').length === 1).toBe(true)
    }
  expect(hintLine('git', 80)).toBe('↑↓ move · enter open · s stage · u unstage · d discard · c y a b f t n g e q esc')
})
