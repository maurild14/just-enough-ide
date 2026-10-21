import { afterEach, expect, test } from 'bun:test'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
test('real rg Search remains case-insensitive while replacement plans and applies only exact text', async () => {
  const root = makeTemp()
  writeFiles(root, { 'mixed.txt': 'user User USER\nUser\nuser\n', 'omitted.txt': 'User USER\n' })
  const host = new FakeHost(), q = { ...query, text: 'user', caseSensitive: false }, matches: Match[] = []
  expect((await search(host, root, q, m => matches.push(m)).done).error).toBeNull()
  expect(matches.reduce((n, m) => n + m.ranges.length, 0)).toBe(7)
  const plan = await buildReplacePlan(host, root, q, 'account')
  expect(plan.files).toEqual([{ rel: 'mixed.txt', before: 'user User USER\nUser\nuser\n', after: 'account User USER\nUser\naccount\n', count: 2 }])
  expect(plan.skipped.sort((a, b) => a.rel.localeCompare(b.rel))).toEqual([{ rel: 'mixed.txt', reason: 'case-differs' }, { rel: 'omitted.txt', reason: 'case-differs' }])
  expect(await applyReplace(host, root, plan.files)).toEqual({ written: ['mixed.txt'], skipped: [] })
  expect(await host.readText(join(root, 'mixed.txt'))).toBe('account User USER\nUser\naccount\n')
  expect(await host.readText(join(root, 'omitted.txt'))).toBe('User USER\n')
})
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
  host.run = async (_argv) => ({ exitCode: 0, stderr: '', stdout: _argv.includes('-d') ? '' : _argv.includes('ls-files') ? Array.from({ length: 50_010 }, (_, i) => `${i}.ts`).join('\0') + '\0' : root })
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

test('POSIX literal names never read or replace an unselected slash counterpart', async () => {
  const root = '/work/acme-app'
  const files = new Map([['a\\b.txt', 'target\n'], ['a/b.txt', 'target\n'], ['a:b.txt', 'target\n']])
  const reads: string[] = []
  const writes: string[] = []
  let selected = 'a\\b.txt'
  const host: Host = {
    platform: 'linux',
    async run(argv) { return { exitCode: 0, stderr: '', stdout: argv.includes('-d') ? '' : [...files.keys()].join('\0') + '\0' } },
    stream() { return { lines: (async function* () { yield JSON.stringify({ type: 'match', data: { path: { text: `./${selected}` }, lines: { text: 'target\n' }, line_number: 1, submatches: [{ start: 0, end: 6 }] } }) })(), done: Promise.resolve({ exitCode: 0, stderr: '' }), cancel() {} } },
    async list() { return [] },
    async stat(path) {
      if (path === root) return { kind: 'dir', size: 0, realPath: root }
      const text = files.get(path.slice(root.length + 1))
      return text === undefined ? null : { kind: 'file', size: text.length, realPath: path }
    },
    async readHead(path) { reads.push(path); const text = files.get(path.slice(root.length + 1)); return text === undefined ? null : new Uint8Array(Buffer.from(text)) },
    async readText(path) { reads.push(path); return files.get(path.slice(root.length + 1)) ?? null },
    async writeText(path, text) { writes.push(path); files.set(path.slice(root.length + 1), text) },
    async complete() { return '' },
  }
  const matches: Match[] = []
  await search(host, root, query, (match) => matches.push(match)).done
  expect(matches).toEqual([])
  expect(await buildReplacePlan(host, root, query, 'done')).toEqual({ files: [], skipped: [] })
  expect(await applyReplace(host, root, [{ rel: 'a\\b.txt', before: 'target\n', after: 'done\n', count: 1 }])).toEqual({ written: [], skipped: [{ rel: 'a\\b.txt', reason: 'unsupported-path' }] })
  expect(reads).toEqual([])
  expect(writes).toEqual([])
  expect(files.get('a/b.txt')).toBe('target\n')
  selected = 'a:b.txt'
  await search(host, root, query, (match) => matches.push(match)).done
  expect(matches).toEqual([{ rel: 'a:b.txt', line: 1, text: 'target', ranges: [[0, 6]] }])
  const plan = await buildReplacePlan(host, root, query, 'done')
  expect(plan.files[0]?.rel).toBe('a:b.txt')
  expect(await applyReplace(host, root, plan.files)).toEqual({ written: ['a:b.txt'], skipped: [] })
  expect(writes).toEqual(['/work/acme-app/a:b.txt'])
  expect(reads.every((path) => path === '/work/acme-app/a:b.txt')).toBe(true)
  expect(files.get('a/b.txt')).toBe('target\n')
  expect(await quickOpenFiles(host, root)).toEqual(['a/b.txt', 'a:b.txt'])
})

test('real Git fallback retains first zero-width matches for anchors and the empty regex', async () => {
  const repo = await makeRepo({ 'a.txt': 'ñ target\r\n\nlast\n' })
  for (const text of ['^', '', '^|target']) {
    const q = { ...query, regex: true, text }
    const matches: Match[] = []
    expect(await search(new NoRg(), repo.dir, q, (match) => matches.push(match)).done).toMatchObject({ engine: 'git grep', error: null, truncated: false })
    expect(matches).toEqual([
      { rel: 'a.txt', line: 1, text: 'ñ target', ranges: [[0, 0]] },
      { rel: 'a.txt', line: 2, text: '', ranges: [[0, 0]] },
      { rel: 'a.txt', line: 3, text: 'last', ranges: [[0, 0]] },
    ])
    expect((await buildReplacePlan(new NoRg(), repo.dir, q, '>')).files[0]?.after).toBe('>ñ target\r\n>\n>last\n')
  }
})

test('fallback never infers zero-width matches from truncated or failed companion output', async () => {
  const root = makeTemp()
  writeFiles(root, { 'a.txt': 'target\n' })
  for (const mode of ['full-truncated', 'only-truncated', 'only-error']) {
    const host = new NoRg()
    host.run = async () => ({ exitCode: 0, stderr: '', stdout: root })
    const baseStream = host.stream.bind(host)
    host.stream = (argv, options) => {
      if (argv[0] === 'rg') return baseStream(argv, options)
      const only = argv.includes('--only-matching')
      return {
        lines: (async function* () {
          if (!only) yield 'a.txt\0' + '1\0' + '1\0target'
          if ((!only && mode === 'full-truncated') || (only && mode === 'only-truncated')) yield 'x'.repeat(8 * 1024 * 1024 + 1)
        })(),
        done: Promise.resolve({ exitCode: only && mode === 'only-error' ? 2 : 0, stderr: only && mode === 'only-error' ? 'grep failed' : '' }), cancel() {},
      }
    }
    const matches: Match[] = []
    const result = await search(host, root, { ...query, text: '^', regex: true }, (match) => matches.push(match)).done
    expect(matches).toEqual([])
    expect(result).toMatchObject(mode === 'only-error' ? { error: 'grep failed', truncated: false } : { error: null, truncated: true })
  }
})

test('fallback reports an explicit error when its first match cannot be verified', async () => {
  const repo = await makeRepo({ 'a.txt': 'ñ target\n123\n' })
  const result = await search(new NoRg(), repo.dir, { ...query, text: '[[:alpha:]]*', regex: true }, () => {}).done
  expect(result.error).toContain('Git grep could not verify the first match')
  const host = new NoRg()
  const baseStream = host.stream.bind(host)
  host.stream = (argv, options) => argv[0] === 'rg' ? baseStream(argv, options) : {
    lines: (async function* () { yield 'a.txt\0' + '1\0' + '4\0' + (argv.includes('--only-matching') ? 'other' : 'ñ target') })(),
    done: Promise.resolve({ exitCode: 0, stderr: '' }), cancel() {},
  }
  const mismatch = await search(host, repo.dir, query, () => {}).done
  expect(mismatch.error).toContain('Git grep could not verify the first match')
})

test('real Git fallback basename globs include nested files and exclude nested basenames', async () => {
  const repo = await makeRepo({ 'a.txt': 'target\n', 'nested/a.txt': 'target\n', 'nested/skip.txt': 'target\n' })
  const seen: Match[] = []
  const result = await search(new NoRg(), repo.dir, { ...query, include: ['*.txt'], exclude: ['skip*'] }, match => seen.push(match)).done
  expect(result.error).toBeNull()
  expect(seen.map(match => match.rel).sort()).toEqual(['a.txt', 'nested/a.txt'])
})

test('real Git grep.fullName config cannot rebase fallback paths outside a subdirectory root', async () => {
  const repo = await makeRepo({ 'src/a.txt': 'target\n' })
  const host = new NoRg(), stream = host.stream.bind(host)
  host.stream = (argv, options) => {
    const at = argv.indexOf('grep')
    return stream(at < 0 ? argv : [...argv.slice(0, at), '-c', 'grep.fullName=true', ...argv.slice(at)], options)
  }
  const seen: Match[] = []
  expect((await search(host, join(repo.dir, 'src'), query, match => seen.push(match)).done).error).toBeNull()
  expect(seen.map(match => match.rel)).toEqual(['a.txt'])
})

test('real Git whole-word fallback never authorizes replacing within a Unicode word', async () => {
  const repo = await makeRepo({ 'a.txt': 'señal\nal\n' })
  const q = { ...query, text: 'al', wholeWord: true }
  const seen: Match[] = []
  expect((await search(new NoRg(), repo.dir, q, match => seen.push(match)).done).error).toBeNull()
  expect(seen.map(match => match.line)).toEqual([1, 2])
  expect(await buildReplacePlan(new NoRg(), repo.dir, q, 'el')).toEqual({ files: [], skipped: [{ rel: 'a.txt', reason: 'regex-differs' }] })
  const rg: Match[] = []
  await search(repo.host, repo.dir, q, match => rg.push(match)).done
  expect(rg.map(match => match.line)).toEqual([2])
})

test('replacement refuses truncated results and empty literal queries before any source read', async () => {
  const root = makeTemp()
  writeFiles(root, { 'a.txt': 'target\n'.repeat(2001) })
  const host = new FakeHost()
  let reads = 0
  host.readHead = async () => { reads++; return null }
  await expect(buildReplacePlan(host, root, query, 'done')).rejects.toThrow('Results truncated. Narrow the search before replacing.')
  await expect(buildReplacePlan(host, root, { ...query, text: '' }, 'done')).rejects.toThrow('Enter a search query before replacing.')
  expect(reads).toBe(0)
})

test('multiline search patterns refuse before starting either engine', async () => {
  const host = new FakeHost()
  for (const text of ['one\ntwo', 'one\rtwo']) {
    const result = await search(host, makeTemp(), { ...query, text }, () => {}).done
    expect(result.error).toBe('Search patterns must stay on one line.')
  }
  expect(host.calls).toEqual([])
})

test('search cancels before retaining results beyond the aggregate string or range budget', async () => {
  for (const dense of [false, true]) {
    const root = makeTemp(), host = new FakeHost()
    const stat = host.stat.bind(host)
    host.stat = async path => path === root ? stat(path) : { kind: 'file', size: 1, realPath: path }
    let cancelled = 0
    const text = dense ? 'target' : 'target' + 'x'.repeat(1024 * 1024)
    const submatches = dense ? Array.from({ length: 150_000 }, () => ({ start: 0, end: 6 })) : [{ start: 0, end: 6 }]
    host.stream = () => ({ lines: (async function* () {
      for (let i = 0; i < 12; i++) yield JSON.stringify({ type: 'match', data: { path: { text: 'a.txt' }, lines: { text }, line_number: i + 1, submatches } })
    })(), done: Promise.resolve({ exitCode: 0, stderr: '' }), cancel() { cancelled++ } })
    let count = 0
    expect(await search(host, root, query, () => { count++ }).done).toMatchObject({ error: null, truncated: true })
    expect(count).toBe(dense ? 3 : 7)
    expect(cancelled).toBeGreaterThan(0)
  }
})

test('replacement snapshot budget refuses the whole review while building it incrementally', async () => {
  const root = makeTemp(), host = new FakeHost()
  const text = 'target\n' + 'x'.repeat(2 * 1024 * 1024)
  const bytes = new Uint8Array(Buffer.from(text))
  const stat = host.stat.bind(host)
  host.stat = async path => path === root ? stat(path) : { kind: 'file', size: bytes.length, realPath: path }
  let reads = 0
  host.readHead = async () => { reads++; return bytes }
  host.stream = () => ({ lines: (async function* () {
    for (let i = 0; i < 10; i++) yield JSON.stringify({ type: 'match', data: { path: { text: `${i}.txt` }, lines: { text: 'target' }, line_number: 1, submatches: [{ start: 0, end: 6 }] } })
  })(), done: Promise.resolve({ exitCode: 0, stderr: '' }), cancel() {} })
  await expect(buildReplacePlan(host, root, query, 'done')).rejects.toThrow('Replacement review exceeds 32 MiB. Narrow the search before replacing.')
  expect(reads).toBeLessThan(10)
})

test('replacement apply compares complete bytes without depending on host text decoding', async () => {
  const root = makeTemp(), host = new FakeHost()
  writeFiles(root, { 'a.txt': '\ufefftarget\r\n' })
  host.readText = async () => { throw new Error('Text-mode decoding must not control replacement safety.') }
  expect(await applyReplace(host, root, [{ rel: 'a.txt', before: '\ufefftarget\r\n', after: '\ufeffdone\r\n', count: 1 }])).toEqual({ written: ['a.txt'], skipped: [] })
})

test('quick open excludes deleted tracked files and explains missing rg outside repositories', async () => {
  const repo = await makeRepo({ 'deleted.txt': '', 'a.txt': '' })
  rmSync(join(repo.dir, 'deleted.txt'))
  expect(await quickOpenFiles(repo.host, repo.dir)).toEqual(['a.txt'])
  for (const rejected of [false, true]) {
    const host = new FakeHost()
    host.run = async argv => {
      if (argv[0] !== 'rg') return { exitCode: 128, stdout: '', stderr: '' }
      if (rejected) throw new Error('spawn rg ENOENT')
      return { exitCode: 127, stdout: '', stderr: '' }
    }
    await expect(quickOpenFiles(host, makeTemp())).rejects.toThrow(RG_MISSING)
  }
})
