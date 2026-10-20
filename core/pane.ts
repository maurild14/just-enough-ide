import type { Tab, View } from './keys.ts'

export type DiffSource =
  | { kind: 'working'; staged: boolean; untracked: boolean }
  | { kind: 'commit'; hash: string }
  | { kind: 'compare'; base: string; head: string }

export type PaneState = {
  tab: Tab
  stack: View[]
  selected: Partial<Record<View, string>>
  diff?: { source: DiffSource; path: string }
}

type LegacyPaneState = Omit<PaneState, 'diff'> & { diff: { path: string; staged: boolean; untracked: boolean } }

/** Session state survives plugin reloads, including v0.1's working-diff shape. */
export function normalizePane(state: PaneState | LegacyPaneState): PaneState {
  const diff = state.diff
  if (diff && !('source' in diff)) {
    return { ...state, diff: { path: diff.path, source: { kind: 'working', staged: diff.staged, untracked: diff.untracked } } }
  }
  return state as PaneState
}

export type PaneAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'open-diff'; source: DiffSource; path: string }
  | { type: 'branches' }
  | { type: 'compare' }
  | { type: 'preview'; rel: string }
  | { type: 'back' }
  | { type: 'select'; view: View; id: string }

export function initialPane(tab: Tab): PaneState {
  return { tab, stack: [tab], selected: {} }
}

export function currentView(s: PaneState): View {
  return s.stack[s.stack.length - 1] ?? s.tab
}

/** Stack with `view` on top of `tab`'s root: keeps the current stack on the same tab, resets it otherwise, and never duplicates the top. */
function push(s: PaneState, tab: Tab, view: View): View[] {
  const base = s.tab === tab ? s.stack : [tab]
  return base[base.length - 1] === view ? base : [...base, view]
}

/** Pure reducer. Switching tabs resets the stack but keeps every `selected` entry. */
export function reducePane(s: PaneState, a: PaneAction): PaneState {
  switch (a.type) {
    case 'tab':
      return { tab: a.tab, stack: [a.tab], selected: s.selected }
    case 'select':
      return { ...s, selected: { ...s.selected, [a.view]: a.id } }
    case 'preview':
      return {
        tab: 'files',
        stack: push(s, 'files', 'files.preview'),
        selected: { ...s.selected, files: a.rel },
      }
    case 'open-diff':
      return {
        tab: 'git',
        stack: push(s, 'git', 'git.diff'),
        selected: s.selected,
        diff: { path: a.path, source: a.source },
      }
    case 'branches':
      return { tab: 'git', stack: push(s, 'git', 'git.branches'), selected: s.selected }
    case 'compare':
      return { tab: 'git', stack: push(s, 'git', 'git.compare'), selected: s.selected }
    case 'back': {
      if (s.stack.length <= 1) return s
      const stack = s.stack.slice(0, -1)
      const next: PaneState = { tab: s.tab, stack, selected: s.selected }
      if (s.diff && stack.includes('git.diff')) next.diff = s.diff
      return next
    }
  }
}
