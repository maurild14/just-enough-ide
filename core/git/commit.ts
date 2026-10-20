import { parseNumstat } from './diff.ts'

export type CommitFile = { path: string; from?: string; status: 'M' | 'A' | 'D' | 'R' | 'T'; added: number | null; removed: number | null }

/** v0.2 uses full SHA-1 OIDs, never revision expressions from a host. */
export function assertCommitHash(hash: string): void {
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('Invalid commit hash.')
}

export function commitFilesArgs(hash: string): string[][] {
  const args = ['diff-tree', '-r', '-z', '--root', '-M', '--diff-merges=first-parent', '--no-commit-id']
  return [['--name-status'], ['--numstat']].map((format) => [...args, ...format, hash])
}

export function parseCommitFiles(nameStatus: string, numstat: string): CommitFile[] {
  const counts = new Map(parseNumstat(numstat).map((entry) => [entry.path, entry]))
  const fields = nameStatus.split('\0')
  const files: CommitFile[] = []
  for (let i = 0; i + 1 < fields.length;) {
    const code = fields[i++]!
    const from = fields[i++]!
    const path = code.startsWith('R') ? fields[i++] : from
    const status = code[0] as CommitFile['status']
    if (!path || !['M', 'A', 'D', 'R', 'T'].includes(status)) continue
    const count = counts.get(path)
    files.push({ path, ...(status === 'R' ? { from } : {}), status, added: count?.added ?? null, removed: count?.removed ?? null })
  }
  return files
}

export function commitDiffArgs(hash: string, path: string, isRoot: boolean): string[] {
  return isRoot
    ? ['show', '--no-color', '--no-ext-diff', '-M', '--format=', hash, '--', path]
    : ['diff', '--no-color', '--no-ext-diff', '-M', `${hash}^`, hash, '--', path]
}

export function checkoutArgs(hash: string): string[] {
  assertCommitHash(hash)
  return ['switch', '--detach', '--end-of-options', hash]
}

export function revertArgs(hash: string): string[] {
  assertCommitHash(hash)
  return ['revert', '--no-edit', '--end-of-options', hash]
}

export function commitWebUrl(remoteUrl: string, hash: string): string | null {
  assertCommitHash(hash)
  const match = /^(?:git@([^/:]+):|(?:https:\/\/(?:[^\s/@]*@)?|ssh:\/\/git@)([^/:]+)\/)([^\s?#\\]+)$/.exec(remoteUrl)
  if (!match) return null
  const host = (match[1] ?? match[2]!).toLowerCase()
  if (host !== 'github.com' && host !== 'gitlab.com') return null
  const segments = match[3]!.replace(/\.git$/, '').split('/')
  if (segments.length < 2 || (host === 'github.com' && segments.length !== 2) || segments.some((segment) => !/^[a-zA-Z0-9_.-]+$/.test(segment) || segment === '.' || segment === '..')) return null
  return `https://${host}/${segments.join('/')}/${host === 'gitlab.com' ? '-/' : ''}commit/${hash}`
}
