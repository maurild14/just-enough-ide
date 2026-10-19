import type { Host } from '../host.ts'
import { git } from './run.ts'

export type HookSignals = {
  hooksPath: string | null
  hookFiles: readonly string[]
  hasHusky: boolean
  hasLefthook: boolean
  hasPreCommit: boolean
  gitattributes: string | null
}

/** True when a commit may be slowed or changed by hooks or LFS filters. */
export function usesHooks(s: HookSignals): boolean {
  return (
    s.hookFiles.some((f) => !f.endsWith('.sample')) ||
    s.hooksPath !== null ||
    s.hasHusky ||
    s.hasLefthook ||
    s.hasPreCommit ||
    (s.gitattributes?.includes('filter=lfs') ?? false)
  )
}

const isAbsolute = (p: string) => p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)

async function tryGit(host: Host, root: string, args: string[]): Promise<string | null> {
  try {
    const out = (await git(host, root, args)).stdout.replace(/\r?\n$/, '')
    return out === '' ? null : out
  } catch {
    return null
  }
}

async function exists(host: Host, path: string): Promise<boolean> {
  return (await host.stat(path)) !== null
}

/** Gathers hook signals through the Host only. `rev-parse --git-path hooks` keeps linked worktrees correct. */
export async function readHookSignals(host: Host, root: string): Promise<HookSignals> {
  const hooksPath = await tryGit(host, root, ['config', '--get', 'core.hooksPath'])
  const gitHooks = await tryGit(host, root, ['rev-parse', '--git-path', 'hooks'])
  let hookFiles: string[] = []
  if (gitHooks !== null) {
    try {
      const dir = isAbsolute(gitHooks) ? gitHooks : `${root}/${gitHooks}`
      hookFiles = (await host.list(dir)).filter((e) => e.kind === 'file').map((e) => e.name)
    } catch {
      hookFiles = []
    }
  }
  const [hasHusky, lefthook, dotLefthook, hasPreCommit, gitattributes] = await Promise.all([
    exists(host, `${root}/.husky`),
    exists(host, `${root}/lefthook.yml`),
    exists(host, `${root}/.lefthook.yml`),
    exists(host, `${root}/.pre-commit-config.yaml`),
    host.readText(`${root}/.gitattributes`),
  ])
  return { hooksPath, hookFiles, hasHusky, hasLefthook: lefthook || dotLefthook, hasPreCommit, gitattributes }
}
