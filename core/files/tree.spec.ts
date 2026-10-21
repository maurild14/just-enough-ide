import { describe, expect, test } from 'bun:test'
import type { DirEntry } from '../host.ts'
import type { FileStatus } from '../git/status.ts'
import { filterRows, IGNORED_ARGS, reveal, treeRows, type TreeInput } from './tree.ts'

const f = (name: string): DirEntry => ({ name, kind: 'file', size: 1 })
const d = (name: string): DirEntry => ({ name, kind: 'dir', size: 0 })

function input(over: Partial<TreeInput> = {}): TreeInput {
  return {
    root: '/r/acme-app',
    expanded: new Set(),
    listings: new Map([['', [f('b.ts'), d('src'), f('A.md'), d('.git'), d('Docs')]]]),
    ignored: new Set(),
    showHidden: false,
    status: new Map(),
    glow: () => 0,
    touched: () => false,
    limit: 2000,
    ...over,
  }
}

describe('treeRows', () => {
  test('dirs first, then case-insensitive name; .git never shown', () => {
    const rows = treeRows(input())
    expect(rows.map((r) => ('name' in r ? r.name : '?'))).toEqual(['Docs', 'src', 'A.md', 'b.ts'])
    for (const r of treeRows(input({ showHidden: true }))) expect('name' in r && r.name === '.git').toBe(false)
  })

  test('expanded folders list children one level deeper', () => {
    const listings = new Map([
      ['', [d('src'), f('z.ts')]],
      ['src', [f('a.ts'), d('api')]],
    ])
    const rows = treeRows(input({ listings, expanded: new Set(['src']) }))
    expect(rows.map((r) => r.rel)).toEqual(['src', 'src/api', 'src/a.ts', 'z.ts'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0])
    expect(rows[0]).toMatchObject({ isDir: true, isExpanded: true })
    expect(rows[1]).toMatchObject({ isDir: true, isExpanded: false })
  })

  test('limit gives one more row with the remaining count', () => {
    const entries = Array.from({ length: 2001 }, (_, i) => f(`f${String(i).padStart(4, '0')}.ts`))
    const rows = treeRows(input({ listings: new Map([['', entries]]) }))
    expect(rows).toHaveLength(2001)
    expect(rows[2000]).toMatchObject({ more: 1, depth: 0 })
    expect('name' in rows[2000]!).toBe(false)
  })

  test('limit applies per folder', () => {
    const listings = new Map([
      ['', [d('a'), f('x')]],
      ['a', [f('1'), f('2'), f('3')]],
    ])
    const rows = treeRows(input({ listings, expanded: new Set(['a']), limit: 2 }))
    expect(rows.map((r) => ('more' in r ? `+${r.more}` : r.rel))).toEqual(['a', 'a/1', 'a/2', '+1', 'x'])
    expect(rows[3]).toMatchObject({ depth: 1 })
  })

  test('ignored and dot entries show only with showHidden', () => {
    const listings = new Map([['', [f('keep.ts'), f('dist.js'), f('.env')]]])
    const ignored = new Set(['dist.js'])
    expect(treeRows(input({ listings, ignored })).map((r) => r.rel)).toEqual(['keep.ts'])
    expect(treeRows(input({ listings, ignored, showHidden: true })).map((r) => r.rel)).toEqual(['.env', 'dist.js', 'keep.ts'])
  })

  test('glow, touched and status are copied', () => {
    const listings = new Map([['', [f('a.ts'), f('b.ts')]]])
    const status = new Map<string, FileStatus>([['a.ts', 'modified']])
    const rows = treeRows(input({ listings, status, glow: (r) => (r === 'a.ts' ? 5 : 0), touched: (r) => r === 'b.ts' }))
    expect(rows[0]).toMatchObject({ rel: 'a.ts', status: 'modified', glow: 5, touched: false })
    expect(rows[1]).toMatchObject({ rel: 'b.ts', status: null, glow: 0, touched: true })
  })

  test('unlisted expanded folder yields no children', () => {
    const listings = new Map([['', [d('src')]]])
    expect(treeRows(input({ listings, expanded: new Set(['src']) }))).toHaveLength(1)
  })
})

describe('filterRows', () => {
  const all = ['src/user.ts', 'src/api/users.ts', 'README.md', 'docs/guide.md']
  test('fuzzy, best first, capped', () => {
    expect(filterRows(all, 'user', 10)[0]).toBe('src/user.ts')
    expect(filterRows(all, 'user', 10)).toHaveLength(2)
    expect(filterRows(all, 'user', 1)).toHaveLength(1)
    expect(filterRows(all, 'zzz', 10)).toEqual([])
    expect(filterRows(all, 'user', 0)).toEqual([])
  })
})

test('reveal adds parent dirs without mutating', () => {
  const base: ReadonlySet<string> = new Set()
  const out = reveal(base, 'a/b/c.ts')
  expect([...out].sort()).toEqual(['a', 'a/b'])
  expect(base.size).toBe(0)
})

test('IGNORED_ARGS', () => expect([...IGNORED_ARGS]).toEqual(['check-ignore', '--stdin', '-z']))


test('file search prefers basename prefixes and keeps forgiving path matches', () => {
  expect(filterRows(['src/data.ts', 'src/Alpha.ts', 'src/another.ts'], 'a', 3)).toEqual(['src/Alpha.ts', 'src/another.ts', 'src/data.ts'])
  expect(filterRows(['src/api/user.ts'], 'usr', 5)).toEqual(['src/api/user.ts'])
})
