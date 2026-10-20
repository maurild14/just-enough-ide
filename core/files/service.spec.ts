import { afterEach, expect, test } from 'bun:test'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeHost, cleanup, makeRepo, makeTemp, writeFiles } from '../../test/fake-host.ts'
import { parseOptions } from '../options.ts'
import { allFiles, listDir, loadPreview, openFile } from './service.ts'
import type { Host } from '../host.ts'

afterEach(cleanup)

test('preview uses native lexical and realpath confinement without POSIX backslash or UNC case aliases', async () => {
  for (const [root, rel, real] of [
    ['/work/acme-app', 'link.txt', '/work/acme-app\\outside.txt'],
    ['//work/acme-app', 'link.txt', '//work/ACME-app/outside.txt'],
    ['/work/acme-app', 'src\\link.txt', '/work/acme-app/src/link.txt'],
  ]) {
    let reads = 0
    const host = { platform: 'linux', stat: async (path: string) => ({ kind: path === root ? 'dir' : 'file', size: 7, realPath: path === root ? root : real }), readHead: async () => { reads++; return new Uint8Array([79, 85, 84, 83, 73, 68, 69]) } } as unknown as Host
    expect(await loadPreview(host, root!, rel!)).toEqual({ kind: 'empty' })
    expect(reads).toBe(0)
  }
})

test('listDir returns entries and the ignored subset inside a repo', async () => {
  const r = await makeRepo({ '.gitignore': 'dist/\n*.log\n', 'src/a.ts': 'x', 'dist/o.js': 'x', 'run.log': 'x', 'keep.txt': 'k' })
  const { entries, ignored } = await listDir(r.host, r.dir, '')
  expect(entries.map((e) => e.name).sort()).toEqual(['.git', '.gitignore', 'dist', 'keep.txt', 'run.log', 'src'])
  expect(ignored.sort()).toEqual(['dist', 'run.log'])
  expect((await listDir(r.host, r.dir, 'dist')).ignored).toEqual(['dist/o.js'])
  expect((await listDir(r.host, r.dir, 'src')).ignored).toEqual([])
})

test('listDir outside a repo has no ignored paths', async () => {
  const host = new FakeHost()
  const dir = makeTemp('plain')
  writeFiles(dir, { 'a.txt': 'x' })
  const res = await listDir(host, dir, '')
  expect(res.entries.map((e) => e.name)).toEqual(['a.txt'])
  expect(res.ignored).toEqual([])
})

test('loadPreview: code, markdown, csv rows, empty, binary, image, too large', async () => {
  const host = new FakeHost()
  const dir = makeTemp('plain')
  writeFiles(dir, { 'a.ts': 'const a = 1\n', 'r.md': '# Hi\n', 'd.csv': 'a,b\n"x,1",2\n', 'e.txt': '' })
  writeFileSync(join(dir, 'b.bin'), Uint8Array.from([1, 0, 2]))
  writeFileSync(join(dir, 'p.png'), Uint8Array.from([137, 80, 78, 71]))
  writeFileSync(join(dir, 'huge.txt'), new Uint8Array(2 * 1024 * 1024 + 1).fill(97))
  expect(await loadPreview(host, dir, 'a.ts')).toEqual({ kind: 'code', text: 'const a = 1\n', language: 'typescript' })
  expect(await loadPreview(host, dir, 'r.md')).toMatchObject({ kind: 'markdown', text: '# Hi\n' })
  expect(await loadPreview(host, dir, 'd.csv')).toMatchObject({ kind: 'csv', text: 'a,b\n"x,1",2\n', rows: [['a', 'b'], ['x,1', '2']] })
  expect(await loadPreview(host, dir, 'e.txt')).toEqual({ kind: 'empty' })
  expect(await loadPreview(host, dir, 'b.bin')).toEqual({ kind: 'binary' })
  expect(await loadPreview(host, dir, 'p.png')).toEqual({ kind: 'image' })
  expect(await loadPreview(host, dir, 'huge.txt')).toEqual({ kind: 'too-large' })
})

test('allFiles in a repo lists tracked, untracked and not ignored files', async () => {
  const r = await makeRepo({ '.gitignore': 'dist/\n', 'src/a.ts': 'x', 'dist/o.js': 'x' })
  r.write('new.txt', 'n')
  expect((await allFiles(r.host, r.dir)).sort()).toEqual(['.gitignore', 'new.txt', 'src/a.ts'])
})

test('an unreadable in-root file is an error; missing, directory and rejected paths stay empty', async () => {
  const host = new FakeHost()
  const root = makeTemp()
  writeFiles(root, { 'locked.txt': 'abc', 'src/a.txt': 'x' })
  host.readHead = async () => null
  expect(await loadPreview(host, root, 'locked.txt')).toEqual({ kind: 'error' })
  expect(await loadPreview(host, root, 'missing.txt')).toEqual({ kind: 'empty' })
  expect(await loadPreview(host, root, 'src')).toEqual({ kind: 'empty' })
  expect(await loadPreview(host, root, '../locked.txt')).toEqual({ kind: 'empty' })
})

test('allFiles outside a repo walks breadth-first and skips .git and node_modules', async () => {
  const host = new FakeHost()
  const dir = makeTemp('plain')
  writeFiles(dir, { 'z.txt': '1', 'src/deep/a.ts': '1', 'src/b.ts': '1', 'node_modules/x/i.js': '1', '.git/config': '1' })
  const files = await allFiles(host, dir)
  expect([...files].sort()).toEqual(['src/b.ts', 'src/deep/a.ts', 'z.txt'])
  expect(files.indexOf('z.txt')).toBeLessThan(files.indexOf('src/deep/a.ts'))
})

test('openFile builds argv from the editor command and ignores the exit code', async () => {
  const calls: string[][] = []
  const host = { platform: 'linux', run: async (argv: readonly string[]) => (calls.push([...argv]), { exitCode: 1, stdout: '', stderr: '' }) } as unknown as FakeHost
  await openFile(host, parseOptions({ editorCommand: 'code -g {path}:{line}' }), '/p/a.ts', 7)
  await openFile(host, parseOptions({}), '/p/a.ts')
  expect(calls).toEqual([['code', '-g', '/p/a.ts:7'], ['xdg-open', '/p/a.ts']])
})

test('paths that leave the root are refused', async () => {
  const host = new FakeHost()
  const dir = makeTemp('plain')
  writeFiles(join(dir, '..'), { 'secret.txt': 's' })
  writeFiles(dir, { 'a.txt': 'x' })
  expect(await listDir(host, dir, '..')).toEqual({ entries: [], ignored: [] })
  expect(await listDir(host, dir, '../')).toEqual({ entries: [], ignored: [] })
  expect(await loadPreview(host, dir, '../secret.txt')).toEqual({ kind: 'empty' })
  expect(await loadPreview(host, dir, '..')).toEqual({ kind: 'empty' })
})

test('a symlink that points outside the root is not previewed', async () => {
  const host = new FakeHost()
  const dir = makeTemp('plain')
  writeFiles(join(dir, '..'), { 'secret.txt': 's' })
  try {
    symlinkSync(join(dir, '..', 'secret.txt'), join(dir, 'link.txt'))
  } catch {
    return // symlinks need privileges on some Windows setups
  }
  expect(await loadPreview(host, dir, 'link.txt')).toEqual({ kind: 'empty' })
})

test('allFiles drops tracked files deleted from the worktree', async () => {
  const r = await makeRepo({ 'a.txt': 'x', 'b.txt': 'y' })
  rmSync(join(r.dir, 'b.txt'))
  expect(await allFiles(r.host, r.dir)).toEqual(['a.txt'])
})

test('openFile refuses runnable types with no editor command, and passes a native path on Windows', async () => {
  const calls: string[][] = []
  const host = (platform: string) => ({ platform, run: async (argv: readonly string[]) => (calls.push([...argv]), { exitCode: 0, stdout: '', stderr: '' }) }) as unknown as FakeHost
  expect(await openFile(host('win32'), parseOptions({}), 'C:/work/acme-app/setup.BAT')).toBe('Set editorCommand to open this file type.')
  expect(calls).toEqual([])
  expect(await openFile(host('win32'), parseOptions({}), 'C:/work/acme-app/src/user.ts')).toBeNull()
  expect(await openFile(host('win32'), parseOptions({ editorCommand: 'code' }), 'C:/work/acme-app/setup.bat')).toBeNull()
  expect(calls).toEqual([['explorer.exe', 'C:\\work\\acme-app\\src\\user.ts'], ['code', 'C:\\work\\acme-app\\setup.bat']])
})
