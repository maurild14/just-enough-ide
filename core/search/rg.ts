import type { Platform } from '../host.ts'
import { nativeRel, platformOf } from '../shared/paths.ts'

export type SearchQuery = { text: string; caseSensitive: boolean; regex: boolean; wholeWord: boolean; include: string[]; exclude: string[] }
export type Match = { rel: string; line: number; text: string; ranges: [number, number][] }

export function searchArgs(q: SearchQuery): string[] {
  return ['rg', '--json', '--no-config', '--max-columns', '1000', '--max-filesize', '2M', q.caseSensitive ? '-s' : '-i',
    ...(!q.regex ? ['-F'] : []), ...(q.wholeWord ? ['-w'] : []),
    ...q.include.flatMap((glob) => ['-g', glob]), ...q.exclude.flatMap((glob) => ['-g', `!${glob}`]), '.', '-e', q.text]
}

export function byteToIndex(text: string, byte: number): number {
  let bytes = 0
  let index = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const size = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
    if (bytes + size > byte) break
    bytes += size
    index += ch.length
  }
  return index
}

/** Strict UTF-8 without host codecs: replacement must reject lossy decoding. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  const out: string[] = []
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]!
    if (first < 0x80) { out.push(String.fromCharCode(first)); continue }
    const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : -1
    if (count < 0 || i + count > bytes.length) return null
    let cp = first & (0x7f >> count)
    for (let n = 0; n < count; n++) {
      const next = bytes[i++]!
      if (next < 0x80 || next > 0xbf) return null
      cp = (cp << 6) | (next & 0x3f)
    }
    if (cp < [0, 0x80, 0x800, 0x10000][count]! || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null
    out.push(String.fromCodePoint(cp))
  }
  return out.join('')
}

function base64Bytes(text: string): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) return null
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of text.replace(/=+$/, '')) {
    value = (value << 6) | alphabet.indexOf(ch)
    bits += 6
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255) }
  }
  return new Uint8Array(out)
}

export function parseRgLine(json: string, root: string, platform: Platform = platformOf(root)): Match | { error: string } | null {
  try {
    const event = JSON.parse(json)
    if (event?.type === 'error') {
      const message = event.data?.message ?? event.message
      return typeof message === 'string' ? { error: message.split(/\r?\n/)[0]! } : null
    }
    if (event?.type !== 'match') return null
    const data = event.data
    const pathBytes = typeof data?.path?.bytes === 'string' ? base64Bytes(data.path.bytes) : null
    const path = typeof data?.path?.text === 'string' ? data.path.text : pathBytes === null ? null : decodeUtf8(pathBytes)
    if (path === null || path.includes('\0') || !Number.isSafeInteger(data.line_number) || data.line_number < 1 || !Array.isArray(data.submatches)) return null
    const rel = nativeRel(root, path, platform)
    if (!rel) return null
    if (typeof data.lines?.text !== 'string') {
      return typeof data.lines?.bytes === 'string' && base64Bytes(data.lines.bytes) !== null
        ? { rel, line: data.line_number, text: '[binary line]', ranges: [] } : null
    }
    const text: string = data.lines.text.replace(/\r?\n$/, '')
    const indexes = new Map<number, number>()
    let lastByte = -1
    for (const range of data.submatches) {
      if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) || range.start < 0 || range.end < range.start) return null
      indexes.set(range.start, text.length)
      indexes.set(range.end, text.length)
      lastByte = Math.max(lastByte, range.end)
    }
    // Dense results must index requested boundaries once, never rescan each line prefix.
    let byte = 0
    let index = 0
    for (const ch of text) {
      if (byte > lastByte) break
      const cp = ch.codePointAt(0)!
      const size = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
      for (let at = byte; at < byte + size; at++) if (indexes.has(at)) indexes.set(at, index)
      byte += size
      index += ch.length
    }
    const ranges: [number, number][] = data.submatches.map((range: { start: number; end: number }) => [indexes.get(range.start)!, indexes.get(range.end)!])
    return { rel, line: data.line_number, text, ranges }
  } catch { return null }
}

export function gitGrepArgs(q: SearchQuery): string[] {
  return ['grep', '-n', '--column', '-z', '-I', '--no-color', ...(q.caseSensitive ? [] : ['-i']), q.regex ? '-E' : '-F',
    ...(q.wholeWord ? ['-w'] : []), '-e', q.text, '--',
    ...q.include.map((glob) => `:(glob)${glob}`), ...q.exclude.map((glob) => `:(exclude,glob)${glob}`)]
}

/** Column-only output has no length: leave a caret until the service verifies the first -o match. */
export function parseGitGrep(stdout: string): Match[] {
  const matches: Match[] = []
  let at = 0
  while (at < stdout.length) {
    const pathEnd = stdout.indexOf('\0', at)
    const lineEnd = stdout.indexOf('\0', pathEnd + 1)
    const colEnd = stdout.indexOf('\0', lineEnd + 1)
    if (pathEnd < 0 || lineEnd < 0 || colEnd < 0) break
    const end = stdout.indexOf('\n', colEnd + 1)
    const text = stdout.slice(colEnd + 1, end < 0 ? undefined : end).replace(/\r$/, '')
    const line = Number(stdout.slice(pathEnd + 1, lineEnd))
    const column = Number(stdout.slice(lineEnd + 1, colEnd))
    if (line > 0 && column > 0 && Number.isSafeInteger(line) && Number.isSafeInteger(column)) {
      const start = byteToIndex(text, column - 1)
      matches.push({ rel: stdout.slice(at, pathEnd), line, text, ranges: [[start, start]] })
    }
    at = end < 0 ? stdout.length : end + 1
  }
  return matches
}

export function parseGlobs(text: string): { include: string[]; exclude: string[] } {
  const include: string[] = []
  const exclude: string[] = []
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.startsWith('!')) exclude.push(word.slice(1))
    else include.push(word)
  }
  return { include, exclude }
}
