import { expect, test } from 'bun:test'
import { parseQuery, quickOpenArgs, rankFiles } from './quickopen.ts'

test('quick open argv and optional numeric line suffix', () => {
  expect(quickOpenArgs(true)).toEqual(['ls-files', '-co', '--exclude-standard', '-z'])
  expect(quickOpenArgs(false)).toEqual(['rg', '--files', '--no-config', '--null'])
  expect(parseQuery('src/user.ts:42')).toEqual({ name: 'src/user.ts', line: 42 })
  expect(parseQuery('a:b')).toEqual({ name: 'a:b', line: null })
  expect(parseQuery('user.ts:0')).toEqual({ name: 'user.ts:0', line: null })
})
test('ranking prefers touched then recent, basename matches and empty-query path order', () => {
  const tiers = { touched: new Set(['z/user.ts']), recent: ['y/user.ts'] }
  const files = ['a/user.ts', 'z/user.ts', 'y/user.ts', 'not-a-match']
  expect(rankFiles('user', files, tiers, 10)).toEqual(['z/user.ts', 'y/user.ts', 'a/user.ts'])
  expect(rankFiles('user', ['user/component.ts', 'deep/long/user.ts'], { touched: new Set(), recent: [] }, 10)).toEqual(['deep/long/user.ts', 'user/component.ts'])
  expect(rankFiles('', [...files, 'b.ts'], tiers, 4)).toEqual(['z/user.ts', 'y/user.ts', 'a/user.ts', 'b.ts'])
})
