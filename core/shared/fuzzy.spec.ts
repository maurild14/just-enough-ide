import { expect, test } from 'bun:test'
import { fuzzyScore } from './fuzzy.ts'

const s = (q: string, c: string) => fuzzyScore(q, c) as number

test('word-start and basename match beats scattered match', () => {
  expect(s('usr', 'src/api/user.ts')).toBeGreaterThan(s('usr', 'docs/unused/readme.md'))
})

test('no match is null', () => {
  expect(fuzzyScore('xyz', 'a.ts')).toBeNull()
  expect(fuzzyScore('abc', 'ab')).toBeNull()
})

test('basename matches outrank folder matches', () => {
  expect(s('user', 'src/api/user.ts')).toBeGreaterThan(s('user', 'src/user/index.ts'))
})

test('case-insensitive, camelCase and separators count as word starts', () => {
  expect(fuzzyScore('GU', 'getuser.ts')).not.toBeNull()
  expect(s('gu', 'getUser.ts')).toBeGreaterThan(s('gu', 'bigfun.ts'))
  expect(s('ab', 'a-b.ts')).toBeGreaterThan(s('ab', 'xaxb.ts'))
})

test('empty query matches everything', () => {
  expect(fuzzyScore('', 'x')).toBe(0)
})
