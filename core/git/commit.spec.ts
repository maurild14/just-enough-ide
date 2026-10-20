import { afterEach, expect, test } from 'bun:test'
import { cleanup, makeRepo } from '../../test/fake-host.ts'
import { commitDiffArgs, commitFilesArgs, parseCommitFiles } from './commit.ts'
import { commitDiff, commitFiles } from './service.ts'

afterEach(cleanup)

test('NUL file records pair rename counts and binary nulls without trimming paths', () => {
  expect(parseCommitFiles('R100\0old name\0new name\0M\0binary\0A\0 leading \0', '0\t0\t\0old name\0new name\0-\t-\tbinary\0' + '1\t0\t leading \0')).toEqual([
    { path: 'new name', from: 'old name', status: 'R', added: 0, removed: 0 },
    { path: 'binary', status: 'M', added: null, removed: null },
    { path: ' leading ', status: 'A', added: 1, removed: 0 },
  ])
})

test('argv uses first-parent merge diffs and safe root show options', () => {
  const hash = 'a'.repeat(40)
  expect(commitFilesArgs(hash)[0]).toContain('--diff-merges=first-parent')
  expect(commitDiffArgs(hash, '-name', false)).toEqual(['diff', '--no-color', '--no-ext-diff', '-M', `${hash}^`, hash, '--', '-name'])
  expect(commitDiffArgs(hash, 'a', true)).toEqual(['show', '--no-color', '--no-ext-diff', '-M', '--format=', hash, '--', 'a'])
})

test('real root files, first-parent merge files and renamed file diff', async () => {
  const r = await makeRepo({ 'old.txt': 'one\ntwo\nthree\nfour\n', 'base.txt': 'base\n' })
  const root = await r.git('rev-parse', 'HEAD')
  const files = await commitFiles(r.host, r.dir, root)
  expect(files).toHaveLength(2)
  expect(files.every((f) => f.status === 'A')).toBe(true)
  expect((await commitDiff(r.host, r.dir, root, 'old.txt')).file?.added).toBe(4)
  await r.git('checkout', '-b', 'other')
  r.write('other.txt', 'other\n')
  await r.git('add', '-A'); await r.git('commit', '-m', 'feat: other')
  await r.git('checkout', 'main')
  await r.git('mv', 'old.txt', 'new.txt')
  r.write('new.txt', 'one\ntwo\nthree\nfour\nfive\n')
  await r.git('add', '-A'); await r.git('commit', '-m', 'feat: rename')
  const renamed = await r.git('rev-parse', 'HEAD')
  expect(await commitFiles(r.host, r.dir, renamed)).toEqual([{ path: 'new.txt', from: 'old.txt', status: 'R', added: 1, removed: 0 }])
  const diff = await commitDiff(r.host, r.dir, renamed, 'new.txt')
  expect(diff.file).toMatchObject({ path: 'new.txt', origPath: 'old.txt', added: 1, removed: 0 })
  await r.git('merge', '--no-ff', 'other', '-m', 'feat: merge')
  const merge = await r.git('rev-parse', 'HEAD')
  expect(await commitFiles(r.host, r.dir, merge)).toEqual([{ path: 'other.txt', status: 'A', added: 1, removed: 0 }])
})

test('read services reject unsafe revisions before invoking git', async () => {
  const r = await makeRepo()
  const before = r.host.calls.length
  for (const hash of ['HEAD', '-x', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(64)]) {
    await expect(commitFiles(r.host, r.dir, hash)).rejects.toThrow('Invalid commit hash.')
    await expect(commitDiff(r.host, r.dir, hash, 'a')).rejects.toThrow('Invalid commit hash.')
  }
  expect(r.host.calls).toHaveLength(before)
})
