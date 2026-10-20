import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { cellWidth } from '../shared/fit.ts'
import { fitGraph, layoutGraph } from './graph.ts'
import { parseLog, type LogCommit } from './log.ts'

const fixture = (name: string) => parseLog(readFileSync(new URL(`../../test/fixtures/git/log-${name}.txt`, import.meta.url), 'utf8'))

test('linear commits and terminal root have no connectors', () => {
  for (const row of layoutGraph(fixture('linear'), 'unicode')) {
    expect(row.column).toBe(0)
    expect(row.connector).toBeNull()
  }
})

test('merge opens two lanes, common parent merges them and octopus opens three', () => {
  const rows = layoutGraph(fixture('merge'), 'unicode')
  expect(rows[0]?.connector).toBe('├─╮')
  expect(rows[1]?.lanes).toBe(2)
  expect(rows[2]?.connector).not.toBeNull()
  expect(rows[3]?.lanes).toBe(1)
  expect(layoutGraph(fixture('octopus'), 'unicode')[1]?.lanes).toBe(3)
})

test('middle-lane merges preserve unrelated continuations and distinct parent sets', () => {
  const commit = (hash: string, parents: string[]): LogCommit => ({ hash, parents, author: 'Ana Rivera', time: 0, refs: [], subject: hash })
  for (const set of ['unicode', 'ascii'] as const) {
    const history = [commit('M', ['A', 'B', 'C']), commit('A', ['P']), commit('B', ['P']), commit('C', ['P']), commit('P', [])]
    const simple = layoutGraph(history, set)
    const extra = layoutGraph(history.map((c) => c.hash === 'B' ? { ...c, parents: ['P', 'C'] } : c), set)
    expect(simple[2]?.connector).not.toBe(extra[2]?.connector)
    expect(simple[3]?.column).toBe(2)
    expect(simple[3]?.glyph).toBe(set === 'unicode' ? '│   ●' : '|   *')
    expect(simple[4]?.lanes).toBe(1)
  }
})

test('passing crossings differ from parent junctions at a live intermediate lane', () => {
  const commit = (hash: string, parents: string[]): LogCommit => ({ hash, parents, author: 'Ana Rivera', time: 0, refs: [], subject: hash })
  for (const set of ['unicode', 'ascii'] as const) {
    const history = [commit('M', ['A', 'B', 'C']), commit('C', ['A'])]
    const passing = layoutGraph(history, set)[1]!
    const joined = layoutGraph([history[0]!, commit('C', ['A', 'B'])], set)[1]!
    expect(passing.connector).toContain(set === 'unicode' ? '╳' : 'x')
    expect(passing.connector).not.toBe(joined.connector)
    expect(joined.connector).not.toContain(set === 'unicode' ? '╳' : 'x')
    expect(cellWidth(set === 'unicode' ? '╳' : 'x')).toBe(1)
  }
})

test('missing parents stay live; ASCII has no box characters; glyph widths count lane cells', () => {
  const missing = [{ ...fixture('linear')[0]!, parents: ['missing'] }] as LogCommit[]
  expect(() => layoutGraph(missing, 'unicode')).not.toThrow()
  for (const name of ['linear', 'merge', 'octopus']) {
    for (const row of layoutGraph(fixture(name), 'unicode')) expect(cellWidth(row.glyph)).toBe(2 * row.lanes - 1)
    for (const row of layoutGraph(fixture(name), 'ascii')) expect(row.glyph + (row.connector ?? '')).toMatch(/^[*x |/\\+\-]*$/)
  }
})

test('fit uses real cell budgets, keeps the commit and includes the configured ellipsis', () => {
  for (const column of [0, 3, 5]) {
    const row = { hash: 'x', column, lanes: 6, glyph: Array.from({ length: 6 }, (_, i) => i === column ? '●' : '│').join(' '), connector: '│ │ │ │ │ │' }
    expect(fitGraph(row, 5, '…').glyph).toContain('●')
    expect(fitGraph(row, 5, '…').glyph).toEndWith('…')
    if (column === 0) expect(fitGraph(row, 5, '…').glyph).toBe('● │ …')
    for (const ellipsis of ['…', '...', '界']) for (let width = 0; width <= 12; width++) {
      const fitted = fitGraph(row, width, ellipsis)
      expect(cellWidth(fitted.glyph)).toBeLessThanOrEqual(width)
      expect(cellWidth(fitted.connector ?? '')).toBeLessThanOrEqual(width)
      if (width > 0) expect(fitted.glyph).toContain('●')
      else expect(fitted.glyph).toBe('')
    }
  }
})
