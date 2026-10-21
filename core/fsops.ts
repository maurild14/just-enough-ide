import type { FileStat, Host, Platform } from './host.ts'
import { canonicalRel, joinPath, nativePath, nativeRel, parentDirs, toPosix } from './shared/paths.ts'

export type FsOp = 'new' | 'rename' | 'move' | 'delete'
export type FsRequest = { kind: FsOp; source: string }
export type FsPreparation = FsRequest & {
  root: string; realRoot: string; parent: string; parentReal: string
  sourceKind: 'file' | 'dir' | null; sourceReal: string | null; sourceSize: number
  ancestors: string[]
}
export type FsPlan = FsPreparation & { destination: string | null; destinationParentReal: string | null; targetKind: 'file' | 'dir' }

const fail = (message: string): never => { throw new Error(message) }
const parent = (rel: string) => rel.slice(0, Math.max(0, rel.lastIndexOf('/')))
const name = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1)
const full = (root: string, rel: string) => rel ? joinPath(root, rel) : root
const sameName = (a: string, b: string, platform: Platform) => platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** Validate before joining: joinPath deliberately normalizes input used by older read callers. */
function relative(value: string, platform: Platform, empty = false): string {
  if (value === '' && empty) return value
  if (!value.trim() || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f]/.test(value)) fail('Use a name or path inside the project.')
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || !part.trim()) fail('Use a name or path inside the project.')
    if (platform === 'win32') {
      const stem = part.split('.')[0]!.replace(/[ .]+$/, '')
      if (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(stem)) fail('That name is not supported on Windows.')
    }
  }
  return value
}

function metadata(stat: FileStat | null, platform: Platform): FileStat {
  if (!stat || !stat.realPath || !Number.isFinite(stat.size) || stat.size < 0 || (stat.kind !== 'file' && stat.kind !== 'dir')) fail('Cannot verify filesystem metadata.')
  const real = platform === 'win32' ? toPosix(stat!.realPath) : stat!.realPath
  if (canonicalRel(real, real, platform) === null) fail('Cannot verify a canonical filesystem path.')
  return { ...stat!, realPath: real }
}

async function rootStat(host: Host, root: string): Promise<FileStat> {
  const stat = metadata(await host.stat(root), host.platform)
  if (stat.kind !== 'dir') fail('Cannot verify the project root.')
  return stat
}

async function checked(host: Host, root: string, realRoot: string, rel: string, kind?: 'dir' | 'file'): Promise<FileStat> {
  const stat = metadata(await host.stat(full(root, rel)), host.platform)
  if (kind && stat.kind !== kind || canonicalRel(realRoot, stat.realPath, host.platform) === null) fail('That path is outside the project or has changed.')
  return stat
}

async function entry(host: Host, root: string, rel: string): Promise<FileStat> {
  const entries = await host.list(full(root, parent(rel)))
  const literal = entries.filter(e => e.name === name(rel))
  const ascii = (value: string) => value.replace(/[A-Z]/g, ch => ch.toLowerCase())
  const found = literal.length ? literal : entries.filter(e => host.platform === 'win32' && ascii(e.name) === ascii(name(rel)))
  if (found.length !== 1 || found[0]!.kind !== 'file' && found[0]!.kind !== 'dir') fail('Select an existing regular file or folder.')
  const stat = metadata(await host.stat(full(root, rel)), host.platform)
  if (stat.kind !== found[0]!.kind || name(stat.realPath) !== found[0]!.name) fail('That path has changed.')
  return stat
}

/** Captured evidence is re-read before effects; it is never an authorization to use an old path. */
export async function prepareFsOp(host: Host, root: string, request: FsRequest): Promise<FsPreparation> {
  const source = relative(request.source, host.platform, request.kind === 'new')
  const realRoot = (await rootStat(host, root)).realPath
  let sourceStat: FileStat | null = null
  if (source) {
    sourceStat = await entry(host, root, source)
    if (canonicalRel(realRoot, sourceStat.realPath, host.platform) === null || canonicalRel(realRoot, sourceStat.realPath, host.platform) === '') fail('The project root and outside paths cannot be changed.')
  }
  const sourceParent = source ? parent(source) : ''
  const destinationParent = request.kind === 'new' && sourceStat?.kind === 'dir' ? source : sourceParent
  const ancestors: string[] = []
  for (const rel of [...new Set([...parentDirs(source), ...parentDirs(destinationParent), destinationParent])]) {
    ancestors.push((await checked(host, root, realRoot, rel, 'dir')).realPath)
  }
  const parentReal = (await checked(host, root, realRoot, destinationParent, 'dir')).realPath
  return { kind: request.kind, source, root, realRoot, parent: destinationParent, parentReal, sourceKind: sourceStat?.kind as 'file' | 'dir' | null ?? null, sourceReal: sourceStat?.realPath ?? null, sourceSize: sourceStat?.size ?? 0, ancestors }
}

function destinationOf(prepared: FsPreparation, value: string | undefined, platform: Platform): { destination: string | null; targetKind: 'file' | 'dir' } {
  if (prepared.kind === 'delete') {
    if (value !== undefined) fail('Delete does not take a destination.')
    return { destination: null, targetKind: prepared.sourceKind! }
  }
  if (typeof value !== 'string') fail('Enter a name or destination.')
  const directory = prepared.kind === 'new' && value!.endsWith('/')
  const raw = directory ? value!.slice(0, -1) : value!
  relative(raw, platform)
  if (prepared.kind !== 'move' && raw.includes('/')) fail('Enter one name without a path separator.')
  return { destination: prepared.kind === 'move' ? raw : full(prepared.parent, raw), targetKind: prepared.kind === 'new' ? directory ? 'dir' : 'file' : prepared.sourceKind! }
}

export async function planFsOp(host: Host, prepared: FsPreparation, value?: string): Promise<FsPlan> {
  const destination = destinationOf(prepared, value, host.platform)
  const fresh = await prepareFsOp(host, prepared.root, { kind: prepared.kind, source: prepared.source })
  if (JSON.stringify(fresh) !== JSON.stringify(prepared)) fail('The project or selected path has changed. Start again.')
  let destinationParentReal: string | null = null
  if (destination.destination !== null) {
    const rel = destination.destination
    for (const ancestor of [...parentDirs(rel), parent(rel)]) await checked(host, prepared.root, prepared.realRoot, ancestor, 'dir')
    const stat = await checked(host, prepared.root, prepared.realRoot, parent(rel), 'dir')
    destinationParentReal = stat.realPath
    if (prepared.kind !== 'new' && prepared.sourceKind === 'dir' && prepared.sourceReal && (nativeRel(full(prepared.root, prepared.source), full(prepared.root, rel), host.platform) !== null || canonicalRel(prepared.sourceReal, stat.realPath, host.platform) !== null)) fail('A folder cannot be moved into itself or a descendant.')
    const entries = await host.list(full(prepared.root, parent(rel)))
    if (entries.some(e => sameName(e.name, name(rel), host.platform)) || await host.stat(full(prepared.root, rel))) fail('That destination already exists.')
  }
  return { ...prepared, ...destination, destinationParentReal }
}

const PS_MKDIR = "$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Path $env:JEI_FS_DESTINATION -ErrorAction Stop | Out-Null"
const PS_MOVE = "$ErrorActionPreference='Stop'; Move-Item -LiteralPath $env:JEI_FS_SOURCE -Destination $env:JEI_FS_DESTINATION -ErrorAction Stop"
const PS_FILE_DELETE = "$ErrorActionPreference='Stop'; Remove-Item -LiteralPath $env:JEI_FS_SOURCE -Force -ErrorAction Stop"
const PS_DIR_DELETE = "$ErrorActionPreference='Stop'; Remove-Item -LiteralPath $env:JEI_FS_SOURCE -Recurse -Force -ErrorAction Stop"

/** Windows runs fixed program text only; paths remain environment data (ADR 0028). */
export function fsOpCommand(plan: FsPlan, platform: Platform): { argv: string[]; env?: Record<string, string> } | null {
  if (plan.kind === 'new' && plan.targetKind === 'file') return null
  const source = nativePath(platform, full(plan.root, plan.source))
  const destination = plan.destination === null ? '' : nativePath(platform, full(plan.root, plan.destination))
  if (platform === 'win32') return { argv: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', plan.kind === 'new' ? PS_MKDIR : plan.kind === 'delete' ? plan.targetKind === 'dir' ? PS_DIR_DELETE : PS_FILE_DELETE : PS_MOVE], env: { JEI_FS_SOURCE: source, JEI_FS_DESTINATION: destination } }
  return { argv: plan.kind === 'new' ? ['mkdir', '--', destination] : plan.kind === 'delete' ? ['rm', ...(plan.targetKind === 'dir' ? ['-r'] : []), '--', source] : ['mv', '-n', '--', source, destination] }
}

/** Exit zero can mean mv -n skipped. Require the exact result before reporting success. */
export async function verifyFsOp(host: Host, plan: FsPlan): Promise<string> {
  if (canonicalRel(plan.realRoot, (await rootStat(host, plan.root)).realPath, host.platform) !== '') fail('The project root changed during the operation.')
  if (plan.kind !== 'new') {
    const entries = await host.list(full(plan.root, parent(plan.source)))
    if (entries.some(e => e.name === name(plan.sourceReal!)) || await host.stat(full(plan.root, plan.source))) fail('The filesystem operation did not complete.')
  }
  if (plan.destination !== null) {
    const stat = await entry(host, plan.root, plan.destination)
    if (stat.kind !== plan.targetKind || !plan.destinationParentReal || canonicalRel(full(plan.destinationParentReal, name(plan.destination)), stat.realPath, host.platform) !== '') fail('The filesystem operation did not reach its exact destination.')
    const result = canonicalRel(plan.realRoot, stat.realPath, host.platform)
    if (result === null) fail('The filesystem operation left the project.')
    return result!
  }
  const result = canonicalRel(plan.realRoot, plan.parentReal, host.platform)
  if (result === null) fail('The filesystem operation left the project.')
  return result!
}
