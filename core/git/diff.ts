import type { Platform } from '../host.ts'

export type DiffLine = { kind: 'add' | 'del' | 'ctx' | 'meta'; text: string; oldNo?: number; newNo?: number }
export type Hunk = { header: string; lines: DiffLine[] }
export type DiffFile = { path: string; origPath?: string; binary: boolean; added: number; removed: number; hunks: Hunk[] }

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Decodes a git C-quoted string body (octal escapes are UTF-8 bytes). */
function unquote(body: string): string {
  const bytes: number[] = []
  const enc = new TextEncoder()
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c !== '\\') {
      bytes.push(...enc.encode(c))
      continue
    }
    const n = body[i + 1] ?? ''
    const oct = /^[0-7]{1,3}/.exec(body.slice(i + 1))
    if (oct) {
      bytes.push(parseInt(oct[0], 8) & 0xff)
      i += oct[0].length
    } else if (n in simple) {
      bytes.push(simple[n]!)
      i++
    } else bytes.push(92)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** Reads a quoted token at the start of `s`; returns [decoded, rest]. */
function quotedAt(s: string): [string, string] {
  let i = 1
  while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1
  return [unquote(s.slice(1, i)), s.slice(i + 1)]
}

/** A path from a `+++`/`rename` line: quoted or bare, with a trailing tab dropped. */
function pathToken(s: string): string {
  if (s.startsWith('"')) return quotedAt(s)[0]
  const tab = s.indexOf('\t')
  return tab >= 0 ? s.slice(0, tab) : s
}

const stripSide = (p: string) => (/^[ab]\//.test(p) ? p.slice(2) : p)

/** Splits the part after `diff --git ` into [old, new] paths. */
function splitHeader(s: string): [string, string] {
  if (s.startsWith('"')) {
    const [a, rest] = quotedAt(s)
    const r = rest.replace(/^ /, '')
    return [stripSide(a), stripSide(r.startsWith('"') ? quotedAt(r)[0] : r)]
  }
  // Same path on both sides: `a/X b/X`.
  const n = (s.length - 5) / 2
  if (Number.isInteger(n) && n > 0 && s.startsWith('a/') && s.slice(2, 2 + n) === s.slice(n + 5)) {
    return [s.slice(2, 2 + n), s.slice(n + 5)]
  }
  const q = s.indexOf(' "b/')
  if (q >= 0) return [stripSide(s.slice(0, q)), stripSide(quotedAt(s.slice(q + 1))[0])]
  const i = s.indexOf(' b/')
  return i < 0 ? [stripSide(s), stripSide(s)] : [stripSide(s.slice(0, i)), s.slice(i + 3)]
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldLeft = 0
  let newLeft = 0
  let renamed = false

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('diff --git ')) {
      const [a, b] = splitHeader(line.slice(11))
      file = { path: b, binary: false, added: 0, removed: 0, hunks: [] }
      if (a !== b) file.origPath = a
      files.push(file)
      hunk = null
      renamed = false
      oldLeft = newLeft = 0
      continue
    }
    if (!file) continue
    if (hunk && (oldLeft > 0 || newLeft > 0 || line.startsWith('\\'))) {
      if (line.startsWith('\\')) {
        hunk.lines.push({ kind: 'meta', text: line })
      } else if (line.startsWith('+')) {
        hunk.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ })
        newLeft--
        file.added++
      } else if (line.startsWith('-')) {
        hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
        oldLeft--
        file.removed++
      } else {
        hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
        oldLeft--
        newLeft--
      }
      continue
    }
    const h = HUNK_RE.exec(line)
    if (h) {
      oldNo = Number(h[1])
      oldLeft = h[2] === undefined ? 1 : Number(h[2])
      newNo = Number(h[3])
      newLeft = h[4] === undefined ? 1 : Number(h[4])
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
    } else if (line.startsWith('rename from ')) {
      file.origPath = pathToken(line.slice(12))
      renamed = true
    } else if (line.startsWith('rename to ')) {
      file.path = pathToken(line.slice(10))
      renamed = true
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true
    } else if (!renamed && !hunk && line.startsWith('+++ ')) {
      // Names with spaces make the `diff --git` line ambiguous; the +++ side is exact.
      const p = pathToken(line.slice(4))
      if (p !== '/dev/null' && p !== 'NUL') file.path = stripSide(p)
    }
  }
  return files
}

export type NumstatEntry = { path: string; origPath?: string; added: number | null; removed: number | null }

/** Parses `git diff --numstat -z`. Renames arrive as `added\tremoved\t\0old\0new\0`; null counts mean binary. */
export function parseNumstat(z: string): NumstatEntry[] {
  const out: NumstatEntry[] = []
  const parts = z.split('\0')
  let i = 0
  while (i < parts.length) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(parts[i++]!)
    if (!m) continue
    const added = m[1] === '-' ? null : Number(m[1])
    const removed = m[2] === '-' ? null : Number(m[2])
    if (m[3] === '') {
      const origPath = parts[i++] ?? ''
      const path = parts[i++] ?? ''
      out.push({ path, origPath, added, removed })
    } else out.push({ path: m[3]!, added, removed })
  }
  return out
}

/** Keeps at most `maxLines` hunk lines: whole hunks before the cut, the cut hunk sliced. */
export function capDiff(file: DiffFile, maxLines: number): { file: DiffFile; truncated: boolean } {
  const total = file.hunks.reduce((n, h) => n + h.lines.length, 0)
  if (total <= maxLines) return { file, truncated: false }
  const hunks: Hunk[] = []
  let left = Math.max(0, maxLines)
  for (const h of file.hunks) {
    if (left <= 0) break
    if (h.lines.length <= left) {
      hunks.push(h)
      left -= h.lines.length
    } else {
      hunks.push({ header: h.header, lines: h.lines.slice(0, left) })
      left = 0
    }
  }
  return { file: { ...file, hunks }, truncated: true }
}

export function workingDiffArgs(path: string, staged: boolean): string[] {
  return ['diff', '--no-color', '--no-ext-diff', ...(staged ? ['--cached'] : []), '--', path]
}

/** `git diff --no-index` exits 1 when the files differ: callers treat exit 1 as success. */
export function untrackedDiffArgs(path: string, platform: Platform): string[] {
  return ['diff', '--no-color', '--no-index', '--', platform === 'win32' ? 'NUL' : '/dev/null', path]
}

const PREFIX = { add: '+', del: '-', ctx: ' ', meta: '' } as const

/** Re-serializes one file as unified text (`---`/`+++` header, then hunks) for a `diff` code block. */
export function toUnifiedText(file: DiffFile): string {
  const out = [`--- a/${file.origPath ?? file.path}`, `+++ b/${file.path}`]
  for (const h of file.hunks) {
    out.push(h.header)
    for (const l of h.lines) out.push(PREFIX[l.kind] + l.text)
  }
  return out.join('\n') + '\n'
}
