import type { EngineInterface, On, Timer } from 'claude-code'
import { classifyTool, type ActivityKind, type Touch } from '../../core/activity/classify.ts'
import { ActivityLog, allows } from '../../core/activity/log.ts'
import { reveal } from '../../core/files/tree.ts'
import { git } from '../../core/git/run.ts'
import { snapshot } from '../../core/git/service.ts'
import { latest } from '../../core/latest.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { joinPath, projectRel, toPosix } from '../../core/shared/paths.ts'
import { forgetAll, forgetFileList, forgetPaths, hostFor, refreshFileList } from './files.tsx'
import {
  bumpTick,
  gitState,
  readActivity,
  readCwd,
  readPane,
  readTree,
  setGit,
  updateActivity,
  updatePane,
  updateTree,
} from './state.ts'

/** Shimmer redraw period: the 250 ms steps of docs/design.md section 9. */
const FRAME_MS = 250
/** Status and listing refresh after the agent's last change. */
const DEBOUNCE_MS = 300
/** Longest a refresh waits while changes keep coming. */
const MAX_WAIT_MS = 1500
/** Search results touched per call, at most. */
const MAX_PATHS = 200
/** Touches kept in the activity log (the most recent). */
const MAX_TOUCHED = 500
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

type Row = { kind: ActivityKind; at: number }

const guardedSnapshot = latest(snapshot)

/** Re-reads the git snapshot for the current folder; only the latest call lands. */
export async function refreshGit($: EngineInterface): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  const r = await guardedSnapshot(hostFor($, root), root)
  if (!r.stale) await setGit($, gitState(r.value))
}

// Other caches a refresh drops (the diff view's), registered by their modules so this one imports none of them.
const forgetters: (() => void)[] = []

/** Registers a cache to drop on every refresh. */
export function onRefresh(forget: () => void): void {
  forgetters.push(forget)
}

/**
 * After a change on disk: drop stale caches (everything for `all`, a shell
 * command), re-read git, re-read the filter's file list only while the filter
 * is open (else drop it for a lazy re-read), and redraw.
 */
export async function refreshAfterChange($: EngineInterface, rels: readonly string[], all = false): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  if (all) forgetAll(root)
  else forgetPaths(root, rels)
  for (const forget of forgetters) forget()
  let fileList: Promise<void> | undefined
  if ((await readTree($)).filtering) fileList = refreshFileList(hostFor($, root), root).catch(() => undefined)
  else forgetFileList(root)
  await Promise.all([fileList, refreshGit($).catch(() => undefined)])
  await bumpTick($)
}

/** Paths to watch for git changes made outside the agent's tools: the index and HEAD. */
export async function watchPathsFor($: EngineInterface, cwd: string): Promise<string[]> {
  try {
    const out = await git(hostFor($, cwd), cwd, ['rev-parse', '--absolute-git-dir'])
    const dir = toPosix(out.stdout.trim())
    return dir === '' ? [] : [joinPath(dir, 'index'), joinPath(dir, 'HEAD')]
  } catch {
    return []
  }
}

/** File paths a Grep or Glob answered with, from its result. */
function searchHits(ran: unknown): string[] {
  if (typeof ran !== 'object' || ran === null) return []
  const r = ran as { deny?: unknown; isError?: unknown; result?: unknown }
  if (r.deny !== undefined || r.isError === true) return []
  const names = (r.result as { filenames?: unknown } | undefined)?.filenames
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : []
}

// Timers live for the module's life: a hot reload drops them with the module.
let glowTimer: Timer | null = null
let quietTimer: Timer | null = null
let maxTimer: Timer | null = null
let pending = new Set<string>()
let pendingAll = false

/** Runs the pending refresh now. */
function flush($: EngineInterface): void {
  quietTimer?.cancel()
  maxTimer?.cancel()
  quietTimer = null
  maxTimer = null
  const batch = [...pending]
  const all = pendingAll
  pending = new Set()
  pendingAll = false
  void refreshAfterChange($, batch, all).catch((err: unknown) => $.ui.log(`jei: refresh failed: ${String(err)}`))
}

/**
 * Refresh once the agent has been quiet for DEBOUNCE_MS, and at the latest
 * MAX_WAIT_MS after the first change of a burst. `all` drops every cache.
 */
function scheduleRefresh($: EngineInterface, rels: readonly string[], all = false): void {
  for (const r of rels) pending.add(r)
  if (all) pendingAll = true
  quietTimer?.cancel()
  quietTimer = $.clock.after(DEBOUNCE_MS, () => flush($))
  if (maxTimer === null) maxTimer = $.clock.after(MAX_WAIT_MS, () => flush($))
}

/** One shimmer frame: redraw, and stop the clock once nothing glows. */
async function frame($: EngineInterface): Promise<void> {
  await bumpTick($)
  const now = await $.clock.now()
  if (!ActivityLog.from(await readActivity($)).isGlowing(now)) {
    glowTimer?.cancel()
    glowTimer = null
  }
}

/** The most recent MAX_TOUCHED touches: the log never grows past them. */
function capped(json: Record<string, Row>): Record<string, Row> {
  const rows = Object.entries(json)
  if (rows.length <= MAX_TOUCHED) return json
  return Object.fromEntries(rows.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_TOUCHED))
}

/** Records a touch: refresh what changed, glow what the option allows, follow it. */
async function observe($: EngineInterface, touch: Touch, options: Options, shell: boolean): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  const rels = [...new Set(touch.paths.map((p) => projectRel(root, p)).filter((r): r is string => r !== null && r !== ''))].slice(0, MAX_PATHS)
  // A shell command's effects are not all in its paths: refresh everything.
  if (touch.kind !== 'read') scheduleRefresh($, rels, shell)
  if (rels.length === 0 || !allows(options.activity, touch.kind)) return
  const now = await $.clock.now()
  await updateActivity($, (a) => {
    const log = ActivityLog.from(a)
    for (const rel of rels) log.touch(rel, touch.kind, now)
    return capped(log.toJSON())
  })
  if (options.followAgent) {
    const first = rels[0]!
    await updateTree($, (t) => ({ ...t, expanded: [...reveal(new Set(t.expanded), first)] }))
    // An open preview keeps what the person is reading.
    if (currentView(await readPane($)) !== 'files.preview') {
      await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id: first }))
    }
  }
  if (glowTimer === null) glowTimer = $.clock.every(FRAME_MS, () => void frame($).catch(() => undefined))
}

/** What a tool call touched, search hits included. */
function touchOf(tool: string, e: unknown, ran: unknown): Touch | null {
  const touch = classifyTool(tool, e)
  if (touch !== null && (tool === 'Grep' || tool === 'Glob')) return { kind: 'read', paths: [...touch.paths, ...searchHits(ran)] }
  return touch
}

/** After a tool ran: shimmer and follow, and refresh what it may have changed. */
async function toolRan($: EngineInterface, tool: string, e: unknown, ran: unknown, options: Options): Promise<void> {
  const touch = touchOf(tool, e, ran)
  const shell = SHELL_TOOLS.has(tool)
  if (touch === null) {
    // A shell command JEI cannot read may still have changed files.
    if (shell) scheduleRefresh($, [], true)
    return
  }
  await observe($, touch, options, shell)
}

/** A file event: refresh its folder (when inside the project) and git like an agent write. */
async function fileChanged($: EngineInterface, path: string): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  const rel = projectRel(root, path)
  scheduleRefresh($, rel === null ? [] : [rel])
}

/**
 * Agent activity: every tool call is classified after it ran (it is never
 * held up, and the hook does not wait for the bookkeeping), touches glow and
 * the tree follows them, and changes refresh git status and the touched
 * folders. `classic.SessionStart` asks to watch the git index and HEAD, and
 * `classic.FileChanged` refreshes the same way.
 */
export function registerActivity(on: On, options: Options): void {
  // Observes only, after the tool ran: a failure here must never change the call.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void toolRan($, String(e.tool), e, ran, options).catch((err: unknown) => $.ui.log(`jei: activity: ${String(err)}`))
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    const paths = await watchPathsFor($, e.cwd)
    return paths.length === 0 ? r : { ...r, watchPaths: [...(r.watchPaths ?? []), ...paths] }
  }).catch(($, e, next) => next(e))

  on('classic.FileChanged', async ($, e, next) => {
    await fileChanged($, e.file_path)
    return next(e)
  }).catch(($, e, next) => next(e))
}
