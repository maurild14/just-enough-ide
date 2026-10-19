import { afterEach, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeHost, cleanup, makeRepo, makeTemp, writeFiles } from '../../test/fake-host.ts'
import { parseOptions } from '../options.ts'
import { allFiles, listDir, loadPreview, openFile } from './service.ts'

afterEach(cleanup)

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
  expect(await loadPreview(host, dir, 'd.csv')).toMatchObject({ kind: 'csv', rows: [['a', 'b'], ['x,1', '2']] })
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
