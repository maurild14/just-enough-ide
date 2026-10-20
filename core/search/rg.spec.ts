import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { byteToIndex, decodeUtf8, gitGrepArgs, parseGitGrep, parseGlobs, parseRgLine, searchArgs, type SearchQuery } from './rg.ts'

export const query: SearchQuery = { text: 'target', caseSensitive: true, regex: false, wholeWord: false, include: [], exclude: [] }

test('argv protects option-like patterns and config, flags and glob values', () => {
  for (const text of ['-rf', '--pre=x', '(', '']) {
    const argv = searchArgs({ ...query, text, include: ['src/**'], exclude: ['**/*.test.ts'] })
    expect(argv.slice(0, 3)).toEqual(['rg', '--json', '--no-config'])
    expect(argv.slice(-2)).toEqual(['-e', text])
    expect(argv).toContain('-F')
    expect(argv).toContain('!**/*.test.ts')
  }
  expect(searchArgs({ ...query, regex: true, caseSensitive: false, wholeWord: true })).toContain('-i')
  expect(searchArgs({ ...query, regex: true })).not.toContain('-F')
  expect(searchArgs({ ...query, wholeWord: true })).toContain('-w')
  expect(parseGlobs('src/** !**/*.test.ts !**')).toEqual({ include: ['src/**'], exclude: ['**/*.test.ts', '**'] })
  expect(gitGrepArgs({ ...query, text: '-rf', include: [':(exclude)*'], exclude: ['**/*.test.ts'] }).slice(-5)).toEqual(['-e', '-rf', '--', ':(glob)**/:(exclude)*', ':(exclude,glob)**/*.test.ts'])
})

test('UTF-8 offsets become UTF-16 indexes for accents, emoji and CJK', () => {
  expect(byteToIndex('ñandú x', 8)).toBe(6)
  expect(byteToIndex('😀 x', 5)).toBe(3)
  expect(byteToIndex('漢字 x', 7)).toBe(3)
})

test('real acme-app rg capture keeps Unicode ranges and strips CRLF', () => {
  const lines = readFileSync(new URL('../../test/fixtures/search/acme-app.jsonl', import.meta.url), 'utf8').trim().split('\n')
  const parsed = lines.map((line) => parseRgLine(line, '/work/acme-app', 'win32')).filter(Boolean)
  expect(parsed).toEqual([
    { rel: 'src/unicode.ts', line: 1, text: 'ñandú 😀 漢字 target', ranges: [[12, 18]] },
    { rel: 'src/crlf.ts', line: 1, text: 'const target = 1', ranges: [[6, 12]] },
  ])
  expect(parseRgLine('not json', '/work/acme-app')).toBeNull()
  expect(parseRgLine('{"type":"error","data":{"message":"bad regex\\nmore"}}', '/work/acme-app')).toEqual({ error: 'bad regex' })
  expect(parseRgLine('{"type":"match","data":{"path":{"text":"../secret"},"lines":{"text":"x\\n"},"line_number":1,"submatches":[]}}', '/work/acme-app')).toBeNull()
  expect(parseRgLine('{"type":"match","data":{"path":{"text":" leading.ts"},"lines":{"bytes":"/3gK"},"line_number":1,"submatches":[]}}', '/work/acme-app')).toEqual({ rel: ' leading.ts', line: 1, text: '[binary line]', ranges: [] })
  expect(parseRgLine('{"type":"match","data":{}}', '/work/acme-app')).toBeNull()
})

test('git grep uses NUL fields so colons, spaces and newlines remain literal', () => {
  expect(parseGitGrep('a: b\nc.ts\0' + '2\0' + '4\0ñ target\r\n')).toEqual([
    { rel: 'a: b\nc.ts', line: 2, text: 'ñ target', ranges: [[2, 2]] },
  ])
})

test('strict UTF-8 accepts valid scalars and rejects overlong, surrogate and truncated bytes', () => {
  expect(decodeUtf8(new Uint8Array([0xc3, 0xb1, 0xf0, 0x9f, 0x98, 0x80, 0xe6, 0xbc, 0xa2]))).toBe('ñ😀漢')
  for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f], [0x80], [0xc2, 0x20]]) {
    expect(decodeUtf8(new Uint8Array(bytes))).toBeNull()
  }
})

test('rg literal paths distinguish POSIX colon names from Windows drive paths', () => {
  const event = (path: string) => JSON.stringify({ type: 'match', data: { path: { text: path }, lines: { text: 'target\n' }, line_number: 1, submatches: [{ start: 0, end: 6 }] } })
  expect(parseRgLine(event('./a:b.txt'), '/work/acme-app', 'linux')).toEqual({ rel: 'a:b.txt', line: 1, text: 'target', ranges: [[0, 6]] })
  expect(parseRgLine(event('./a\\b.txt'), '/work/acme-app', 'linux')).toBeNull()
  expect(parseRgLine(event('.\\src\\a.txt'), 'C:/work/acme-app', 'win32')).toEqual({ rel: 'src/a.txt', line: 1, text: 'target', ranges: [[0, 6]] })
})

test('dense submatches parse within a generous fixed budget and retain Unicode ranges', () => {
  const count = 60_000
  const text = 'ñ😀漢 ' + 'x'.repeat(count) + '\r\n'
  const json = JSON.stringify({ type: 'match', data: { path: { text: 'dense.ts' }, lines: { text }, line_number: 1,
    submatches: Array.from({ length: count }, (_, i) => ({ match: { text: 'x' }, start: 10 + i, end: 11 + i })) } })
  expect(json.length).toBeLessThan(8 * 1024 * 1024)
  const start = performance.now()
  const parsed = parseRgLine(json, '/work/acme-app', 'linux')
  const elapsed = performance.now() - start
  // Construction and assertions stay outside this generous absolute parsing budget.
  expect(elapsed).toBeLessThan(1500)
  if (!parsed || 'error' in parsed) throw new Error('Expected a parsed match.')
  expect(parsed.text).toBe('ñ😀漢 ' + 'x'.repeat(count))
  expect(parsed.ranges).toHaveLength(count)
  expect(parsed.ranges[0]).toEqual([5, 6])
  expect(parsed.ranges[30_000]).toEqual([30_005, 30_006])
  expect(parsed.ranges.at(-1)).toEqual([60_004, 60_005])
})

test('batch offsets keep unordered, interior-byte, zero-width and clamped Unicode boundaries', () => {
  const json = JSON.stringify({ type: 'match', data: { path: { text: 'unicode.ts' }, lines: { text: 'ñ😀漢 target\r\n' }, line_number: 1,
    submatches: [{ start: 10, end: 16 }, { start: 2, end: 6 }, { start: 3, end: 5 }, { start: 99, end: 99 }, { start: 0, end: 0 }] } })
  expect(parseRgLine(json, '/work/acme-app', 'linux')).toEqual({ rel: 'unicode.ts', line: 1, text: 'ñ😀漢 target', ranges: [[5, 11], [1, 3], [1, 1], [11, 11], [0, 0]] })
})
