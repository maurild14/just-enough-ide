import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { STATUS_ARGS, folderStatus, parseStatus } from './status.ts'
import type { StatusEntry } from './status.ts'

const fx = (name: string) => parseStatus(readFileSync(new URL(`../../test/fixtures/git/${name}`, import.meta.url), 'utf8'))
const find = (entries: readonly StatusEntry[], path: string) => entries.find((e) => e.path === path)

test('STATUS_ARGS', () =>
  expect(STATUS_ARGS).toEqual(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']))

test('clean', () => {
  const s = fx('status-clean.txt')
  expect(s.branch).toMatchObject({ head: 'main', upstream: 'origin/main', ahead: 0, behind: 0 })
  expect(s.branch.oid).toMatch(/^[0-9a-f]{40}$/)
  expect(s.entries).toEqual([])
})

test('mixed', () => {
  const s = fx('status-mixed.txt')
  expect(s.entries).toHaveLength(6)
  expect(find(s.entries, 'my docs/new name.md')).toEqual({
    path: 'my docs/new name.md',
    origPath: 'my docs/old name.md',
    index: 'renamed',
    worktree: 'modified',
  })
  expect(find(s.entries, 'src/app.ts')).toEqual({ path: 'src/app.ts', index: null, worktree: 'modified' })
  expect(find(s.entries, 'src/new.ts')).toEqual({ path: 'src/new.ts', index: 'added', worktree: null })
  expect(find(s.entries, 'src/gone.ts')).toEqual({ path: 'src/gone.ts', index: 'deleted', worktree: null })
  expect(find(s.entries, 'src/keep.ts')).toEqual({ path: 'src/keep.ts', index: null, worktree: 'deleted' })
  expect(find(s.entries, 'scratch.txt')).toEqual({ path: 'scratch.txt', index: null, worktree: 'untracked' })
})

test('conflict', () => {
  const s = fx('status-conflict.txt')
  expect(s.branch.ahead).toBe(1)
  expect(s.entries).toEqual([{ path: 'src/app.ts', index: 'conflicted', worktree: 'conflicted' }])
})

test('detached', () => {
  const s = fx('status-detached.txt')
  expect(s.branch.head).toBeNull()
  expect(s.branch.upstream).toBeNull()
  expect(s.branch.oid).toMatch(/^[0-9a-f]{40}$/)
})

test('initial', () => {
  const s = fx('status-initial.txt')
  expect(s.branch.oid).toBeNull()
  expect(s.branch.head).toBe('main')
})

test('no upstream', () => {
  const s = fx('status-no-upstream.txt')
  expect(s.branch).toMatchObject({ head: 'feature', upstream: null, ahead: 0, behind: 0 })
  expect(s.entries).toHaveLength(5)
  expect(find(s.entries, 'my docs/new name.md')?.origPath).toBe('my docs/old name.md')
})

test('behind and ahead counts', () => {
  const s = parseStatus('# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -5\0')
  expect(s.branch).toEqual({ head: 'main', oid: 'abc', upstream: 'origin/main', ahead: 2, behind: 5 })
})

const H = 'N... 100644 100644 100644 aaa bbb'
const U = 'N... 100644 100644 100644 100644 aaa bbb ccc'

test('every unmerged code is conflicted', () => {
  for (const xy of ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']) {
    const s = parseStatus(`u ${xy} ${U} f.ts\0`)
    expect(s.entries).toEqual([{ path: 'f.ts', index: 'conflicted', worktree: 'conflicted' }])
  }
})

test('untracked and ignored records', () => {
  const s = parseStatus('? a b.txt\0! dist/out.js\0')
  expect(s.entries).toEqual([
    { path: 'a b.txt', index: null, worktree: 'untracked' },
    { path: 'dist/out.js', index: null, worktree: 'ignored' },
  ])
})

test('a path with a newline survives -z', () => {
  const s = parseStatus(`1 .M ${H} we\nird.txt\0? tab\tand\nnl\0`)
  expect(s.entries.map((e) => e.path)).toEqual(['we\nird.txt', 'tab\tand\nnl'])
})

test('type change and copy', () => {
  const s = parseStatus(`1 T. ${H} a\0` + `2 C. ${H} C90 b\0a\0`)
  expect(s.entries[0]).toEqual({ path: 'a', index: 'modified', worktree: null })
  expect(s.entries[1]).toEqual({ path: 'b', origPath: 'a', index: 'added', worktree: null })
})

test('folderStatus rolls up with priority', () => {
  const m = folderStatus([
    { path: 'src/api/user.ts', index: null, worktree: 'modified' },
    { path: 'src/api/new.ts', index: null, worktree: 'untracked' },
  ])
  expect(m.get('src')).toBe('modified')
  expect(m.get('src/api')).toBe('modified')
  expect(m.has('src/api/user.ts')).toBe(false)
})

test('folderStatus: conflicted wins, ignored skipped, root files add nothing', () => {
  const m = folderStatus([
    { path: 'a/b/c.ts', index: 'conflicted', worktree: 'conflicted' },
    { path: 'a/d.ts', index: 'added', worktree: null },
    { path: 'a/e.ts', index: null, worktree: 'untracked' },
    { path: 'x/y.ts', index: null, worktree: 'untracked' },
    { path: 'x/z.ts', index: 'added', worktree: null },
    { path: 'dist/o.js', index: null, worktree: 'ignored' },
    { path: 'top.ts', index: null, worktree: 'modified' },
    { path: 'g/h.ts', index: 'deleted', worktree: null },
  ])
  expect(m.get('a')).toBe('conflicted')
  expect(m.get('a/b')).toBe('conflicted')
  expect(m.get('x')).toBe('added')
  expect(m.get('g')).toBe('modified')
  expect(m.has('dist')).toBe(false)
  expect(m.size).toBe(4)
})
