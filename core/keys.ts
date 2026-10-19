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
 * One line of `key label` pairs for a view. Works at any width: below 32
 * columns only keys are shown. Items are kept in priority order; one that does
 * not fit is skipped so shorter, lower-priority ones can still fit. `esc` is
 * reserved first because it is the way out. Words are never cut: when nothing
 * fits the result is ''. The result never exceeds `columns`.
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
  const sep = keysOnly ? ' ' : SEP
  const text = items.map((i) => (keysOnly ? i.keyText : `${i.keyText} ${i.label}`))
  const keep = new Set<number>()
  let used = 0
  const tryAdd = (idx: number) => {
    const cost = text[idx]!.length + (keep.size > 0 ? sep.length : 0)
    if (used + cost > width) return
    keep.add(idx)
    used += cost
  }
  const escIdx = items.findIndex((i) => i.keyText === 'esc')
  if (escIdx >= 0) tryAdd(escIdx)
  for (let i = 0; i < items.length; i++) if (i !== escIdx) tryAdd(i)
  return text.filter((_, i) => keep.has(i)).join(sep)
}
