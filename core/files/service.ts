import type { DirEntry, Host } from '../host.ts'
import { GIT_ENV, gitArgv } from '../git/run.ts'
import { isRepo } from '../git/status.ts'
import type { Options } from '../options.ts'
import { isInside, joinPath, nativePath } from '../shared/paths.ts'
import { parseDelimited } from './csv.ts'
import { openArgv, openRefusal } from './open.ts'
import { PREVIEW_MAX_BYTES, languageOf, previewKind } from './preview.ts'
import type { PreviewKind } from './preview.ts'
import { IGNORED_ARGS } from './tree.ts'

const WALK_CAP = 20_000
const WALK_SKIP = new Set(['.git', 'node_modules'])
const PREVIEW_ROWS = 200

const absOf = (root: string, rel: string): string => (rel === '' ? root : joinPath(root, rel))

/** Absolute path for `rel`, or null when it leaves `root` (for example `../x`). */
const insideAbs = (root: string, rel: string): string | null => {
  const abs = absOf(root, rel)
  return isInside(root, abs) ? abs : null
}

/** Lists one folder. `ignored` holds the listed paths (posix rels) that git ignores; empty outside a repo. */
export async function listDir(host: Host, root: string, rel: string): Promise<{ entries: DirEntry[]; ignored: string[] }> {
  const abs = insideAbs(root, rel)
  if (abs === null) return { entries: [], ignored: [] }
  const entries = await host.list(abs)
  if (entries.length === 0 || (await isRepo(host, root)) === null) return { entries, ignored: [] }
  const paths = entries.filter((e) => e.name !== '.git').map((e) => joinPath(rel, e.name))
  if (paths.length === 0) return { entries, ignored: [] }
  // check-ignore rejects literal pathspec magic; it matches the given paths as plain paths anyway.
  // Exit 1 means nothing is ignored; any other failure is treated the same (the tree still works).
  const res = await host.run(gitArgv(root, IGNORED_ARGS), { env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: '0' }, stdin: paths.join('\0') + '\0' })
  const ignored = res.exitCode === 0 ? res.stdout.split('\0').filter((p) => p !== '') : []
  return { entries, ignored }
}

export async function loadPreview(
  host: Host,
  root: string,
  rel: string,
): Promise<{ kind: PreviewKind; text?: string; rows?: string[][]; language?: string }> {
  const abs = insideAbs(root, rel)
  if (abs === null) return { kind: 'empty' }
  const name = rel.split('/').pop() ?? rel
  const info = await host.stat(abs)
  if (info === null || info.kind !== 'file') return { kind: 'empty' }
  // A symlink may point outside the project: compare real paths.
  const rootReal = (await host.stat(root))?.realPath
  if (rootReal === undefined || !isInside(rootReal, info.realPath)) return { kind: 'empty' }
  // Size alone settles empty, image and too-large: those files are never read.
  const early = previewKind(name, info.size, new Uint8Array(0))
  if (early === 'empty' || early === 'image' || early === 'too-large') return { kind: early }
  const head = await host.readHead(abs, PREVIEW_MAX_BYTES)
  if (head === null) return { kind: 'error' }
  const kind = previewKind(name, info.size, head)
  if (kind === 'binary') return { kind }
  const text = new TextDecoder().decode(head)
  if (kind === 'csv' || kind === 'tsv') return { kind, rows: parseDelimited(text, kind === 'csv' ? ',' : '\t', PREVIEW_ROWS) }
  const language = languageOf(name)
  return language === undefined ? { kind, text } : { kind, text, language }
}

/** Every file path (posix rels). In a repo: tracked plus untracked, minus ignored. Else a capped breadth-first walk. */
export async function allFiles(host: Host, root: string): Promise<string[]> {
  if ((await isRepo(host, root)) !== null) {
    const res = await host.run(gitArgv(root, ['ls-files', '-co', '--exclude-standard', '-z']), { env: GIT_ENV })
    if (res.exitCode === 0) {
      // Tracked files deleted from the worktree still appear in `-c`; drop them.
      const gone = await host.run(gitArgv(root, ['ls-files', '-d', '-z']), { env: GIT_ENV })
      const deleted = new Set(gone.exitCode === 0 ? gone.stdout.split('\0') : [])
      return [...new Set(res.stdout.split('\0').filter((p) => p !== '' && !deleted.has(p)))]
    }
  }
  const files: string[] = []
  const queue: string[] = ['']
  let seen = 0
  for (let i = 0; i < queue.length && seen < WALK_CAP; i++) {
    const dir = queue[i] ?? ''
    let entries: DirEntry[]
    try {
      entries = await host.list(absOf(root, dir))
    } catch {
      continue
    }
    for (const e of entries) {
      if (WALK_SKIP.has(e.name)) continue
      if (seen >= WALK_CAP) break
      seen++
      const rel = joinPath(dir, e.name)
      if (e.kind === 'dir') queue.push(rel)
      else if (e.kind === 'file') files.push(rel)
    }
  }
  return files
}

/**
 * Opens a file in the editor (`editorCommand`) or the OS opener, with the path in the platform's own form
 * (backslashes on Windows). Returns the refusal for a runnable type with no editor command, and runs nothing
 * then. The exit code is ignored (some openers exit 1 on success).
 */
export async function openFile(host: Host, options: Options, absPath: string, line?: number): Promise<string | null> {
  const path = nativePath(host.platform, absPath)
  const refused = openRefusal({ editorCommand: options.editorCommand, path })
  if (refused !== null) return refused
  const argv = openArgv({
    editorCommand: options.editorCommand,
    path,
    ...(line === undefined ? {} : { line }),
    platform: host.platform,
  })
  await host.run(argv)
  return null
}
