// Claude Code contract for JEI: the session state the pane draws from
// ($.state, plugin 'jei'). Self-contained: no imports. The shapes mirror
// core's types (core/pane.ts, core/host.ts, core/git/*); the Claude Code
// adapter checks at compile time that they stay identical
// (hosts/claude-code/state.ts). Every value is JSON data.

export type JeiTab = 'files' | 'search' | 'symbols' | 'git'
export type JeiView = 'files' | 'files.preview' | 'search' | 'symbols' | 'git' | 'git.diff'

/** core/pane.ts PaneState. */
export type JeiPane = {
  tab: JeiTab
  stack: JeiView[]
  selected: Partial<Record<JeiView, string>>
  diff?: { path: string; staged: boolean; untracked: boolean }
}

/** core/activity/log.ts ActivityLog JSON: rel path to its latest touch. */
export type JeiActivity = Record<string, { kind: 'read' | 'write' | 'git'; at: number }>

/** core/host.ts DirEntry. */
export type JeiDirEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number }

/** The Files tab's tree: listings keyed by folder rel ('' is the root). */
export type JeiTree = {
  expanded: string[]
  listings: Record<string, JeiDirEntry[]>
  ignored: string[]
  showHidden: boolean
  filter: string
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

declare module 'claude-code' {
  interface PluginState {
    jei: {
      pane: JeiPane
      cwd: string
      activity: JeiActivity
      git: JeiGit | null
      tree: JeiTree
    }
  }
}
