import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { capDiff, parseNumstat, parseUnifiedDiff, toUnifiedText, untrackedDiffArgs, workingDiffArgs } from './diff.ts'

const raw = (name: string) => readFileSync(new URL(`../../test/fixtures/diff/${name}`, import.meta.url), 'utf8')
const fx = (name: string) => parseUnifiedDiff(raw(name))
const count = (f: { hunks: { lines: unknown[] }[] }) => f.hunks.reduce((n, h) => n + h.lines.length, 0)

test('modify: two hunks, line numbers per kind', () => {
  const [f] = fx('modify.diff')
  expect(f!.path).toBe('src.txt')
  expect(f!.origPath).toBeUndefined()
  expect(f!.hunks).toHaveLength(2)
  const add = f!.hunks[0]!.lines.find((l) => l.kind === 'add')!
  expect(add).toEqual({ kind: 'add', text: 'added after eighteen', newNo: 19 })
  expect(f!.hunks[0]!.lines[0]).toEqual({ kind: 'ctx', text: 'line 16', oldNo: 16, newNo: 16 })
  const del = f!.hunks[1]!.lines.find((l) => l.kind === 'del')!
  expect(del).toEqual({ kind: 'del', text: 'line 35', oldNo: 35 })
  expect(f!.added).toBe(2)
  expect(f!.removed).toBe(1)
})

test('rename with spaces and an edit', () => {
  const [f] = fx('rename.diff')
  expect(f).toMatchObject({ path: 'my renamed file.ts', origPath: 'my file.ts', binary: false, added: 1, removed: 1 })
})

test('binary', () => {
  const [f] = fx('binary.diff')
  expect(f).toMatchObject({ path: 'logo.bin', binary: true, hunks: [] })
})

test('no newline at end of file is meta', () => {
  const [f] = fx('no-newline.diff')
  const metas = f!.hunks[0]!.lines.filter((l) => l.kind === 'meta')
  expect(metas).toHaveLength(2)
  expect(metas[0]!.text).toBe('\\ No newline at end of file')
  expect(f).toMatchObject({ added: 1, removed: 1 })
})

test('crlf has no trailing CR', () => {
  expect(raw('crlf.diff')).toContain('\r\n')
  const [f] = fx('crlf.diff')
  expect(f!.hunks[0]!.lines.map((l) => l.text)).toEqual(['a', 'b', 'B', 'c'])
})

test('new file and untracked (--no-index) use the b side', () => {
  expect(fx('new-file.diff')[0]).toMatchObject({ path: 'new thing.ts', added: 1 })
  expect(fx('untracked.diff')[0]).toMatchObject({ path: 'untracked.txt', added: 1 })
})

test('quoted unicode path is decoded', () => {
  expect(fx('quoted.diff')[0]!.path).toBe('ñ.ts')
})

test('synthetic: deleted file, mode change, multiple files', () => {
  const t = [
    'diff --git a/gone file.txt b/gone file.txt',
    'deleted file mode 100644',
    'index 1..0',
    '--- a/gone file.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/x.sh b/x.sh',
    'old mode 100644',
    'new mode 100755',
    'diff --git a/n.txt b/n.txt',
    'new file mode 100644',
    '--- NUL',
    '+++ b/n.txt',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
    '',
  ].join('\n')
  const fs = parseUnifiedDiff(t)
  expect(fs.map((f) => f.path)).toEqual(['gone file.txt', 'x.sh', 'n.txt'])
  expect(fs[0]).toMatchObject({ removed: 1, added: 0 })
  expect(fs[2]).toMatchObject({ added: 2 })
})

test('quoted rename pair', () => {
  const [f] = parseUnifiedDiff('diff --git "a/\\303\\261 a.ts" "b/\\303\\261 b.ts"\nrename from "\\303\\261 a.ts"\nrename to "\\303\\261 b.ts"\n')
  expect(f).toMatchObject({ path: 'ñ b.ts', origPath: 'ñ a.ts' })
})

test('parseNumstat', () => {
  const z = '3\t1\tsrc/a.ts\0-\t-\tlogo.bin\0' + '2\t0\t\0old name.ts\0new name.ts\0' + '1\t1\tlast.ts\0'
  expect(parseNumstat(z)).toEqual([
    { path: 'src/a.ts', added: 3, removed: 1 },
    { path: 'logo.bin', added: null, removed: null },
    { path: 'new name.ts', origPath: 'old name.ts', added: 2, removed: 0 },
    { path: 'last.ts', added: 1, removed: 1 },
  ])
  expect(parseNumstat('')).toEqual([])
})

test('capDiff', () => {
  const [f] = fx('modify.diff')
  const r = capDiff(f!, 10)
  expect(r.truncated).toBe(true)
  expect(count(r.file)).toBe(10)
  expect(capDiff(f!, count(f!))).toEqual({ file: f!, truncated: false })
  const first = f!.hunks[0]!.lines.length
  const whole = capDiff(f!, first)
  expect(whole.truncated).toBe(true)
  expect(whole.file.hunks).toHaveLength(1)
  expect(whole.file.hunks[0]).toBe(f!.hunks[0]!)
  const cut = capDiff(f!, first + 2)
  expect(cut.file.hunks[1]!.lines).toHaveLength(2)
})

test('toUnifiedText round-trips hunks', () => {
  const src = raw('modify.diff')
  const out = toUnifiedText(parseUnifiedDiff(src)[0]!)
  expect(out.slice(out.indexOf('@@'))).toBe(src.slice(src.indexOf('@@')))
  expect(out.startsWith('--- a/src.txt\n+++ b/src.txt\n')).toBe(true)
})

test('args', () => {
  expect(workingDiffArgs('a b.ts', false)).toEqual(['diff', '--no-color', '--no-ext-diff', '--', 'a b.ts'])
  expect(workingDiffArgs('a.ts', true)).toEqual(['diff', '--no-color', '--no-ext-diff', '--cached', '--', 'a.ts'])
  expect(untrackedDiffArgs('n.txt', 'win32')).toEqual(['diff', '--no-color', '--no-index', '--', 'NUL', 'n.txt'])
  expect(untrackedDiffArgs('n.txt', 'linux')).toEqual(['diff', '--no-color', '--no-index', '--', '/dev/null', 'n.txt'])
})
