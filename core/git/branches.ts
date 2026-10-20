import { assertCommitHash } from './commit.ts'

export type Branch = { name: string; remote: boolean; current: boolean; upstream: string | null; gone: boolean; ahead: number; behind: number; hash: string }
export type SwitchPlan = { steps: string[][]; confirm: string | null }

export function branchesArgs(): string[] {
  return ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)', 'refs/heads', 'refs/remotes']
}

export function parseBranches(stdout: string): Branch[] {
  const branches: Branch[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const [ref, hash, upstream, track, head] = line.split('\0')
    if (!ref || !hash || !/^[0-9a-f]{40}$/.test(hash)) continue
    const remote = ref.startsWith('refs/remotes/')
    if (!remote && !ref.startsWith('refs/heads/')) continue
    const name = ref.slice(remote ? 13 : 11)
    if (remote && name.endsWith('/HEAD')) continue
    const gone = track === 'gone'
    branches.push({ name, hash, remote, current: head === '*', upstream: gone || !upstream ? null : upstream, gone, ahead: Number(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0) })
  }
  return branches.sort((a, b) => Number(a.remote) - Number(b.remote) || Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))
}

export function defaultBase(branches: readonly Branch[], originHead: string | null): string | null {
  const target = originHead?.replace(/^refs\/remotes\//, '')
  if (target && branches.some((branch) => branch.remote && branch.name === target)) return target
  return ['main', 'master'].find((name) => branches.some((branch) => !branch.remote && branch.name === name)) ?? null
}

const DIRTY_CONFIRM = 'You have uncommitted changes. Switch and carry them over?'

export function switchPlan(target: Branch, dirty: boolean, locals: readonly Branch[]): SwitchPlan {
  const local = target.remote ? target.name.slice(target.name.indexOf('/') + 1) : target.name
  if (target.name.startsWith('-') || local.startsWith('-') || local === '@') return { steps: [], confirm: null }
  const steps = !target.remote || locals.some((branch) => !branch.remote && branch.name === local)
    ? [['switch', local]] : [['switch', '--track', target.name]]
  return { steps, confirm: dirty ? DIRTY_CONFIRM : null }
}

export function createPlan(name: string, start: string | null, dirty: boolean): SwitchPlan {
  if (start !== null) assertCommitHash(start)
  return { steps: [['switch', '-c', name, ...(start === null ? [] : [start])]], confirm: dirty ? DIRTY_CONFIRM : null }
}

export function compareArgs(base: string, head: string): string[] {
  return ['diff', '--name-status', '-z', '-M', '--end-of-options', `${base}...${head}`]
}

export function compareDiffArgs(base: string, head: string, path: string): string[] {
  return ['diff', '--no-color', '--no-ext-diff', '-M', '--end-of-options', `${base}...${head}`, '--', path]
}
