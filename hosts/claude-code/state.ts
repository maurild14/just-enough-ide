import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Tab, View } from '../../core/keys.ts'
import { initialPane, normalizePane, type PaneState } from '../../core/pane.ts'
import type { ActivityKind } from '../../core/activity/classify.ts'
import type { GitSnapshot } from '../../core/git/service.ts'
import type { StatusEntry } from '../../core/git/status.ts'
import type { CommitMode } from '../../core/git/commands.ts'
import type { JeiActivity, JeiCommitMode, JeiGit, JeiGitUi, JeiHistory, JeiPane, JeiPreview, JeiTab, JeiTree, JeiView } from '../../types/index.d.ts'
import type { JeiSearch } from '../../types/index.d.ts'
import type { Match } from '../../core/search/rg.ts'
import type { ReplaceFile, Skipped } from '../../core/search/replace.ts'

/** The pane's id: `$.ui.open({ id })` and the `requestId` its `ui.render` reads. */
export const PANE_ID = 'jei'

// Session state ($.state, declared in types/index.d.ts). Written only from
// handlers through `update`, never while drawing. `claude plugin validate`
// traces a state call only to an atom declared in the same file, so other
// files go through the accessors below instead of calling read/update.
export const pane = atom({ plugin: 'jei', key: 'pane' } as const, initialPane('files'))
export const cwd = atom({ plugin: 'jei', key: 'cwd' } as const, '')
export const activity = atom({ plugin: 'jei', key: 'activity' } as const, {})
export const git = atom({ plugin: 'jei', key: 'git' } as const, null)
export const tree = atom({ plugin: 'jei', key: 'tree' } as const, {
  expanded: [],
  showHidden: false,
  filtering: false,
  filter: '',
} satisfies JeiTree)
export const preview = atom({ plugin: 'jei', key: 'preview' } as const, { rel: '', source: false, top: 0 } satisfies JeiPreview)
export const tick = atom({ plugin: 'jei', key: 'tick' } as const, 0)
export const history = atom({ plugin: 'jei', key: 'history' } as const, {})
export const searches = atom({ plugin: 'jei', key: 'searches' } as const, {})
export const gitUi = atom({ plugin: 'jei', key: 'gitUi' } as const, {
  message: '',
  mode: 'commit',
  ask: null,
  busy: null,
  collapsed: [],
  diffTop: 0,
} satisfies JeiGitUi)

type StateHost = Pick<EngineInterface, 'state'>

const emptySearch = (): JeiSearch => ({ text: '', caseSensitive: false, regex: false, wholeWord: false, globs: '', replacement: '', editing: null, matches: [], summary: '', engine: 'rg', busy: false, plan: [], skipped: [], expanded: [], top: 0, confirm: null })
export async function readSearch($: StateHost, root: string): Promise<JeiSearch> { return (await read($, searches))[root] ?? emptySearch() }
export function updateSearch($: StateHost, root: string, fn: (s: JeiSearch) => JeiSearch): Promise<Record<string, JeiSearch>> { return update($, searches, all => ({ ...all, [root]: fn(all[root] ?? emptySearch()) })) }

const emptyHistory = (): JeiHistory => ({ filter: '', draft: '', filtering: false, pages: 1, expanded: null, agents: [], newBranch: null, branchFilter: '', branchFiltering: false, compared: null })
export async function readHistory($: StateHost, root: string): Promise<JeiHistory> {
  return (await read($, history))[root] ?? emptyHistory()
}
export function updateHistory($: StateHost, root: string, fn: (h: JeiHistory) => JeiHistory): Promise<Record<string, JeiHistory>> {
  return update($, history, (all) => ({ ...all, [root]: fn(all[root] ?? emptyHistory()) }))
}

// Function declarations, not arrows: the validator follows `$` across an
// import only into a declaration.
export function readPane($: StateHost): Promise<PaneState> {
  return read($, pane).then(normalizePane)
}
export function readCwd($: StateHost): Promise<string> {
  return read($, cwd)
}
export function updatePane($: StateHost, fn: (s: PaneState) => PaneState): Promise<PaneState> {
  return update($, pane, (state) => ({ ...fn(normalizePane(state)), filesScope: state.filesScope }))
}
export function updateTree($: StateHost, fn: (t: JeiTree) => JeiTree): Promise<JeiTree> {
  return update($, tree, fn)
}
export async function setCwd($: StateHost, dir: string): Promise<string> {
  // Invalidate both publication atoms before cwd changes: pending CAS writes must retry their scope checks.
  await update($, tree, t => t.filesRoot === dir ? t : { ...t, filesRoot: dir, revealed: undefined, operation: null, operationBusy: t.operation?.working || !t.operation ? t.operationBusy : null })
  await update($, pane, p => p.filesScope?.root === dir ? p : { ...p, filesScope: { root: dir, owner: null } })
  return update($, cwd, () => dir)
}
export async function claimFilesPane($: StateHost, root: string, id: string): Promise<boolean> {
  let claimed = false
  await update($, pane, p => { claimed = p.filesScope?.root === root && !p.filesScope.owner; return claimed ? { ...p, filesScope: { root, owner: id } } : p })
  return claimed
}
export function releaseFilesPane($: StateHost, root: string, id: string): Promise<JeiPane> {
  return update($, pane, p => p.filesScope?.root === root && p.filesScope.owner === id ? { ...p, filesScope: { root, owner: null } } : p)
}
export async function filesPaneOwned($: StateHost, root: string, id: string): Promise<boolean> {
  const scope = (await read($, pane)).filesScope
  return scope?.root === root && scope.owner === id
}
export function publishFilesPane($: StateHost, root: string, id: string, fn: (p: PaneState) => PaneState): Promise<JeiPane> {
  return update($, pane, p => p.filesScope?.root === root && p.filesScope.owner === id ? { ...fn(normalizePane(p)), filesScope: p.filesScope } : p)
}
export function publishFilesTree($: StateHost, root: string, id: string, fn: (t: JeiTree) => JeiTree): Promise<JeiTree> {
  return update($, tree, t => t.filesRoot === root && t.operationBusy === id && t.operation?.id === id ? fn(t) : t)
}
export function readTree($: StateHost): Promise<JeiTree> {
  return read($, tree)
}
export async function resetFilesUi($: StateHost): Promise<void> {
  await update($, tree, t => ({ ...t, operation: null, operationBusy: null }))
  await update($, pane, p => ({ ...p, filesScope: p.filesScope ? { ...p.filesScope, owner: null } : undefined }))
}
export function readActivity($: StateHost): Promise<JeiActivity> {
  return read($, activity)
}
export function updateActivity($: StateHost, fn: (a: JeiActivity) => JeiActivity): Promise<JeiActivity> {
  return update($, activity, fn)
}
export function readGit($: StateHost): Promise<JeiGit | null> {
  return read($, git)
}
export function setGit($: StateHost, value: JeiGit | null): Promise<JeiGit | null> {
  return update($, git, () => value)
}
export function readPreview($: StateHost): Promise<JeiPreview> {
  return read($, preview)
}
export function updatePreview($: StateHost, fn: (p: JeiPreview) => JeiPreview): Promise<JeiPreview> {
  return update($, preview, fn)
}
/** Read while drawing so a bump redraws: the shimmer clock and refreshed caches. */
export function readTick($: StateHost): Promise<number> {
  return read($, tick)
}
export function readGitUi($: StateHost): Promise<JeiGitUi> {
  return read($, gitUi)
}
export function updateGitUi($: StateHost, fn: (g: JeiGitUi) => JeiGitUi): Promise<JeiGitUi> {
  return update($, gitUi, fn)
}
/** A new session has no operation running and no open question (a reload may have cut one short). */
export function resetGitUi($: StateHost): Promise<JeiGitUi> {
  return update($, gitUi, (g) => ({ ...g, busy: null, ask: null }))
}
/** Hot reload keeps data, but no abandoned operation, editor or confirmation. */
export async function resetSearch($: StateHost): Promise<void> {
  await update($, searches, all => Object.fromEntries(Object.entries(all).map(([root, s]) => [root, { ...s, busy: false, editing: null, confirm: null, summary: s.summary === 'Searching…' ? 'Search canceled.' : s.summary }])))
}
export function bumpTick($: StateHost): Promise<number> {
  return update($, tick, (n) => (n + 1) % 1_000_000)
}

/**
 * Writes the opening tab once per session; a pane state already written is
 * kept. True when this is a fresh session (nothing was written before).
 */
export async function initPane($: StateHost, tab: Tab): Promise<boolean> {
  const held = await $.state.get({ plugin: 'jei', key: 'pane' })
  if (held.version !== 0) return false
  await update($, pane, () => initialPane(tab))
  return true
}

/** A core GitSnapshot as JSON state: the count Maps become records. */
export function gitState(snap: GitSnapshot): JeiGit {
  if (snap.root === null) return { root: null }
  return {
    root: snap.root,
    status: snap.status,
    numstat: Object.fromEntries(snap.numstat),
    staged: Object.fromEntries(snap.staged),
    hooks: snap.hooks,
  }
}

// The contract is self-contained, so it repeats core's shapes. These fail to
// compile the moment either side drifts.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const drift: [
  Same<JeiPane, PaneState>,
  Same<JeiTab, Tab>,
  Same<JeiView, View>,
  Same<Extract<JeiGit, { root: string }>['status']['entries'][number], StatusEntry>,
  Same<JeiActivity[string]['kind'], ActivityKind>,
  Same<JeiCommitMode, CommitMode>,
  Same<JeiSearch['matches'][number], Match>,
  Same<JeiSearch['plan'][number], ReplaceFile>,
  Same<JeiSearch['skipped'][number], Skipped>,
] = [true, true, true, true, true, true, true, true, true]
void drift
