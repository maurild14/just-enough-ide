import { KEYS, type Tab, type View } from './keys.ts'

export type DiffSource =
  | { kind: 'working'; staged: boolean; untracked: boolean }
  | { kind: 'commit'; hash: string }
  | { kind: 'compare'; base: string; head: string }

export type PaneState = {
  tab: Tab
  stack: View[]
  selected: Partial<Record<View, string>>
  recent: string[]
  preview?: { rel: string; line?: number }
  diff?: { source: DiffSource; path: string }
}

type LegacyPaneState = Omit<PaneState, 'diff' | 'recent'> & { recent?: string[]; diff?: PaneState['diff'] | { path: string; staged: boolean; untracked: boolean } }

/** Session state survives plugin reloads, including v0.1's working-diff shape. */
export function normalizePane(state: PaneState | LegacyPaneState): PaneState {
  const diff = state.diff
  const retained = Array.isArray(state.stack) ? state.stack : []
  const knownViews = retained.every(view => Object.hasOwn(KEYS, view))
  const legacySearch = knownViews && state.tab === 'files' && retained.includes('search')
  const tab = legacySearch ? 'search' : state.tab
  const stack = legacySearch ? retained.slice(retained.indexOf('search')) : retained
  if (!knownViews || !['files', 'search', 'git'].includes(tab) || stack[0] !== tab || stack.some(view => !(view === tab || view === 'files.preview' || tab === 'search' && view === 'quickopen' || view.startsWith(`${tab}.`)))) {
    return { ...initialPane('files'), selected: Object.fromEntries(Object.entries(state.selected).filter(([view]) => Object.hasOwn(KEYS, view))), recent: state.recent ?? [] }
  }
  if (!legacySearch && state.recent !== undefined && (!diff || 'source' in diff)) return state as PaneState
  const base = { ...state, tab, stack, recent: state.recent ?? [] }
  if (diff && !('source' in diff)) {
    return { ...base, recent: state.recent ?? [], diff: { path: diff.path, source: { kind: 'working', staged: diff.staged, untracked: diff.untracked } } }
  }
  return base as PaneState
}

export type PaneAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'open-diff'; source: DiffSource; path: string }
  | { type: 'branches' }
  | { type: 'compare' }
  | { type: 'search' | 'quickopen' | 'replace' }
  | { type: 'preview'; rel: string; line?: number }
  | { type: 'back' }
  | { type: 'select'; view: View; id: string }

export function initialPane(tab: Tab): PaneState {
  return { tab, stack: [tab], selected: {}, recent: [] }
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
      return { ...initialPane(a.tab), selected: s.selected, recent: s.recent }
    case 'select':
      return { ...s, selected: { ...s.selected, [a.view]: a.id } }
    case 'search':
    case 'quickopen':
    case 'replace': {
      const tab = 'search'
      const view = a.type === 'replace' ? 'search.replace' : a.type === 'search' ? 'search' : 'quickopen'
      return { tab, stack: push(s, tab, view), selected: s.selected, recent: s.recent }
    }
    case 'preview':
      return {
        ...s,
        stack: push(s, s.tab, 'files.preview'),
        selected: currentView(s) === 'files' ? { ...s.selected, files: a.rel } : s.selected,
        recent: [a.rel, ...s.recent.filter((rel) => rel !== a.rel)].slice(0, 50),
        preview: { rel: a.rel, ...(a.line === undefined ? {} : { line: a.line }) },
      }
    case 'open-diff':
      return {
        tab: 'git',
        stack: push(s, 'git', 'git.diff'),
        selected: s.selected,
        recent: s.recent,
        diff: { path: a.path, source: a.source },
      }
    case 'branches':
      return { tab: 'git', stack: push(s, 'git', 'git.branches'), selected: s.selected, recent: s.recent }
    case 'compare':
      return { tab: 'git', stack: push(s, 'git', 'git.compare'), selected: s.selected, recent: s.recent }
    case 'back': {
      if (s.stack.length <= 1) return s.tab === 'search' ? { ...initialPane('files'), selected: s.selected, recent: s.recent } : s
      const stack = s.stack.slice(0, -1)
      const next: PaneState = { tab: s.tab, stack, selected: s.selected, recent: s.recent }
      if (s.diff && stack.includes('git.diff')) next.diff = s.diff
      if (s.preview && stack.includes('files.preview')) next.preview = s.preview
      return next
    }
  }
}
