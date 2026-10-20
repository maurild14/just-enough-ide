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
        if (q.wholeWord && (/[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]$/u.test(line.slice(Math.max(0, start - 2), start)) || /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]/u.test(line.slice(end, end + 2)))) { reason = 'regex-differs'; break }
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
    `--- ${JSON.stringify(`a/${file.rel}`)}`, `+++ ${JSON.stringify(`b/${file.rel}`)}`]
  const same = (old: number, next: number) => before[old] === after[next] &&
    (old < before.length - 1 || file.before.endsWith('\n')) === (next < after.length - 1 || file.after.endsWith('\n'))
  const row = (side: string, index: number, text: string[], original: string) => {
    rows.push(side + text[index])
    if (index === text.length - 1 && !original.endsWith('\n')) rows.push('\\ No newline at end of file')
  }
  const header = (start: number, oldEnd: number, newEnd: number) => rows.push(`@@ -${oldEnd > start ? start + 1 : start},${oldEnd - start} +${newEnd > start ? start + 1 : start},${newEnd - start} @@`)
  if (before.length === after.length) {
    const hunks: { start: number; end: number }[] = []
    for (let i = 0; i < before.length; i++) {
      if (same(i, i)) continue
      const start = Math.max(0, i - 3), end = Math.min(before.length, i + 4)
      const last = hunks.at(-1)
      if (last && start <= last.end) last.end = end
      else hunks.push({ start, end })
    }
    for (const { start, end } of hunks) {
      header(start, end, end)
      for (let i = start; i < end;) {
        if (same(i, i)) { row(' ', i++, before, file.before); continue }
        let next = i + 1
        while (next < end && !same(next, next)) next++
        for (let at = i; at < next; at++) row('-', at, before, file.before)
        for (let at = i; at < next; at++) row('+', at, after, file.after)
        i = next
      }
    }
  } else {
    let prefix = 0, suffix = 0
    while (prefix < Math.min(before.length, after.length) && same(prefix, prefix)) prefix++
    while (suffix < Math.min(before.length, after.length) - prefix && same(before.length - suffix - 1, after.length - suffix - 1)) suffix++
    const start = Math.max(0, prefix - 3), context = Math.min(3, suffix)
    const oldEnd = before.length - suffix + context, newEnd = after.length - suffix + context
    header(start, oldEnd, newEnd)
    for (let i = start; i < prefix; i++) row(' ', i, before, file.before)
    for (let i = prefix; i < before.length - suffix; i++) row('-', i, before, file.before)
    for (let i = prefix; i < after.length - suffix; i++) row('+', i, after, file.after)
    for (let i = before.length - suffix; i < oldEnd; i++) row(' ', i, before, file.before)
  }
  return rows.join('\n') + '\n'
}
