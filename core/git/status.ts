import type { Host } from '../host.ts'
import { parentDirs } from '../shared/paths.ts'
import { git } from './run.ts'

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'ignored'
export type StatusEntry = { path: string; origPath?: string; index: FileStatus | null; worktree: FileStatus | null }
/** `head` null means detached; `oid` null means no commit yet. */
export type BranchInfo = { head: string | null; oid: string | null; upstream: string | null; ahead: number; behind: number }
export type RepoStatus = { branch: BranchInfo; entries: StatusEntry[] }

export const STATUS_ARGS: readonly string[] = ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']

const CODES: Readonly<Record<string, FileStatus>> = {
  M: 'modified',
  T: 'modified',
  A: 'added',
  C: 'added',
  D: 'deleted',
  R: 'renamed',
}

const code = (c: string | undefined): FileStatus | null => (c === undefined ? null : (CODES[c] ?? null))

/** Field after the n-th space-separated token (path may itself contain spaces). */
function tail(record: string, tokens: number): string {
  let at = -1
  for (let i = 0; i < tokens; i++) at = record.indexOf(' ', at + 1)
  return record.slice(at + 1)
}

/** Parses `git status --porcelain=v2 -z --branch` output. */
export function parseStatus(z: string): RepoStatus {
  const branch: BranchInfo = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 }
  const entries: StatusEntry[] = []
  const fields = z.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i] ?? ''
    if (rec === '') continue
    if (rec.startsWith('# ')) {
      const [key, ...rest] = rec.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') branch.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') branch.head = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') branch.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          branch.ahead = Number(m[1])
          branch.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = rec[0]
    const xy = rec.slice(2, 4)
    if (kind === '1') {
      entries.push({ path: tail(rec, 8), index: code(xy[0]), worktree: code(xy[1]) })
    } else if (kind === '2') {
      const origPath = fields[++i] ?? ''
      entries.push({ path: tail(rec, 9), origPath, index: code(xy[0]), worktree: code(xy[1]) })
    } else if (kind === 'u') {
      entries.push({ path: tail(rec, 10), index: 'conflicted', worktree: 'conflicted' })
    } else if (kind === '?') {
      entries.push({ path: rec.slice(2), index: null, worktree: 'untracked' })
    } else if (kind === '!') {
      entries.push({ path: rec.slice(2), index: null, worktree: 'ignored' })
    }
  }
  return { branch, entries }
}

const RANK: Readonly<Record<FileStatus, number>> = {
  conflicted: 5,
  modified: 4,
  deleted: 4,
  renamed: 4,
  added: 3,
  untracked: 2,
  ignored: 0,
}

/** Status shown on every ancestor folder: conflicted > modified > added > untracked. Deleted and renamed count as modified; ignored is skipped. */
export function folderStatus(entries: readonly StatusEntry[]): Map<string, FileStatus> {
  const out = new Map<string, FileStatus>()
  for (const e of entries) {
    let best: FileStatus | null = null
    for (const s of [e.index, e.worktree]) {
      if (s !== null && RANK[s] > 0 && (best === null || RANK[s] > RANK[best])) best = s
    }
    if (best === null) continue
    const shown: FileStatus = best === 'deleted' || best === 'renamed' ? 'modified' : best
    for (const dir of parentDirs(e.path)) {
      const cur = out.get(dir)
      if (cur === undefined || RANK[shown] > RANK[cur]) out.set(dir, shown)
    }
  }
  return out
}

/** Repo root as git prints it (trailing newline trimmed), or null when `dir` is not in a repo. */
export async function isRepo(host: Host, dir: string): Promise<string | null> {
  try {
    const { stdout } = await git(host, dir, ['rev-parse', '--show-toplevel'])
    const root = stdout.replace(/\r?\n$/, '')
    return root === '' ? null : root
  } catch {
    return null
  }
}
