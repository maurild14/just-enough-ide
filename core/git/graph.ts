import { cellWidth, fitEnd } from '../shared/fit.ts'
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
  let lanes: string[] = []
  for (const commit of commits) {
    let column = lanes.indexOf(commit.hash)
    if (column < 0) { column = lanes.length; lanes.push(commit.hash) }
    const before = [...lanes]
    const next: (string | null)[] = [...lanes]
    next[column] = commit.parents[0] ?? null
    for (const parent of commit.parents.slice(1)) {
      if (!next.includes(parent)) {
        const free = next.indexOf(null)
        if (free >= 0) next[free] = parent
        else next.push(parent)
      }
    }
    lanes = [...new Set(next.filter((hash): hash is string => hash !== null))]
    const edges: [number, number][] = []
    before.forEach((hash, from) => {
      for (const parent of from === column ? commit.parents : [hash]) {
        const to = lanes.indexOf(parent)
        if (to >= 0) edges.push([from, to])
      }
    })
    const changed = lanes.length > 0 && (before.length !== lanes.length || edges.some(([from, to]) => from !== to) || commit.parents.length > 1)
    let connector: string | null = null
    if (changed) {
      const cells = Array<number>(2 * Math.max(before.length, lanes.length) - 1).fill(0)
      for (const [from, to] of edges) {
        const a = 2 * from, b = 2 * to
        cells[a]! |= 1; cells[b]! |= 4
        for (let x = Math.min(a, b); x < Math.max(a, b); x++) { cells[x]! |= 2; cells[x + 1]! |= 8 }
      }
      connector = cells.map((bits) => CONNECTORS[set][bits]!).join('').trimEnd()
    }
    rows.push({ hash: commit.hash, column, lanes: before.length, glyph: before.map((_, i) => i === column ? node : vertical).join(' '), connector })
  }
  return rows
}

/** `maxCells` includes lane separators and the active ellipsis, including ASCII `...`. */
export function fitGraph(row: GraphRow, maxCells: number, ellipsis: string): { glyph: string; connector: string | null } {
  const width = Math.max(0, Math.floor(maxCells))
  if (width === 0) return { glyph: '', connector: row.connector === null ? null : '' }
  if (cellWidth(row.glyph) <= width) return { glyph: row.glyph, connector: row.connector === null ? null : fitEnd(row.connector, width, ellipsis) }
  const marker = cellWidth(ellipsis) < width ? ellipsis : ''
  const count = Math.max(1, Math.floor((width - cellWidth(marker)) / 2))
  const tail = marker ? (2 * count + cellWidth(marker) <= width ? ' ' : '') + marker : ''
  const start = Math.max(0, row.column - count + 1) * 2
  const end = start + 2 * count - 1
  return { glyph: row.glyph.slice(start, end) + tail, connector: row.connector === null ? null : fitEnd(row.connector.slice(start, end), width - cellWidth(tail), '') + tail }
}
