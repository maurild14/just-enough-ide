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
