import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { cellWidth } from '../shared/fit.ts'
import { fitGraph, graphLine, layoutGraph } from './graph.ts'
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

test('graph presentation ends with an aligned hash and preserves semantic refs and lane colors', () => {
  const commits = fixture('merge')
  const commit = { ...commits[0]!, subject: 'feat: update 界面', refs: [
    { kind: 'head', name: 'HEAD' }, { kind: 'local', name: 'main' },
    { kind: 'remote', name: 'origin/main' }, { kind: 'tag', name: 'v1.0' },
  ] } satisfies LogCommit
  for (const set of ['unicode', 'ascii'] as const) for (const width of [22, 38, 78, 118]) {
    const row = layoutGraph([commit], set)[0]!
    const line = graphLine(commit, row, width, true, commit.time * 1000)
    const text = line.spans.map(s => s.text).join('')
    expect(cellWidth(text)).toBe(width)
    expect(text).toEndWith(commit.hash.slice(0, 7))
    expect(line.spans.find(s => s.role === 'lane')?.lane).toBe(0)
    expect(line.connector.some(s => s.role === 'lane' && s.lane === 1)).toBe(true)
    if (width === 118) for (const role of ['head', 'local', 'remote', 'tag']) expect(line.spans.some(s => s.role === role)).toBe(true)
  }
  const row = { hash: commit.hash, column: 5, lanes: 6, glyph: '│ │ │ │ │ ●', connector: '│ │ │ │ │ │' }
  const clipped = graphLine(commit, row, 22, false, 0)
  expect(clipped.spans.find(s => s.text === '●')?.lane).toBe(5)
  expect(clipped.connector.find(s => s.text === '│')?.lane).toBe(4)
})

test('styled graph spans sanitize every display field without mutating action data', () => {
  const commit = { ...fixture('linear')[0]!, author: 'Ana\tRivera\u001b', subject: 'fix: 界面\t\u0000', refs: [{ kind: 'remote', name: 'origin/界面\t\u001b' }] } satisfies LogCommit
  const original = JSON.stringify(commit)
  for (const width of [22, 38, 78, 118]) {
    const line = graphLine(commit, layoutGraph([commit], 'unicode')[0]!, width, false, 0)
    const text = line.spans.map(span => span.text).join('')
    expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    expect(cellWidth(text)).toBe(width)
    expect(text).toEndWith(commit.hash.slice(0, 7))
  }
  expect(JSON.stringify(commit)).toBe(original)
})
