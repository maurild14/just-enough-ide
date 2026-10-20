import { afterEach, expect, test } from 'bun:test'
import { symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, FakeHost, makeRepo, makeTemp, writeFiles } from '../../test/fake-host.ts'
import type { Host, RunOptions, Stream } from '../host.ts'
import { applyReplace, buildReplacePlan, quickOpenFiles, RG_MISSING, search } from './service.ts'
import type { Match, SearchQuery } from './rg.ts'

afterEach(cleanup)
const query: SearchQuery = { text: 'target', caseSensitive: true, regex: false, wholeWord: false, include: [], exclude: [] }
class NoRg extends FakeHost {
  override stream(argv: readonly string[], options?: RunOptions): Stream {
    return super.stream(argv[0] === 'rg' ? ['jei-missing-executable'] : argv, options)
  }
}
test('real rg streams Unicode+CRLF matches, regex errors and a bounded cap', async () => {
  const root = makeTemp()
  writeFiles(root, { 'a.ts': 'ñ 😀 target target\r\n', 'big.txt': 'target\n'.repeat(2100) })
  const matches: Match[] = []
  const result = await search(new FakeHost(), root, { ...query, include: ['a.ts'] }, (m) => matches.push(m)).done
  expect(result).toMatchObject({ engine: 'rg', error: null, truncated: false })
  expect(matches).toEqual([{ rel: 'a.ts', line: 1, text: 'ñ 😀 target target', ranges: [[5, 11], [12, 18]] }])
  expect((await search(new FakeHost(), root, { ...query, text: '(', regex: true }, () => {}).done).error).toContain('regex')
  const capped: Match[] = []
  expect((await search(new FakeHost(), root, query, (m) => capped.push(m)).done).truncated).toBe(true)
  expect(capped).toHaveLength(2000)
})
test('cancel kills a pending stream and drops matches after cancellation', async () => {
  const root = makeTemp()
  let killed = false
  let release!: () => void
  let started!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { started = resolve })
  const host = new FakeHost()
  host.stream = () => { started(); return { lines: (async function* () {
    await barrier
    yield JSON.stringify({ type: 'match', data: { path: { text: 'a.ts' }, lines: { text: 'target\n' }, line_number: 1, submatches: [{ start: 0, end: 6 }] } })
  })(), done: barrier.then(() => ({ exitCode: 0, stderr: '' })), cancel() { killed = true; release() } } }
  const seen: Match[] = []
  const task = search(host, root, query, (m) => seen.push(m))
  await ready
  task.cancel()
  await task.done
  expect(killed).toBe(true)
  expect(seen).toEqual([])
})
test('missing rg falls back to Git with exact first ranges and generated glob pathspecs', async () => {
  const repo = await makeRepo({ 'a b.txt': 'ñ target target\r\n', 'skip.txt': 'target\n', ' leading.txt': 'target\n' })
  const matches: Match[] = []
  const result = await search(new NoRg(), repo.dir, { ...query, include: ['*.txt'], exclude: ['skip*'] }, (m) => matches.push(m)).done
  expect(result).toMatchObject({ engine: 'git grep', error: null, truncated: false })
  expect(matches).toEqual([
    { rel: ' leading.txt', line: 1, text: 'target', ranges: [[0, 6]] },
    { rel: 'a b.txt', line: 1, text: 'ñ target target', ranges: [[2, 8]] },
  ])
  const plan = await buildReplacePlan(new NoRg(), repo.dir, { ...query, include: ['a b.txt'] }, 'done')
  expect(plan.files[0]?.after).toBe('ñ done target\r\n')
  expect((await search(new NoRg(), makeTemp(), query, () => {}).done).error).toBe(RG_MISSING)
  expect((await search(new NoRg(), repo.dir, { ...query, include: [':(exclude)*'] }, () => {}).done).error).toBeNull()
})
test('exit 127 without stdout also triggers fallback and no matches is a success', async () => {
  const repo = await makeRepo({ 'a.txt': 'nothing\n' })
  const host = new FakeHost()
  const realStream = host.stream.bind(host)
  host.stream = (argv, options) => argv[0] === 'rg' ? { lines: (async function* () {})(), done: Promise.resolve({ exitCode: 127, stderr: '' }), cancel() {} } : realStream(argv, options)
  expect(await search(host, repo.dir, query, () => {}).done).toMatchObject({ engine: 'git grep', error: null })
})
test('replace rechecks changed text, outside paths, symlinks, binary and complete UTF-8', async () => {
  const root = makeTemp()
  const outside = makeTemp()
  writeFiles(root, { 'a.txt': 'target\r\n', 'binary.txt': 'target\0', 'invalid.txt': 'target\n', ' late.txt': 'target\n' })
  writeFiles(outside, { 'a.txt': 'target\n' })
  writeFileSync(join(root, 'invalid.txt'), Buffer.concat([Buffer.from('target\n' + 'x'.repeat(9000)), Buffer.from([0xff])]))
  symlinkSync(outside, join(root, 'link'), 'junction')
  const host = new FakeHost()
  const plan = await buildReplacePlan(host, root, { ...query, include: ['a.txt', ' late.txt'] }, 'done')
  expect(plan.files).toHaveLength(2)
  writeFiles(root, { 'a.txt': 'changed\n' })
  const applied = await applyReplace(host, root, [...plan.files,
    { rel: '../x', before: '', after: 'oops', count: 1 }, { rel: 'link/a.txt', before: 'target\n', after: 'oops', count: 1 },
    { rel: 'binary.txt', before: 'target\0', after: 'oops', count: 1 }, { rel: 'invalid.txt', before: 'target\n', after: 'oops', count: 1 }])
  expect(applied.written).toEqual([' late.txt'])
  expect(applied.skipped).toEqual([{ rel: 'a.txt', reason: 'changed' }, { rel: '../x', reason: 'outside-root' },
    { rel: 'link/a.txt', reason: 'outside-root' }, { rel: 'binary.txt', reason: 'binary' }, { rel: 'invalid.txt', reason: 'not-utf8' }])
  expect(await host.readText(join(root, ' late.txt'))).toBe('done\n')
  expect(await host.readText(join(outside, 'a.txt'))).toBe('target\n')
})
test('quick open honors ignore rules in repos and rg files mode outside repos', async () => {
  const repo = await makeRepo({ '.gitignore': 'ignored.txt\n', 'a.txt': 'a' })
  writeFiles(repo.dir, { 'ignored.txt': 'skip', 'new.txt': 'new' })
  expect((await quickOpenFiles(repo.host, repo.dir)).sort()).toEqual(['.gitignore', 'a.txt', 'new.txt'])
  const root = makeTemp()
  writeFiles(root, { 'a.txt': '', 'b.txt': '' })
  expect((await quickOpenFiles(new FakeHost(), root)).sort()).toEqual(['a.txt', 'b.txt'])
})

test('buffer truncation emits no unverified fallback match and caps the file list', async () => {
  const host = new NoRg()
  const root = makeTemp()
  host.run = async (_argv) => ({ exitCode: 0, stderr: '', stdout: _argv.includes('ls-files') ? Array.from({ length: 50_010 }, (_, i) => `${i}.ts`).join('\0') + '\0' : root })
  const baseStream = host.stream.bind(host)
  host.stream = (argv, options) => argv[0] === 'rg' ? baseStream(argv, options) : {
    lines: (async function* () { yield 'x'.repeat(8 * 1024 * 1024 + 1) })(),
    done: Promise.resolve({ exitCode: 0, stderr: '' }), cancel() {},
  }
  const seen: Match[] = []
  expect(await search(host, root, query, (m) => seen.push(m)).done).toMatchObject({ engine: 'git grep', truncated: true, error: null })
  expect(seen).toEqual([])
  expect(await quickOpenFiles(host, root)).toHaveLength(50_000)
})

test('replacement reports large and unreadable files without writing', async () => {
  const root = makeTemp()
  writeFiles(root, { 'large.txt': 'target', 'unreadable.txt': 'target' })
  const host = new FakeHost()
  const realStat = host.stat.bind(host)
  host.stat = async (path) => {
    const stat = await realStat(path)
    return path.endsWith('large.txt') && stat ? { ...stat, size: 4 * 1024 * 1024 + 1 } : stat
  }
  host.readHead = async () => null
  const plan = ['large.txt', 'unreadable.txt'].map((rel) => ({ rel, before: 'target', after: 'done', count: 1 }))
  expect(await applyReplace(host, root, plan)).toEqual({ written: [], skipped: [{ rel: 'large.txt', reason: 'too-large' }, { rel: 'unreadable.txt', reason: 'unreadable' }] })
  const ordinary = new FakeHost()
  expect(await applyReplace(ordinary, root, [{ rel: 'unreadable.txt', before: 'target', after: '😀'.repeat(1_048_577), count: 1 }])).toEqual({ written: [], skipped: [{ rel: 'unreadable.txt', reason: 'too-large' }] })
  expect(await ordinary.readText(join(root, 'unreadable.txt'))).toBe('target')
})

test('fallback framing preserves literal newline names and exact first match length', async () => {
  const root = makeTemp()
  const host: Host = new NoRg()
  const realStat = host.stat.bind(host)
  host.stat = async (path) => path.endsWith('a\nb.txt') ? { kind: 'file', size: 10, realPath: join(root, 'a\nb.txt') } : realStat(path)
  host.run = async () => ({ exitCode: 0, stdout: root, stderr: '' })
  const baseStream = host.stream.bind(host)
  host.stream = (argv, options) => argv[0] === 'rg' ? baseStream(argv, options) : {
    lines: (async function* () { yield 'a'; yield `b.txt\0${'1'}\0${'4'}\0${argv.includes('--only-matching') ? 'target' : 'ñ target target'}` })(),
    done: Promise.resolve({ exitCode: 0, stderr: '' }), cancel() {},
  }
  const seen: Match[] = []
  await search(host, root, query, (m) => seen.push(m)).done
  expect(seen).toEqual([{ rel: 'a\nb.txt', line: 1, text: 'ñ target target', ranges: [[2, 8]] }])
})
