import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { capDiff, diffWindow, omitSensitive, parseNumstat, parseUnifiedDiff, reviewText, toUnifiedText, untrackedDiffArgs, workingDiffArgs } from './diff.ts'

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
  expect(cut.file.hunks[0]!.header).toBe(f!.hunks[0]!.header)
  // second hunk starts at old 32 / new 33; first 2 lines are ctx 32, 33 -> counts 2/2
  expect(cut.file.hunks[1]!.header).toMatch(/^@@ -32,2 \+33,2 @@/)
  expect(cut.file.added).toBe(f!.added)
  expect(toUnifiedText(cut.file)).toContain(cut.file.hunks[1]!.header)
})

test('capDiff recomputes counts ignoring meta lines', () => {
  const [f] = fx('no-newline.diff')
  const r = capDiff(f!, 2)
  expect(r.file.hunks[0]!.header).toBe('@@ -1,1 +1,0 @@')
  expect(r.file.hunks[0]!.lines.map((l) => l.kind)).toEqual(['del', 'meta'])
})

test('lookalike content lines stay inside the hunk', () => {
  const t = [
    'diff --git a/p b/p',
    '--- a/p',
    '+++ b/p',
    '@@ -1,2 +1,2 @@',
    '-- old',
    '++ new',
    ' diff --git a/q b/q',
    'diff --git a/r b/r',
    '--- a/r',
    '+++ b/r',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    '',
  ].join('\n')
  const fs = parseUnifiedDiff(t)
  expect(fs.map((f) => f.path)).toEqual(['p', 'r'])
  expect(fs[0]!.hunks[0]!.lines).toEqual([
    { kind: 'del', text: '- old', oldNo: 1 },
    { kind: 'add', text: '+ new', newNo: 1 },
    { kind: 'ctx', text: 'diff --git a/q b/q', oldNo: 2, newNo: 2 },
  ])
  expect(fs[1]).toMatchObject({ added: 1, removed: 1 })
})

test('raw astral characters survive unquoting', () => {
  const [f] = parseUnifiedDiff('diff --git "a/\u{1F600}\\303\\261.ts" "b/\u{1F600}\\303\\261.ts"\n')
  expect(f!.path).toBe('\u{1F600}ñ.ts')
})

test('toUnifiedText uses /dev/null for new and deleted files', () => {
  expect(toUnifiedText(fx('new-file.diff')[0]!).startsWith('--- /dev/null\n+++ b/new thing.ts\n')).toBe(true)
  const del = parseUnifiedDiff('diff --git a/g b/g\n--- a/g\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n')[0]!
  expect(toUnifiedText(del).startsWith('--- a/g\n+++ /dev/null\n')).toBe(true)
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

const two = parseUnifiedDiff(
  ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', '@@ -10,2 +10,3 @@ fn', ' ten', '+new', ' eleven', ''].join('\n'),
)[0]!

test('diffWindow: whole file, hunk header rows and total', () => {
  const w = diffWindow(two, 0, 50)
  expect(w.total).toBe(9)
  expect(w.hunkStarts).toEqual([0, 5])
  expect(w.text).toBe(['@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', '@@ -10,2 +10,3 @@ fn', ' ten', '+new', ' eleven', ''].join('\n'))
})

test('diffWindow: a window starting mid-hunk gets a header of its own that parses', () => {
  const w = diffWindow(two, 3, 3)
  expect(w.text).toBe(['@@ -3,1 +2,2 @@', '+TWO', ' three', ''].join('\n'))
  const parsed = parseUnifiedDiff(`diff --git a/a.ts b/a.ts\n${w.text}`)[0]!
  expect(parsed.hunks[0]!.lines.map((l) => l.kind)).toEqual(['add', 'ctx'])
  const tail = diffWindow(two, 4, 4)
  expect(tail.text).toBe(['@@ -3,1 +3,1 @@', ' three', '@@ -10,1 +10,1 @@ fn', ' ten', ''].join('\n'))
})

test('diffWindow clamps top and rows', () => {
  expect(diffWindow(two, 99, 2).text).toBe(['@@ -11,1 +12,1 @@', ' eleven', ''].join('\n'))
  expect(diffWindow(two, -5, 1).text).toBe('@@ -1,0 +1,0 @@\n')
  expect(diffWindow({ ...two, hunks: [] }, 0, 5)).toEqual({ text: '', total: 0, hunkStarts: [] })
})

test('reviewText caps at max characters', () => {
  const t = reviewText('src/api/user.ts', 'x'.repeat(20_000), 8000)
  expect(t.length).toBeLessThanOrEqual(8000)
  expect(t.startsWith('Review this diff of src/api/user.ts:\n\n```diff\n')).toBe(true)
  expect(t.endsWith('\n```\n')).toBe(true)
  expect(t).toContain('[diff truncated]')
  const small = reviewText('a.ts', '@@ -1 +1 @@\n-a\n+b\n', 8000)
  expect(small).toBe('Review this diff of a.ts:\n\n```diff\n@@ -1 +1 @@\n-a\n+b\n```\n')
})

test('toUnifiedText marks deleted and new only from the file headers, never from the hunk counts', () => {
  const emptied = parseUnifiedDiff('diff --git a/g b/g\nindex 1..2 100644\n--- a/g\n+++ b/g\n@@ -1,2 +0,0 @@\n-one\n-two\n')[0]!
  expect(emptied.change).toBeUndefined()
  expect(toUnifiedText(emptied).startsWith('--- a/g\n+++ b/g\n')).toBe(true)
  const filled = parseUnifiedDiff('diff --git a/h b/h\nindex 1..2 100644\n--- a/h\n+++ b/h\n@@ -0,0 +1 @@\n+one\n')[0]!
  expect(toUnifiedText(filled).startsWith('--- a/h\n+++ b/h\n')).toBe(true)
  const gone = parseUnifiedDiff('diff --git a/g b/g\ndeleted file mode 100644\nindex 1..0\n--- a/g\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n')[0]!
  expect(gone.change).toBe('deleted')
  expect(toUnifiedText(gone).startsWith('--- a/g\n+++ /dev/null\n')).toBe(true)
  expect(parseUnifiedDiff(raw('new-file.diff'))[0]!.change).toBe('new')
})

test('omitSensitive drops sensitive files on either side of a rename and names them first', () => {
  const d = [
    'diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/.env b/config.txt', 'similarity index 90%', 'rename from .env', 'rename to config.txt', '@@ -1 +1 @@', '-MODE=one', '+MODE=two',
    'diff --git a/certs/site.pem b/certs/site.pem', '--- a/certs/site.pem', '+++ b/certs/site.pem', '@@ -1 +1 @@', '-AAA', '+BBB', '',
  ].join('\n')
  const out = omitSensitive(d)
  expect(out.startsWith('config.txt: sensitive file, contents omitted\ncerts/site.pem: sensitive file, contents omitted\ndiff --git a/a.ts b/a.ts\n')).toBe(true)
  for (const secret of ['MODE=', 'AAA', 'BBB']) expect(out).not.toContain(secret)
  expect(out).toContain('+y')
  expect(omitSensitive('diff --git a/a.ts b/a.ts\n+x\n')).toBe('diff --git a/a.ts b/a.ts\n+x\n')
})
