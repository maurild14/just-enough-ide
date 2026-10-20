import { expect, test } from 'bun:test'
import { MATCH_CAP, ResultSet, replaceAskText, sendText } from './results.ts'
import type { Match } from './rg.ts'

const match = (rel = 'a.ts', line = 1): Match => ({ rel, line, text: '  target  ', ranges: [[2, 8]] })
test('result cap rejects overflow and groups retain first arrival order', () => {
  const results = new ResultSet()
  results.add(match('b.ts')); results.add(match('a.ts')); results.add(match('b.ts', 2))
  expect(results.groups().map((group) => [group.rel, group.matches.length])).toEqual([['b.ts', 2], ['a.ts', 1]])
  for (let i = 3; i < MATCH_CAP; i++) expect(results.add(match())).toBe(true)
  expect(results.add(match())).toBe(false)
  expect(results.total()).toBe(2000)
  expect(results.files()).toBe(2)
  expect(results.truncated()).toBe(true)
})
test('agent text trims snippets and caps without losing the omitted count', () => {
  expect(sendText('target', [match()])).toBe('a.ts:1 (target)')
  const text = sendText('target', Array.from({ length: 20 }, (_, i) => match('a.ts', i + 1)), 120)
  expect(text.startsWith('These are the 20 uses of target:')).toBe(true)
  expect(text.length).toBeLessThanOrEqual(120)
  expect(text).toMatch(/…and \d+ more\.$/)
  expect(sendText('x', [{ ...match(), text: 'x'.repeat(100) }])).toBe(`a.ts:1 (${'x'.repeat(80)})`)
  expect(sendText('x'.repeat(200), [match(), match()], 20).length).toBeLessThanOrEqual(20)
})

test('replace Ask retains complete locations and omitted counts within its cap', () => {
  const query = { text: 'target', caseSensitive: true, regex: false, wholeWord: false, include: [], exclude: [] }
  expect(replaceAskText(query, '$1', [match()])).toBe('Replace "target" with "$1" in: a.ts:1')
  const matches = Array.from({ length: 2000 }, (_, i) => match(`src/${'a'.repeat(50)}-${i}.ts`, 123456))
  const text = replaceAskText(query, 'done', matches)
  expect(text.length).toBeLessThanOrEqual(12_000)
  const shown = [...text.matchAll(/src\/a+-\d+\.ts:123456/g)].length
  expect(shown).toBeGreaterThan(0)
  expect(text).toEndWith(`, …and ${matches.length - shown} more.`)
  const huge = replaceAskText({ ...query, text: 'x'.repeat(13_000) }, 'y'.repeat(13_000), matches)
  expect(huge.length).toBeLessThanOrEqual(12_000)
  expect(huge).toEndWith('…and 2000 more.')
})
