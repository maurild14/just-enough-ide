import { cellWidth, fitEnd, padEnd } from '../shared/fit.ts'

/** Parse delimited text into rows of cells: quoted fields, "" escapes, quoted newlines, CRLF. At most `maxRows` rows. */
export function parseDelimited(text: string, delimiter: ',' | '\t', maxRows: number): string[][] {
  const rows: string[][] = []
  if (maxRows <= 0) return rows
  let row: string[] = []
  let cell = ''
  let quoted = false
  let pending = false // a row has started (some char, delimiter or quote seen)
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const endRow = (): void => {
    row.push(cell)
    rows.push(row)
    row = []
    cell = ''
    pending = false
  }

  for (let i = 0; i < src.length && rows.length < maxRows; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
      pending = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
      pending = true
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      endRow()
    } else {
      cell += ch
      pending = true
    }
  }
  if (pending && rows.length < maxRows) endRow()
  return rows
}

/**
 * Rows of cells as padded text lines no wider than `width` cells: one space
 * between columns below 60 cells, two from 60. When the table is too wide
 * the widest column shrinks first (cells get an end ellipsis), down to one
 * cell; past that, columns drop from the right. Newlines and tabs in a cell
 * read as spaces; trailing spaces are trimmed.
 */
export function fitTable(rows: readonly (readonly string[])[], width: number, ellipsis = '…'): string[] {
  if (rows.length === 0 || width <= 0) return []
  const cells = rows.map((r) => r.map((c) => c.replace(/[\r\n\t]+/g, ' ')))
  const gap = width >= 60 ? 2 : 1
  const count = Math.max(...cells.map((r) => r.length))
  let widths = Array.from({ length: count }, (_, i) => Math.max(0, ...cells.map((r) => cellWidth(r[i] ?? ''))))
  const total = (ws: number[]) => ws.reduce((a, b) => a + b, 0) + gap * Math.max(0, ws.length - 1)
  while (widths.length > 0 && total(widths) > width) {
    const widest = widths.indexOf(Math.max(...widths))
    if ((widths[widest] ?? 0) > 1) widths[widest] = (widths[widest] ?? 0) - 1
    else widths = widths.slice(0, -1)
  }
  return cells.map((r) =>
    widths
      .map((w, i) => (i === widths.length - 1 ? fitEnd(r[i] ?? '', w, ellipsis) : padEnd(fitEnd(r[i] ?? '', w, ellipsis), w)))
      .join(' '.repeat(gap))
      .trimEnd(),
  )
}
