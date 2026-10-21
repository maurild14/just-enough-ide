import type { FileStatus } from '../git/status.ts'
import type { DirEntry } from '../host.ts'
import { fuzzyScore } from '../shared/fuzzy.ts'
import { joinPath, parentDirs } from '../shared/paths.ts'

export type TreeInput = {
  root: string
  expanded: ReadonlySet<string>
  /** Directory listings keyed by posix rel path; '' is the root. */
  listings: ReadonlyMap<string, readonly DirEntry[]>
  ignored: ReadonlySet<string>
  showHidden: boolean
  status: ReadonlyMap<string, FileStatus>
  glow: (rel: string) => number
  touched: (rel: string) => boolean
  /** Entries shown per folder before a { more } row. */
  limit: number
  /** One successful target, only while selected; preserve filters and the folder cap. */
  revealed?: string
}

export type TreeRow =
  | { rel: string; name: string; depth: number; isDir: boolean; isExpanded: boolean; status: FileStatus | null; glow: number; touched: boolean }
  | { rel: string; depth: number; more: number }

/** Args for `git check-ignore`; the caller passes the listed paths on stdin, NUL-separated. */
export const IGNORED_ARGS: readonly string[] = ['check-ignore', '--stdin', '-z']

function compare(a: DirEntry, b: DirEntry): number {
  const ad = a.kind === 'dir'
  const bd = b.kind === 'dir'
  if (ad !== bd) return ad ? -1 : 1
  const la = a.name.toLowerCase()
  const lb = b.name.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * Flatten the expanded tree into rows. Past `limit` entries in one folder a
 * single { more } row carries the count of hidden entries; the host builds its
 * text. Its `rel` is `<folder>/…` so it is unique and never a real path.
 */
export function treeRows(input: TreeInput): TreeRow[] {
  const out: TreeRow[] = []
  const revealed = new Set(input.revealed ? [...parentDirs(input.revealed), input.revealed] : [])
  const walk = (dir: string, depth: number): void => {
    const visible = (input.listings.get(dir) ?? []).filter((e) => {
      if (e.name === '.git') return false
      if (input.showHidden || revealed.has(joinPath(dir, e.name))) return true
      return !e.name.startsWith('.') && !input.ignored.has(joinPath(dir, e.name))
    })
    visible.sort(compare)
    const shown = visible.slice(0, Math.max(0, input.limit))
    const target = visible.find(e => revealed.has(joinPath(dir, e.name)))
    if (target && shown.length && !shown.includes(target)) { shown[shown.length - 1] = target; shown.sort(compare) }
    for (const e of shown) {
      const rel = joinPath(dir, e.name)
      const isDir = e.kind === 'dir'
      const isExpanded = isDir && input.expanded.has(rel)
      out.push({
        rel,
        name: e.name,
        depth,
        isDir,
        isExpanded,
        status: input.status.get(rel) ?? null,
        glow: input.glow(rel),
        touched: input.touched(rel),
      })
      if (isExpanded) walk(rel, depth + 1)
    }
    if (visible.length > shown.length) out.push({ rel: joinPath(dir, '…'), depth, more: visible.length - shown.length })
  }
  walk('', 0)
  return out
}

/** .git is always excluded; a completed operation there reveals its nearest displayable parent. */
export function visibleTreePath(rel: string): string {
  const parts = rel.split('/'), git = parts.indexOf('.git')
  return git < 0 ? rel : parts.slice(0, git).join('/')
}

/** Fuzzy filter over every known path, best first, at most `max`. */
export function filterRows(all: readonly string[], query: string, max: number): string[] {
  if (max <= 0) return []
  const prefix = query.toLowerCase()
  const scored: { path: string; score: number; index: number; prefix: boolean }[] = []
  all.forEach((path, index) => {
    const score = fuzzyScore(query, path)
    if (score !== null) scored.push({ path, score, index, prefix: path.slice(path.lastIndexOf('/') + 1).toLowerCase().startsWith(prefix) })
  })
  scored.sort((a, b) => Number(b.prefix) - Number(a.prefix) || b.score - a.score || a.index - b.index)
  return scored.slice(0, max).map((s) => s.path)
}

/** A copy of `expanded` with every ancestor folder of `rel` added. */
export function reveal(expanded: ReadonlySet<string>, rel: string): Set<string> {
  const next = new Set(expanded)
  for (const dir of parentDirs(rel)) next.add(dir)
  return next
}
