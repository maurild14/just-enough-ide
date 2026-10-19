export function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

export function joinPath(dir: string, name: string): string {
  const d = toPosix(dir)
  const n = toPosix(name).replace(/^\/+/, '')
  if (d === '') return n
  return d.endsWith('/') ? d + n : `${d}/${n}`
}

type Norm = { prefix: string; segs: string[] }

function normalize(path: string): Norm {
  const p = toPosix(path)
  let prefix = ''
  let rest = p
  const drive = /^[A-Za-z]:/.exec(p)
  if (p.startsWith('//')) {
    prefix = '//'
    rest = p.slice(2)
  } else if (drive) {
    prefix = drive[0]
    rest = p.slice(2)
    if (rest.startsWith('/')) prefix += '/'
  } else if (p.startsWith('/')) {
    prefix = '/'
  }
  const absolute = prefix.endsWith('/')
  const segs: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (segs.length > 0 && segs[segs.length - 1] !== '..') segs.pop()
      else if (!absolute) segs.push('..')
    } else segs.push(seg)
  }
  return { prefix, segs }
}

// Core has no platform, so case folding is a heuristic: a root with a drive
// letter or a UNC prefix is Windows-style and compares case-insensitively;
// anything else (posix roots, relative roots) is case-sensitive.
function foldsCase(n: Norm): boolean {
  return /^[A-Za-z]:/.test(n.prefix) || n.prefix === '//'
}

/** Number of leading segments of `path` that make up `root`, or -1 when not inside. */
function insideCount(root: string, path: string): number {
  const r = normalize(root)
  const p = normalize(path)
  const fold = foldsCase(r) || foldsCase(p)
  const key = (s: string) => (fold ? s.toLowerCase() : s)
  const bare = (s: string) => key(s.replace(/^([A-Za-z]:)\/$/, '$1'))
  if (bare(r.prefix) !== bare(p.prefix)) return -1
  if (r.segs.length > p.segs.length) return -1
  // Leading `..` kept beyond the root means the path escapes it.
  if (p.segs.slice(r.segs.length).includes('..')) return -1
  for (let i = 0; i < r.segs.length; i++) {
    if (key(r.segs[i]!) !== key(p.segs[i]!)) return -1
  }
  return r.segs.length
}

/** Posix path relative to root, no leading `./`. A path outside root comes back normalized and posix. */
export function relativeTo(root: string, path: string): string {
  const n = insideCount(root, path)
  const p = normalize(path)
  if (n < 0) return p.prefix + p.segs.join('/')
  return p.segs.slice(n).join('/')
}

export function isInside(root: string, path: string): boolean {
  return insideCount(root, path) >= 0
}

/** 'a/b/c.ts' -> ['a', 'a/b']. Input is posix-relative (callers pass `toPosix` output); `.` segments are ignored. */
export function parentDirs(rel: string): string[] {
  const segs = toPosix(rel).split('/').filter((s) => s !== '' && s !== '.')
  const out: string[] = []
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'))
  return out
}

/**
 * A path typed by a person (absolute, or relative to `root`) as a posix rel
 * inside `root`, or null when it is outside or escapes with `..`. The root
 * itself gives ''.
 */
export function projectRel(root: string, path: string): string | null {
  return insideRel(root, path.trim())
}

/** A literal filesystem path inside `root`, as a posix rel; preserves filename whitespace. */
export function insideRel(root: string, path: string): string | null {
  const p = toPosix(path)
  if (/^[A-Za-z]:[^/]/.test(p)) return null
  const absolute = /^([A-Za-z]:)?\//.test(p)
  const full = absolute ? p : joinPath(root, p)
  if (!isInside(root, full)) return null
  return relativeTo(root, full)
}

/**
 * The platform a path's shape points to, for hosts that do not say: a drive
 * letter or a UNC prefix is Windows, `/Users/` is macOS, anything else Linux.
 */
export function platformOf(path: string): 'win32' | 'darwin' | 'linux' {
  const p = toPosix(path)
  if (/^[A-Za-z]:/.test(p) || p.startsWith('//')) return 'win32'
  if (p.startsWith('/Users/')) return 'darwin'
  return 'linux'
}
