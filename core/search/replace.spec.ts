import { expect, test } from 'bun:test'
import { parseUnifiedDiff } from '../git/diff.ts'
import { planReplace, previewText } from './replace.ts'
import type { SearchQuery } from './rg.ts'

const query: SearchQuery = { text: 'target', caseSensitive: true, regex: false, wholeWord: false, include: [], exclude: [] }
test('literal replacement keeps exact matches and reports case differences in the same file', () => {
  for (const text of ['user User USER\n', 'user\nUser\nUSER\nuser\n']) {
    const matches = text.trimEnd().split('\n').map((line, i) => ({ rel: 'a.ts', line: i + 1, text: line, ranges: [...line.matchAll(/user/gi)].map(m => [m.index, m.index + 4] as [number, number]) }))
    expect(planReplace({ ...query, text: 'user', caseSensitive: false }, 'account', [{ rel: 'a.ts', text, matches }])).toEqual({
      files: [{ rel: 'a.ts', before: text, after: text.replaceAll('user', 'account'), count: text.startsWith('user User') ? 1 : 2 }],
      skipped: [{ rel: 'a.ts', reason: 'case-differs' }],
    })
  }
})
test('all case-different literal matches produce no writes', () => {
  expect(planReplace({ ...query, text: 'user', caseSensitive: false }, 'account', [{ rel: 'a.ts', text: 'User USER', matches: [{ rel: 'a.ts', line: 1, text: 'User USER', ranges: [[0, 4], [5, 9]] }] }])).toEqual({ files: [], skipped: [{ rel: 'a.ts', reason: 'case-differs' }] })
})
test('omitted case differences still validate stale lines, malformed and overlapping ranges', () => {
  for (const ranges of [[[0, 4], [0, 4]], [[0, 4], [-1, 3]], [[0, 4], [0, 20]]] as [number, number][][]) {
    expect(planReplace({ ...query, text: 'user', caseSensitive: false }, 'account', [{ rel: 'a.ts', text: 'User', matches: [{ rel: 'a.ts', line: 1, text: 'User', ranges }] }])).toEqual({ files: [], skipped: [{ rel: 'a.ts', reason: 'changed' }] })
  }
  expect(planReplace({ ...query, text: 'user' }, 'account', [{ rel: 'a.ts', text: 'User', matches: [{ rel: 'a.ts', line: 1, text: 'USER', ranges: [[0, 4]] }] }])).toEqual({ files: [], skipped: [{ rel: 'a.ts', reason: 'changed' }] })
})
test('literal replacement uses UTF-16 ranges and preserves CRLF and dollar text', () => {
  const result = planReplace(query, '$1', [{ rel: 'a.ts', text: 'ñ 😀 target\r\ntarget\r\n', matches: [
    { rel: 'a.ts', line: 1, text: 'ñ 😀 target', ranges: [[5, 11]] },
    { rel: 'a.ts', line: 2, text: 'target', ranges: [[0, 6]] },
  ] }])
  expect(result).toEqual({ files: [{ rel: 'a.ts', before: 'ñ 😀 target\r\ntarget\r\n', after: 'ñ 😀 $1\r\n$1\r\n', count: 2 }], skipped: [] })
})
test('regex captures expand while incompatible engines refuse the whole file', () => {
  const file = { rel: 'a.ts', text: 'abc123\n', matches: [{ rel: 'a.ts', line: 1, text: 'abc123', ranges: [[0, 6]] as [number, number][] }] }
  expect(planReplace({ ...query, regex: true, text: '([a-z]+)(\\d+)' }, '$2-$1-$&', [file]).files[0]?.after).toBe('123-abc-abc123\n')
  for (const text of ['(?i)abc', 'other']) {
    expect(planReplace({ ...query, regex: true, text }, '', [file])).toEqual({ files: [], skipped: [{ rel: 'a.ts', reason: 'regex-differs' }] })
  }
})
test('stale line text, overlapping ranges and binary contents never plan writes', () => {
  const file = { rel: 'a.ts', text: 'target\n', matches: [{ rel: 'a.ts', line: 1, text: 'changed', ranges: [[0, 6]] as [number, number][] }] }
  expect(planReplace(query, '', [file]).skipped).toEqual([{ rel: 'a.ts', reason: 'changed' }])
  expect(planReplace(query, '', [{ ...file, text: 'target\0' }]).skipped[0]?.reason).toBe('binary')
  expect(planReplace(query, '', [{ ...file, matches: [{ ...file.matches[0]!, text: 'target', ranges: [[0, 6], [0, 6]] }] }]).skipped[0]?.reason).toBe('changed')
})
test('preview is a parseable unified diff even for odd names and no final newline', () => {
  for (const rel of ['src/a b.ts', 'a\nb.ts', '漢.ts']) {
    const diff = parseUnifiedDiff(previewText({ rel, before: 'one\r\ntwo', after: 'one\r\nthree', count: 1 }))[0]!
    expect(diff.path).toBe(rel)
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(1)
    expect(diff.hunks[0]?.lines.filter((line) => line.kind === 'meta')).toHaveLength(2)
  }
})

test('replacement previews localize changes with three context lines and merge nearby hunks', () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const after = before.replace('line 5\n', 'changed 5\n').replace('line 7\n', 'changed 7\n').replace('line 25\n', 'changed 25\n')
  const diff = parseUnifiedDiff(previewText({ rel: 'a.ts', before, after, count: 3 }))[0]!
  expect(diff.hunks.map(h => h.header)).toEqual(['@@ -2,9 +2,9 @@', '@@ -22,7 +22,7 @@'])
  expect(diff.added).toBe(3)
  expect(diff.removed).toBe(3)
  const single = parseUnifiedDiff(previewText({ rel: 'a.ts', before: before.split('\n').slice(0, 10).join('\n') + '\n', after: before.split('\n').slice(0, 10).join('\n').replace('line 5', 'changed') + '\n', count: 1 }))[0]!
  expect(single.hunks[0]?.header).toBe('@@ -2,7 +2,7 @@')
})

test('multiline replacement preview trims common prefix/suffix and handles newline-only edits', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const after = before.replace('line 10\n', 'first\nsecond\n')
  const diff = parseUnifiedDiff(previewText({ rel: 'a.ts', before, after, count: 1 }))[0]!
  expect(diff.hunks[0]?.header).toBe('@@ -7,7 +7,8 @@')
  expect(diff.added).toBe(2)
  expect(diff.removed).toBe(1)
  const newline = parseUnifiedDiff(previewText({ rel: 'a.ts', before: 'one', after: 'one\n', count: 1 }))[0]!
  expect(newline.added).toBe(1)
  expect(newline.removed).toBe(1)
  expect(newline.hunks[0]?.lines.filter(line => line.kind === 'meta')).toHaveLength(1)
  const appended = parseUnifiedDiff(previewText({ rel: 'a.ts', before: 'one', after: 'one\ntwo', count: 1 }))[0]!
  expect(appended.added).toBe(2)
  expect(appended.removed).toBe(1)
  expect(appended.hunks[0]?.lines.filter(line => line.kind === 'meta')).toHaveLength(2)
  expect(parseUnifiedDiff(previewText({ rel: 'a.ts', before: 'same\n', after: 'same\n', count: 1 }))[0]?.hunks).toEqual([])
})

test('whole-word replacement refuses Unicode word neighbors including astral letters', () => {
  for (const text of ['señal', 'alü', 'al\u0301', 'al\u200c', '𝒜al']) {
    const start = text.indexOf('al')
    const file = { rel: 'a.ts', text, matches: [{ rel: 'a.ts', line: 1, text, ranges: [[start, start + 2]] as [number, number][] }] }
    expect(planReplace({ ...query, text: 'al', wholeWord: true }, 'el', [file])).toEqual({ files: [], skipped: [{ rel: 'a.ts', reason: 'regex-differs' }] })
  }
})
