import { cellWidth, fitEnd, padEnd, printable } from '../shared/fit.ts'
import type { LogCommit } from './log.ts'

export type GraphRow = { hash: string; column: number; lanes: number; glyph: string; connector: string | null }

// Connector cells join up/right/down/left bits (1/2/4/8).
const CONNECTORS = {
  unicode: [' ', '╵', '─', '╰', '╷', '│', '╭', '├', '─', '╯', '─', '┴', '╮', '┤', '┬', '┼'],
  ascii: [' ', '|', '-', '\\', '|', '|', '/', '+', '-', '/', '-', '+', '\\', '+', '+', '+'],
}

export function layoutGraph(commits: readonly LogCommit[], set: 'unicode' | 'ascii'): GraphRow[] {
  const ascii = set === 'ascii'
  const node = ascii ? '*' : '●'
  const vertical = ascii ? '|' : '│'
  const rows: GraphRow[] = []
  let lanes: (string | null)[] = []
  for (const commit of commits) {
    let column = lanes.indexOf(commit.hash)
    if (column < 0) {
      column = lanes.indexOf(null)
      if (column < 0) column = lanes.length
      lanes[column] = commit.hash
    }
    const before = [...lanes]
    const next: (string | null)[] = [...lanes]
    next[column] = null
    for (const [index, parent] of commit.parents.entries()) {
      if (!next.includes(parent)) {
        const free = index === 0 ? column : next.indexOf(null)
        if (free >= 0) next[free] = parent
        else next.push(parent)
      }
    }
    // Moving a live lane through another stem invents a parent junction.
    while (next.at(-1) === null) next.pop()
    lanes = next
    const edges: [number, number][] = []
    before.forEach((hash, from) => {
      for (const parent of from === column ? commit.parents : hash === null ? [] : [hash]) {
        const to = lanes.indexOf(parent)
        if (to >= 0) edges.push([from, to])
      }
    })
    const changed = lanes.length > 0 && (before.length !== lanes.length || edges.some(([from, to]) => from !== to) || commit.parents.length !== 1)
    let connector: string | null = null
    if (changed) {
      const cells = Array<number>(2 * Math.max(before.length, lanes.length) - 1).fill(0)
      const junctions = new Set<number>()
      for (const [from, to] of edges) {
        const a = 2 * from, b = 2 * to
        if (a !== b) { junctions.add(a); junctions.add(b) }
        cells[a]! |= 1; cells[b]! |= 4
        for (let x = Math.min(a, b); x < Math.max(a, b); x++) { cells[x]! |= 2; cells[x + 1]! |= 8 }
      }
      connector = cells.map((bits, x) => bits === 15 && !junctions.has(x) ? ascii ? 'x' : '╳' : CONNECTORS[set][bits]!).join('').trimEnd()
    }
    rows.push({ hash: commit.hash, column, lanes: before.length, glyph: before.map((hash, i) => i === column ? node : hash === null ? ' ' : vertical).join(' '), connector })
  }
  return rows
}

/** `maxCells` includes lane separators and the active ellipsis, including ASCII `...`. */
export function fitGraph(row: GraphRow, maxCells: number, ellipsis: string): { glyph: string; connector: string | null; offset: number } {
  const width = Math.max(0, Math.floor(maxCells))
  if (width === 0) return { glyph: '', connector: row.connector === null ? null : '', offset: 0 }
  if (cellWidth(row.glyph) <= width) return { glyph: row.glyph, connector: row.connector === null ? null : fitEnd(row.connector, width, ellipsis), offset: 0 }
  const marker = cellWidth(ellipsis) < width ? ellipsis : ''
  const count = Math.max(1, Math.floor((width - cellWidth(marker)) / 2))
  const tail = marker ? (2 * count + cellWidth(marker) <= width ? ' ' : '') + marker : ''
  const start = Math.max(0, row.column - count + 1) * 2
  const end = start + 2 * count - 1
  return { glyph: row.glyph.slice(start, end) + tail, connector: row.connector === null ? null : fitEnd(row.connector.slice(start, end), width - cellWidth(tail), '') + tail, offset: start }
}

export type GraphSpan = { text: string; role?: 'lane' | 'head' | 'local' | 'remote' | 'tag' | 'muted' | 'agent'; lane?: number }

/** Shared row anatomy; adapters map semantic roles to their installed host theme. */
export function graphLine(commit: LogCommit, row: GraphRow, width: number, agent: boolean, now: number): { spans: GraphSpan[]; connector: GraphSpan[] } {
  const cells = Math.max(cellWidth(row.glyph), cellWidth(row.connector ?? ''))
  const graph = fitGraph(row, width < 22 ? 0 : Math.min(cells, Math.max(3, Math.floor(width / 4))), '…')
  const lanes = (text: string, source: string): GraphSpan[] => Array.from(text, (text, index) => source[graph.offset + index] === text
    ? { text, role: 'lane', lane: Math.floor((graph.offset + index) / 2) }
    : { text, role: 'muted' })
  const spans: GraphSpan[] = lanes(graph.glyph, row.glyph)
  if (graph.glyph) spans.push({ text: ' ' })
  if (agent && width >= 22) spans.push({ text: '✦ ', role: 'agent' })
  const hash = fitEnd(commit.hash.slice(0, 7), width)
  const available = Math.max(0, width - cellWidth(spans.map(s => s.text).join('')) - cellWidth(hash) - 1)
  const refs: GraphSpan[] = []
  let refWidth = 0
  if (width >= 30) for (const ref of commit.refs) {
    const text = printable(`[${ref.kind === 'head' ? 'HEAD' : `${ref.kind} ${ref.name}`}] `)
    const size = cellWidth(text)
    if (refWidth + size + Math.min(12, cellWidth(commit.subject)) > available) continue
    refs.push({ text, role: ref.kind }); refWidth += size
  }
  spans.push(...refs)
  const seconds = Math.max(0, Math.floor(now / 1000 - commit.time))
  const time = seconds < 60 ? 'now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`
  const metadata = printable(`  ${commit.author} ${time}`)
  const tail = width >= 58 && refWidth + cellWidth(commit.subject + metadata) <= available ? metadata : ''
  const subject = fitEnd(commit.subject, Math.max(0, available - refWidth - cellWidth(tail)))
  spans.push({ text: subject })
  if (tail) spans.push({ text: tail, role: 'muted' })
  const used = spans.map(s => s.text).join('')
  spans.push({ text: padEnd('', Math.max(0, width - cellWidth(used) - cellWidth(hash))) }, { text: hash, role: 'muted' })
  return { spans, connector: lanes(graph.connector ?? '', row.connector ?? '') }
}
