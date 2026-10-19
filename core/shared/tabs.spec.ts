import { expect, test } from 'bun:test'
import { tabBar, TAB_NAMES } from './tabs.ts'

const text = (b: ReturnType<typeof tabBar>) => b.labels.map((l) => l.label).join(' '.repeat(b.gap))

test('wide panes name every tab with a 2-space gap', () => {
  const b = tabBar(80, 79, 'files')
  expect(text(b)).toBe('1 Files  2 Search  3 Symbols  4 Git')
  expect(b.width).toBe(35)
})

test('32-59 columns name only the active tab', () => {
  expect(text(tabBar(40, 39, 'git'))).toBe('1  2  3  4 Git')
})

test('below 32 columns tabs are numbers only', () => {
  expect(text(tabBar(24, 23, 'git'))).toBe('1  2  3  4')
})

test('chrome is budgeted: the gap shrinks before the labels', () => {
  const s = tabBar(32, 31, 'files', 4)
  expect(s.labels[0]!.label).toBe('1 Files')
  expect(s.gap).toBe(1)
  expect(s.width).toBe(29)
  const xs = tabBar(24, 23, 'files', 4)
  expect(xs.gap).toBe(1)
  expect(xs.width).toBe(23)
})

test('labels shorten when even a zero gap does not fit', () => {
  const b = tabBar(100, 30, 'search', 4)
  expect(b.labels.map((l) => l.label)).toEqual(['1', '2 Search', '3', '4'])
  expect(b.width).toBeLessThanOrEqual(30)
})

test('width never exceeds room while any form fits, at every width', () => {
  for (let columns = 1; columns <= 200; columns++) {
    for (const chrome of [0, 4]) {
      const b = tabBar(columns, columns - 1, 'symbols', chrome)
      const minimum = 4 * (1 + chrome)
      if (columns - 1 >= minimum) expect(b.width).toBeLessThanOrEqual(columns - 1)
      expect(b.width).toBe(b.labels.reduce((n, l) => n + l.label.length + chrome, 0) + b.gap * 3)
    }
  }
})

test('the active tab is always named when it fits', () => {
  expect(tabBar(50, 49, 'symbols', 4).labels[2]!.label).toBe(`3 ${TAB_NAMES.symbols}`)
})
