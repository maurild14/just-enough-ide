import type { Color } from 'claude-code'
import type { ActivityKind } from '../../core/activity/classify.ts'
import type { FileStatus } from '../../core/git/status.ts'

/** The semantic color tokens of docs/design.md section 2. */
export type Token =
  | 'fg'
  | 'accent'
  | 'added'
  | 'removed'
  | 'modified'
  | 'untracked'
  | 'conflict'
  | 'warning'
  | 'error'
  | 'activity.read'
  | 'activity.write'
  | 'activity.git'

// The one place tokens meet the host theme: Claude Code theme keys follow the
// person's theme (dark or light). `muted` is Text's `dimColor`, not a color.
const THEME: Readonly<Record<Token, Color>> = {
  fg: 'text',
  accent: 'suggestion',
  added: 'success',
  removed: 'error',
  modified: 'warning',
  untracked: 'success',
  conflict: 'merged',
  warning: 'warning',
  error: 'error',
  'activity.read': 'autoAccept',
  'activity.write': 'claude',
  'activity.git': 'success',
}

export function color(token: Token): Color {
  return THEME[token]
}

export function activityColor(kind: ActivityKind): Color {
  return THEME[`activity.${kind}`]
}

const LETTER: Readonly<Record<FileStatus, string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
  ignored: '',
}

const STATUS_TOKEN: Readonly<Record<FileStatus, Token>> = {
  modified: 'modified',
  added: 'added',
  deleted: 'removed',
  renamed: 'modified',
  untracked: 'untracked',
  conflicted: 'conflict',
  ignored: 'fg',
}

/** Letter and paint for a git status: untracked is dim, conflicts are bold. */
export function statusLook(s: FileStatus): { letter: string; color: Color; dim: boolean; bold: boolean } {
  return { letter: LETTER[s], color: THEME[STATUS_TOKEN[s]], dim: s === 'untracked', bold: s === 'conflicted' }
}
