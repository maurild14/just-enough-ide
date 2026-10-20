import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { cleanup, makeRepo } from '../../test/fake-host.ts'
import { isMerge, logArgs, parseGraphFilter, parseLog } from './log.ts'
import { graph } from './service.ts'

afterEach(cleanup)
const fixture = (name: string) => parseLog(readFileSync(new URL(`../../test/fixtures/git/log-${name}.txt`, import.meta.url), 'utf8'))

test('NUL log fixtures retain parents, metadata, unicode and full decorations', () => {
  const linear = fixture('linear')
  expect(linear).toHaveLength(3)
  expect(linear[0]).toEqual({ hash: 'a'.repeat(40), parents: ['b'.repeat(40)], author: 'Ana Rivera', time: 1700000002,
    refs: [{ kind: 'head', name: 'HEAD' }, { kind: 'local', name: 'main' }, { kind: 'local', name: 'feature/ui' }, { kind: 'remote', name: 'origin/main' }, { kind: 'tag', name: 'v1' }], subject: 'fix: keep ñ' })
  expect(linear[2]?.parents).toEqual([])
  expect(isMerge(fixture('merge')[0]!)).toBe(true)
  expect(fixture('octopus')[0]?.parents).toHaveLength(3)
  expect(parseLog('')).toEqual([])
})

test('log argv separates options and literal paths, and requests the paging sentinel', () => {
  const args = logArgs({ branch: '-x', message: '-fix', author: 'Ana', path: 'src/a b.ts' }, 200)
  expect(args.slice(0, 4)).toEqual(['log', '--topo-order', '--no-color', '-z'])
  expect(args).toContain('--decorate=full')
  expect(args.slice(args.indexOf('-n'), args.indexOf('-n') + 2)).toEqual(['-n', '201'])
  expect(args.slice(-4)).toEqual(['--end-of-options', '-x', '--', 'src/a b.ts'])
  expect(args).toContain('--grep=-fix')
  expect(args).toContain('--author=Ana')
  expect(logArgs({ branch: 'all' }, 1)).toContain('--all')
})

test('filter grammar keeps quoted spaces and ordinary message words', () => {
  expect(parseGraphFilter('author:ana path:"src/a b.ts" fix bug')).toEqual({ author: 'ana', path: 'src/a b.ts', message: 'fix bug' })
  expect(parseGraphFilter('branch:*')).toEqual({ branch: 'all' })
  expect(parseGraphFilter('')).toEqual({})
  expect(parseGraphFilter("author:'Ana Rivera' branch:feature/ui fix ñ")).toEqual({ author: 'Ana Rivera', branch: 'feature/ui', message: 'fix ñ' })
})

test('ordinary apostrophes and quoted field punctuation remain literal', () => {
  expect(parseGraphFilter("don't panic")).toEqual({ message: "don't panic" })
  expect(parseGraphFilter("rock'n'roll author:O'Neil")).toEqual({ message: "rock'n'roll", author: "O'Neil" })
  expect(parseGraphFilter(`path:"src/a'b.ts" don't panic`)).toEqual({ path: "src/a'b.ts", message: "don't panic" })
})

test('real log pages, full refs, unborn HEAD and exact branch validation', async () => {
  const r = await makeRepo({}, 3)
  await r.git('branch', 'feature/ui')
  const first = await graph(r.host, r.dir, {}, 2)
  expect(first.commits).toHaveLength(2)
  expect(first.more).toBe(true)
  expect(first.commits[0]?.refs).toContainEqual({ kind: 'local', name: 'feature/ui' })
  expect((await graph(r.host, r.dir, { branch: 'feature/ui' }, 9)).more).toBe(false)
  for (const branch of ['HEAD~1', 'main..feature/ui', '-x', 'v1']) await expect(graph(r.host, r.dir, { branch }, 2)).rejects.toThrow()
  for (const count of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) await expect(graph(r.host, r.dir, {}, count)).rejects.toThrow()
  expect((await graph(r.host, r.dir, {}, 10001)).commits).toHaveLength(3)
  const unborn = await makeRepo({}, 0)
  expect(await graph(unborn.host, unborn.dir, {}, 2)).toEqual({ commits: [], more: false })
})
