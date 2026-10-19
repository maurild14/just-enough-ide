import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { DirEntry } from '../../core/host.ts'
import type { Tab, View } from '../../core/keys.ts'
import { initialPane, type PaneState } from '../../core/pane.ts'
import type { ActivityKind } from '../../core/activity/classify.ts'
import type { GitSnapshot } from '../../core/git/service.ts'
import type { JeiActivity, JeiDirEntry, JeiGit, JeiPane, JeiTab, JeiTree, JeiView } from '../../types/index.d.ts'

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
  listings: {},
  ignored: [],
  showHidden: false,
  filter: '',
} satisfies JeiTree)

type StateHost = Pick<EngineInterface, 'state'>

// Function declarations, not arrows: the validator follows `$` across an
// import only into a declaration.
export function readPane($: StateHost): Promise<PaneState> {
  return read($, pane)
}
export function readCwd($: StateHost): Promise<string> {
  return read($, cwd)
}
export function updatePane($: StateHost, fn: (s: PaneState) => PaneState): Promise<PaneState> {
  return update($, pane, fn)
}
export function updateTree($: StateHost, fn: (t: JeiTree) => JeiTree): Promise<JeiTree> {
  return update($, tree, fn)
}
export function setCwd($: StateHost, dir: string): Promise<string> {
  return update($, cwd, () => dir)
}

/** Writes the opening tab once per session; a pane state already written is kept. */
export async function initPane($: StateHost, tab: Tab): Promise<void> {
  const held = await $.state.get({ plugin: 'jei', key: 'pane' })
  if (held.version === 0) await update($, pane, () => initialPane(tab))
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
  Same<JeiDirEntry, DirEntry>,
  Same<JeiActivity[string]['kind'], ActivityKind>,
] = [true, true, true, true, true]
void drift
