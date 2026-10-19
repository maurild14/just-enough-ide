export type Tab = 'files' | 'search' | 'symbols' | 'git'
export type View = 'files' | 'files.preview' | 'search' | 'symbols' | 'git' | 'git.diff'
export type Key = { key: string; action: string; label: string }

const up: Key = { key: 'up', action: 'move-up', label: 'move' }
const down: Key = { key: 'down', action: 'move-down', label: 'move' }
const scrollUp: Key = { key: 'up', action: 'scroll-up', label: 'scroll' }
const scrollDown: Key = { key: 'down', action: 'scroll-down', label: 'scroll' }
const back: Key = { key: 'esc', action: 'back', label: 'back' }

// Order is priority: the hint line drops items from the end first.
// Search and Symbols only carry navigation until their milestones (0.3, 0.4).
export const KEYS: Readonly<Record<View, readonly Key[]>> = {
  files: [
    up,
    down,
    { key: 'enter', action: 'activate', label: 'open' },
    { key: 'a', action: 'mention', label: 'mention' },
    { key: 'o', action: 'open-editor', label: 'open in editor' },
    { key: 'f', action: 'filter', label: 'filter' },
    { key: 'h', action: 'toggle-hidden', label: 'hidden' },
    back,
  ],
  'files.preview': [
    scrollUp,
    scrollDown,
    { key: 'a', action: 'mention', label: 'mention' },
    { key: 'o', action: 'open-editor', label: 'open in editor' },
    { key: 'm', action: 'toggle-markdown-source', label: 'source' },
    back,
  ],
  search: [up, down, { key: 'enter', action: 'activate', label: 'open' }, back],
  symbols: [up, down, { key: 'enter', action: 'activate', label: 'open' }, back],
  git: [
    up,
    down,
    { key: 'enter', action: 'activate', label: 'open' },
    { key: 's', action: 'stage', label: 'stage' },
    { key: 'u', action: 'unstage', label: 'unstage' },
    { key: 'd', action: 'discard', label: 'discard' },
    { key: 'c', action: 'commit', label: 'commit' },
    { key: 'g', action: 'generate-message', label: 'generate' },
    { key: 'e', action: 'sync', label: 'sync' },
    back,
  ],
  'git.diff': [
    scrollUp,
    scrollDown,
    { key: 'n', action: 'next-hunk', label: 'next hunk' },
    { key: 'p', action: 'prev-hunk', label: 'prev hunk' },
    { key: 'j', action: 'next-file', label: 'next file' },
    { key: 'k', action: 'prev-file', label: 'prev file' },
    { key: 'a', action: 'ask-review', label: 'ask' },
    { key: 'o', action: 'open-editor', label: 'open in editor' },
    back,
  ],
}

export const TAB_KEYS: Readonly<Record<'1' | '2' | '3' | '4', Tab>> = {
  '1': 'files',
  '2': 'search',
  '3': 'symbols',
  '4': 'git',
}

const SEP = ' · '

/**
 * One line of `key label` pairs for a view. Works at any width >= 1: below 32
 * columns only keys are shown, lowest-priority items drop first, and the result
 * never exceeds `columns`.
 */
export function hintLine(view: View, columns: number): string {
  const width = Math.max(0, Math.floor(columns))
  const items: { keyText: string; label: string }[] = []
  for (const k of KEYS[view]) {
    const keyText = k.key === 'up' || k.key === 'down' ? '↑↓' : k.key
    if (keyText === '↑↓' && items.some((i) => i.keyText === '↑↓')) continue
    items.push({ keyText, label: k.label })
  }
  const keysOnly = width < 32
  const parts = items.map((i) => (keysOnly ? i.keyText : `${i.keyText} ${i.label}`))
  const sep = keysOnly ? ' ' : SEP
  while (parts.length > 1 && parts.join(sep).length > width) parts.pop()
  return parts.join(sep).slice(0, width)
}
