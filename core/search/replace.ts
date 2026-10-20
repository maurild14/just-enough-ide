import type { Match, SearchQuery } from './rg.ts'

export type ReplaceFile = { rel: string; before: string; after: string; count: number }
export type Skipped = { rel: string; reason: 'binary' | 'not-utf8' | 'changed' | 'regex-differs' | 'outside-root' | 'too-large' | 'unreadable' | 'unsupported-path' }

export function planReplace(q: SearchQuery, replacement: string, files: { rel: string; text: string; matches: Match[] }[]): { files: ReplaceFile[]; skipped: Skipped[] } {
  const planned: ReplaceFile[] = []
  const skipped: Skipped[] = []
  let regex: RegExp | null = null
  if (q.regex) {
    try { regex = new RegExp(`^(?:${q.text})$`, q.caseSensitive ? 'u' : 'iu') } catch {}
  }
  for (const file of files) {
    let reason: Skipped['reason'] | null = file.text.includes('\0') ? 'binary' : q.regex && !regex ? 'regex-differs' : null
    const lines = file.text.split('\n')
    const starts: number[] = []
    let offset = 0
    for (const line of lines) { starts.push(offset); offset += line.length + 1 }
    const edits: { start: number; end: number; text: string }[] = []
    for (const match of file.matches) {
      if (reason) break
      const line = lines[match.line - 1]?.replace(/\r$/, '')
      if (match.rel !== file.rel || line === undefined || line !== match.text) { reason = 'changed'; break }
      for (const [start, end] of match.ranges) {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > line.length) { reason = 'changed'; break }
        const text = line.slice(start, end)
        if (regex && regex.exec(text)?.[0] !== text) { reason = 'regex-differs'; break }
        const base = starts[match.line - 1]!
        edits.push({ start: base + start, end: base + end, text: regex ? text.replace(regex, replacement) : replacement })
      }
    }
    edits.sort((a, b) => a.start - b.start || a.end - b.end)
    for (let i = 1; i < edits.length; i++) {
      if (edits[i]!.start < edits[i - 1]!.end || edits[i]!.start === edits[i - 1]!.start) reason ??= 'changed'
    }
    if (reason) { skipped.push({ rel: file.rel, reason }); continue }
    if (!edits.length) continue
    let after = ''
    let at = 0
    for (const edit of edits) { after += file.text.slice(at, edit.start) + edit.text; at = edit.end }
    after += file.text.slice(at)
    planned.push({ rel: file.rel, before: file.text, after, count: edits.length })
  }
  return { files: planned, skipped }
}

export function previewText(file: ReplaceFile): string {
  const lines = (text: string) => text === '' ? [] : text.replace(/\n$/, '').split('\n')
  const before = lines(file.before)
  const after = lines(file.after)
  const rows = [`diff --git ${JSON.stringify(`a/${file.rel}`)} ${JSON.stringify(`b/${file.rel}`)}`,
    `--- ${JSON.stringify(`a/${file.rel}`)}`, `+++ ${JSON.stringify(`b/${file.rel}`)}`,
    `@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@`]
  for (const [text, side, original] of [[before, '-', file.before], [after, '+', file.after]] as const) {
    for (const line of text) rows.push(side + line)
    if (text.length && !original.endsWith('\n')) rows.push('\\ No newline at end of file')
  }
  return rows.join('\n') + '\n'
}
