import type { EngineInterface, On, Timer } from 'claude-code'
import { classifyTool, type Touch } from '../../core/activity/classify.ts'
import { ActivityLog, allows } from '../../core/activity/log.ts'
import { reveal } from '../../core/files/tree.ts'
import { snapshot } from '../../core/git/service.ts'
import { latest } from '../../core/latest.ts'
import type { Options } from '../../core/options.ts'
import { reducePane } from '../../core/pane.ts'
import { projectRel } from '../../core/shared/paths.ts'
import { forgetPaths, hostFor, refreshFileList } from './files.tsx'
import { bumpTick, gitState, readActivity, readCwd, setGit, updateActivity, updatePane, updateTree } from './state.ts'

/** Shimmer redraw period: the 250 ms steps of docs/design.md section 9. */
const FRAME_MS = 250
/** Status and listing refresh after the agent's last change. */
const DEBOUNCE_MS = 300
/** Search results touched per call, at most. */
const MAX_PATHS = 200

const guardedSnapshot = latest(snapshot)

/** Re-reads the git snapshot for the current folder; only the latest call lands. */
export async function refreshGit($: EngineInterface): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  const r = await guardedSnapshot(hostFor($, root), root)
  if (!r.stale) await setGit($, gitState(r.value))
}

/** After a change on disk: drop stale caches, re-read the file list and git, redraw. */
export async function refreshAfterChange($: EngineInterface, rels: readonly string[]): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  forgetPaths(root, rels)
  await Promise.all([refreshFileList(hostFor($, root), root).catch(() => undefined), refreshGit($).catch(() => undefined)])
  await bumpTick($)
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
let refreshTimer: Timer | null = null
let pending = new Set<string>()

/** Refresh the touched folders and git once the agent has been quiet for DEBOUNCE_MS. */
function scheduleRefresh($: EngineInterface, rels: readonly string[]): void {
  for (const r of rels) pending.add(r)
  refreshTimer?.cancel()
  refreshTimer = $.clock.after(DEBOUNCE_MS, () => {
    refreshTimer = null
    const batch = [...pending]
    pending = new Set()
    void refreshAfterChange($, batch).catch((err: unknown) => $.ui.log(`jei: refresh failed: ${String(err)}`))
  })
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

/** Records a touch: refresh what changed, glow what the option allows, follow it. */
async function observe($: EngineInterface, touch: Touch, options: Options): Promise<void> {
  const root = await readCwd($)
  if (root === '') return
  const rels = [...new Set(touch.paths.map((p) => projectRel(root, p)).filter((r): r is string => r !== null && r !== ''))].slice(0, MAX_PATHS)
  if (rels.length === 0 && touch.kind !== 'git') return
  if (touch.kind !== 'read') scheduleRefresh($, rels)
  if (rels.length === 0 || !allows(options.activity, touch.kind)) return
  const now = await $.clock.now()
  await updateActivity($, (a) => {
    const log = ActivityLog.from(a)
    for (const rel of rels) log.touch(rel, touch.kind, now)
    return log.toJSON()
  })
  if (options.followAgent) {
    const first = rels[0]!
    await updateTree($, (t) => ({ ...t, expanded: [...reveal(new Set(t.expanded), first)] }))
    await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id: first }))
  }
  if (glowTimer === null) glowTimer = $.clock.every(FRAME_MS, () => void frame($).catch(() => undefined))
}

/** What a tool call touched, search hits included. */
function touchOf(tool: string, e: unknown, ran: unknown): Touch | null {
  const touch = classifyTool(tool, e)
  if (touch !== null && (tool === 'Grep' || tool === 'Glob')) return { kind: 'read', paths: [...touch.paths, ...searchHits(ran)] }
  return touch
}

/** A file event: refresh its folder and git like an agent write. */
async function fileChanged($: EngineInterface, path: string): Promise<void> {
  const root = await readCwd($)
  const rel = root === '' ? null : projectRel(root, path)
  if (rel !== null) scheduleRefresh($, [rel])
}

/**
 * Agent activity: every tool call is classified after it ran (it is never
 * held up), touches glow and the tree follows them, and changes refresh git
 * status and the touched folders. `classic.FileChanged` refreshes the same way.
 */
export function registerActivity(on: On, options: Options): void {
  // Observes only, after the tool ran: a failure here must never change the call.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const touch = touchOf(String(e.tool), e, ran)
    if (touch !== null) await observe($, touch, options).catch((err: unknown) => $.ui.log(`jei: activity: ${String(err)}`))
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.FileChanged', async ($, e, next) => {
    await fileChanged($, e.file_path)
    return next(e)
  }).catch(($, e, next) => next(e))
}
