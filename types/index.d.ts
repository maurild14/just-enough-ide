// Claude Code contract for JEI: the session state the pane draws from
// ($.state, plugin 'jei'). Self-contained: no imports. The shapes mirror
// core's types (core/pane.ts, core/activity/*, core/git/*); the Claude Code
// adapter checks at compile time that they stay identical
// (hosts/claude-code/state.ts). Every value is JSON data.

export type JeiTab = 'files' | 'search' | 'symbols' | 'git'
export type JeiView = 'files' | 'files.preview' | 'search' | 'symbols' | 'git' | 'git.diff' | 'git.branches'

export type JeiDiffSource =
  | { kind: 'working'; staged: boolean; untracked: boolean }
  | { kind: 'commit'; hash: string }
  | { kind: 'compare'; base: string; head: string }

/** core/pane.ts PaneState. */
export type JeiPane = {
  tab: JeiTab
  stack: JeiView[]
  selected: Partial<Record<JeiView, string>>
  diff?: { path: string; source: JeiDiffSource }
}

/** core/activity/log.ts ActivityLog JSON: rel path to its latest touch. */
export type JeiActivity = Record<string, { kind: 'read' | 'write' | 'git'; at: number }>

/**
 * The Files tab's tree as the person left it. Folder listings are not state:
 * the adapter reads them through a cache refreshed on file events.
 */
export type JeiTree = {
  expanded: string[]
  showHidden: boolean
  /** The filter Input is open (`f`). */
  filtering: boolean
  filter: string
}

/** The Files preview: the file shown, markdown source shown (`m`) and the first line in view. */
export type JeiPreview = { rel: string; source: boolean; top: number }

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
      preview: JeiPreview
      /** Bumped by the shimmer clock and by refreshed caches: a redraw. */
      tick: number
    }
  }
}
