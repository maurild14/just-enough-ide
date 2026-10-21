// Claude Code contract for JEI: the session state the pane draws from
// ($.state, plugin 'jei'). Self-contained: no imports. The shapes mirror
// core's types (core/pane.ts, core/activity/*, core/git/*); the Claude Code
// adapter checks at compile time that they stay identical
// (hosts/claude-code/state.ts). Every value is JSON data.

export type JeiTab = 'files' | 'search' | 'git'
export type JeiView = 'files' | 'files.preview' | 'search' | 'search.replace' | 'quickopen' | 'git' | 'git.diff' | 'git.branches' | 'git.compare'

export type JeiDiffSource =
  | { kind: 'working'; staged: boolean; untracked: boolean }
  | { kind: 'commit'; hash: string }
  | { kind: 'compare'; base: string; head: string }

/** core/pane.ts PaneState. */
export type JeiPane = {
  /** Adapter publication scope; preserved outside core normalization. */
  filesScope?: { root: string; owner: string | null }
  tab: JeiTab
  stack: JeiView[]
  selected: Partial<Record<JeiView, string>>
  recent: string[]
  preview?: { rel: string; line?: number }
  diff?: { path: string; source: JeiDiffSource }
}

/** core/activity/log.ts ActivityLog JSON: rel path to its latest touch. */
export type JeiActivity = Record<string, { kind: 'read' | 'write' | 'git'; at: number; active?: number }>

/**
 * The Files tab's tree as the person left it. Folder listings are not state:
 * the adapter reads them through a cache refreshed on file events.
 */
export type JeiTree = {
  filesRoot?: string
  revealed?: string
  expanded: string[]
  showHidden: boolean
  /** The filter Input is open (`f`). */
  filtering: boolean
  filter: string
  editing?: boolean
  origin?: string
  operationBusy?: string | null
  operation?: {
    id: string; value: string; working: boolean
    prepared: {
      kind: 'new' | 'rename' | 'move' | 'delete'; source: string; root: string; realRoot: string; parent: string; parentReal: string
      sourceKind: 'file' | 'dir' | null; sourceReal: string | null; sourceSize: number; ancestors: string[]
    }
  } | null
}

/** The Files preview: the file shown, markdown source shown (`m`) and the first line in view. */
export type JeiPreview = { rel: string; source: boolean; top: number; line?: number }

export type JeiSearch = {
  draft?: string
  text: string; caseSensitive: boolean; regex: boolean; wholeWord: boolean; globs: string; replacement: string
  quickText?: string
  subject?: Partial<Record<'search' | 'quickopen' | 'search.replace', string>>
  editing: 'query' | 'globs' | 'replacement' | null
  matches: { rel: string; line: number; text: string; ranges: [number, number][] }[]
  summary: string; engine: 'rg' | 'git grep'; busy: boolean
  plan: { rel: string; before: string; after: string; count: number }[]
  skipped: { rel: string; reason: 'binary' | 'not-utf8' | 'changed' | 'case-differs' | 'regex-differs' | 'outside-root' | 'too-large' | 'unreadable' | 'unsupported-path' }[]
  expanded: string[]; top: number; confirm: string[] | null
}

export type JeiFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'ignored'
export type JeiCounts = Record<string, { added: number | null; removed: number | null }>

/** core/git/service.ts GitSnapshot with its count Maps as records (state is JSON). */
export type JeiGit =
  | {
      root: string
      status: {
        branch: { head: string | null; oid: string | null; upstream: string | null; ahead: number; behind: number }
        entries: { path: string; origPath?: string; index: JeiFileStatus | null; worktree: JeiFileStatus | null }[]
      }
      numstat: JeiCounts
      staged: JeiCounts
      hooks: boolean
    }
  | { root: null }

/** core/git/commands.ts CommitMode: what the Commit button does. */
export type JeiCommitMode = 'commit' | 'commit-push' | 'amend'

/** An inline question in the Git tab, answered by its Buttons. */
export type JeiAsk =
  | { kind: 'discard'; paths: string[]; all: boolean }
  | { kind: 'sensitive'; paths: string[] }
  | { kind: 'divergence' }
  | { kind: 'sync-review'; root: string; pending: string[][]; choice?: 'merge' | 'rebase' }
  | { kind: 'history'; root: string; operation: 'checkout' | 'revert' | 'switch' | 'create'; target: string; start: string | null; confirm: string }

export type JeiHistory = {
  filter: string; draft: string; filtering: boolean; pages: number; expanded: string | null; agents: string[]
  newBranch: { start: string | null; name: string } | null
  branchFilter: string; branchFiltering: boolean
  compared: { base: string; head: string; label: string } | null
}

/**
 * The Git tab as the person left it: the commit message and mode, an open
 * question, the operation running (its label), collapsed groups and the
 * first diff row in view.
 */
export type JeiGitUi = {
  message: string
  mode: JeiCommitMode
  ask: JeiAsk | null
  busy: string | null
  collapsed: string[]
  diffTop: number
}

declare module 'claude-code' {
  interface PluginState {
    jei: {
      pane: JeiPane
      cwd: string
      activity: JeiActivity
      git: JeiGit | null
      tree: JeiTree
      gitUi: JeiGitUi
      history: Record<string, JeiHistory>
      searches: Record<string, JeiSearch>
      preview: JeiPreview
      /** Bumped by the shimmer clock and by refreshed caches: a redraw. */
      tick: number
    }
  }
}
