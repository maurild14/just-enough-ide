import type { Host, Stream } from '../host.ts'
import { GIT_ENV, gitArgv } from '../git/run.ts'
import { isRepo } from '../git/status.ts'
import { insideRel, isInside, joinPath } from '../shared/paths.ts'
import { quickOpenArgs } from './quickopen.ts'
import { planReplace, type ReplaceFile, type Skipped } from './replace.ts'
import { ResultSet } from './results.ts'
import { decodeUtf8, gitGrepArgs, parseGitGrep, parseRgLine, searchArgs, type Match, type SearchQuery } from './rg.ts'

export const RG_MISSING = 'ripgrep (rg) is not installed. Install it to search: https://github.com/BurntSushi/ripgrep#installation'
const FALLBACK_CAP = 8 * 1024 * 1024
const WRITE_CAP = 4 * 1024 * 1024
const firstLine = (text: string) => text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''

function exceedsWriteCap(text: string): boolean {
  let size = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    size += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
    if (size > WRITE_CAP) return true
  }
  return false
}

export function search(host: Host, root: string, q: SearchQuery, onMatch: (m: Match) => void): {
  cancel(): void; done: Promise<{ engine: 'rg' | 'git grep'; error: string | null; ms: number; truncated: boolean }>
} {
  let active: Stream | undefined
  let cancelled = false
  let truncated = false
  let engine: 'rg' | 'git grep' = 'rg'
  const start = Date.now()
  const cancel = () => { cancelled = true; active?.cancel() }
  const done = (async () => {
    const results = new ResultSet()
    const rootReal = (await host.stat(root))?.realPath
    const paths = new Map<string, Promise<boolean>>()
    const emit = async (match: Match) => {
      const rel = insideRel(root, match.rel)
      if (cancelled || !rootReal || !rel) return
      let allowed = paths.get(rel)
      if (!allowed) {
        allowed = host.stat(joinPath(root, rel)).then((info) => info?.kind === 'file' && isInside(rootReal, info.realPath))
        paths.set(rel, allowed)
      }
      if (!await allowed || cancelled) return
      if (!results.add({ ...match, rel })) { truncated = true; active?.cancel(); return }
      onMatch({ ...match, rel })
    }
    const collect = async (argv: string[]): Promise<string> => {
      if (cancelled) return ''
      active = host.stream(gitArgv(root, argv), { env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: '0' } })
      let text = ''
      for await (const line of active.lines) {
        if (cancelled) break
        if (text.length + line.length + 1 > FALLBACK_CAP) { truncated = true; active.cancel(); break }
        text += line + '\n'
      }
      const result = await active.done
      if (!cancelled && !truncated && result.exitCode > 1) throw new Error(firstLine(result.stderr) || `git grep exited with ${result.exitCode}`)
      return text
    }
    try {
      if (cancelled) return null
      let missing = false
      let stdout = false
      try {
        active = host.stream(searchArgs(q), { cwd: root })
        for await (const line of active.lines) {
          stdout = true
          if (cancelled) break
          const parsed = parseRgLine(line, root)
          if (parsed && 'error' in parsed) { active.cancel(); return parsed.error }
          if (parsed) await emit(parsed)
          if (truncated) break
        }
        const result = await active.done
        missing = result.exitCode === 127 && !stdout
        if (!missing && !cancelled && !truncated && result.exitCode > 1) return firstLine(result.stderr) || `rg exited with ${result.exitCode}`
      } catch (error) {
        if (cancelled) return null
        missing = /ENOENT|not found|cannot find|no such file/i.test(String(error))
        if (!missing) throw error
      }
      if (!missing || cancelled) return null
      if ((await isRepo(host, root)) === null) return RG_MISSING
      if (cancelled) return null
      engine = 'git grep'
      const args = gitGrepArgs(q)
      const full = parseGitGrep(await collect(args))
      const only = parseGitGrep(await collect([args[0]!, '--only-matching', ...args.slice(1)]))
      const first = new Map<string, string>()
      for (const match of only) {
        const key = JSON.stringify([match.rel, match.line])
        if (!first.has(key)) first.set(key, match.text)
      }
      for (const match of full) {
        if (cancelled) break
        const text = first.get(JSON.stringify([match.rel, match.line]))
        const offset = match.ranges[0]?.[0]
        if (text === undefined || offset === undefined || match.text.slice(offset, offset + text.length) !== text) continue
        await emit({ ...match, ranges: [[offset, offset + text.length]] })
        if (results.truncated()) break
      }
      return null
    } catch (error) {
      return cancelled ? null : firstLine(error instanceof Error ? error.message : String(error))
    } finally { active?.cancel() }
  })().then((error) => ({ engine, error, ms: Date.now() - start, truncated }))
  return { cancel, done }
}

export async function quickOpenFiles(host: Host, root: string): Promise<string[]> {
  const repo = (await isRepo(host, root)) !== null
  const argv = quickOpenArgs(repo)
  const result = await host.run(repo ? gitArgv(root, argv) : argv, { cwd: root, ...(repo ? { env: GIT_ENV } : {}) })
  if (result.exitCode !== 0) throw new Error(firstLine(result.stderr) || 'Could not list project files.')
  return [...new Set(result.stdout.split('\0').flatMap((path) => {
    const rel = path ? insideRel(root, path) : null
    return rel ? [rel] : []
  }))].slice(0, 50_000)
}

async function readForReplace(host: Host, root: string, rel: string): Promise<{ path: string; text: string } | { reason: Skipped['reason'] }> {
  const safe = insideRel(root, rel)
  if (!safe) return { reason: 'outside-root' }
  const path = joinPath(root, safe)
  const [info, rootInfo] = await Promise.all([host.stat(path), host.stat(root)])
  if (!rootInfo || info && !isInside(rootInfo.realPath, info.realPath)) return { reason: 'outside-root' }
  if (!info || info.kind !== 'file') return { reason: 'unreadable' }
  if (info.size > WRITE_CAP) return { reason: 'too-large' }
  const bytes = await host.readHead(path, info.size + 1)
  if (!bytes) return { reason: 'unreadable' }
  if (bytes.includes(0)) return { reason: 'binary' }
  const text = decodeUtf8(bytes)
  if (text === null) return { reason: 'not-utf8' }
  if (bytes.length !== info.size) return { reason: 'changed' }
  return { path, text }
}

export async function buildReplacePlan(host: Host, root: string, q: SearchQuery, replacement: string): Promise<{ files: ReplaceFile[]; skipped: Skipped[] }> {
  const groups = new ResultSet()
  const result = await search(host, root, q, (match) => { groups.add(match) }).done
  if (result.error) throw new Error(result.error)
  const files: { rel: string; text: string; matches: Match[] }[] = []
  const skipped: Skipped[] = []
  for (const group of groups.groups()) {
    const read = await readForReplace(host, root, group.rel)
    if ('reason' in read) skipped.push({ rel: group.rel, reason: read.reason })
    else files.push({ ...group, text: read.text })
  }
  const plan = planReplace(q, replacement, files)
  const accepted: ReplaceFile[] = []
  for (const file of plan.files) {
    if (exceedsWriteCap(file.after)) skipped.push({ rel: file.rel, reason: 'too-large' })
    else accepted.push(file)
  }
  return { files: accepted, skipped: [...skipped, ...plan.skipped] }
}

export async function applyReplace(host: Host, root: string, plan: ReplaceFile[]): Promise<{ written: string[]; skipped: Skipped[] }> {
  const written: string[] = []
  const skipped: Skipped[] = []
  for (const file of plan) {
    if (exceedsWriteCap(file.after)) { skipped.push({ rel: file.rel, reason: 'too-large' }); continue }
    const read = await readForReplace(host, root, file.rel)
    if ('reason' in read) { skipped.push({ rel: file.rel, reason: read.reason }); continue }
    const fresh = await host.readText(read.path)
    if (read.text !== file.before || fresh !== file.before) { skipped.push({ rel: file.rel, reason: 'changed' }); continue }
    // Resolve again after reads so a replaced symlink cannot redirect the write unnoticed.
    const [rootInfo, info] = await Promise.all([host.stat(root), host.stat(read.path)])
    if (!rootInfo || !info || !isInside(rootInfo.realPath, info.realPath)) { skipped.push({ rel: file.rel, reason: 'outside-root' }); continue }
    // shortcut: Host has no atomic compare-and-swap; add one if concurrent writer isolation is required.
    await host.writeText(read.path, file.after)
    written.push(file.rel)
  }
  return { written, skipped }
}
