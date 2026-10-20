export type Tab = 'files' | 'search' | 'symbols' | 'git'
export type View = 'files' | 'files.preview' | 'search' | 'symbols' | 'git' | 'git.diff' | 'git.branches'
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
    { key: 'y', action: 'copy-hash', label: 'copy hash' },
    { key: 'a', action: 'ask', label: 'ask' },
    { key: 'b', action: 'branches', label: 'branches' },
    { key: 'f', action: 'filter', label: 'filter' },
    { key: 't', action: 'fetch', label: 'fetch' },
    { key: 'n', action: 'new-branch', label: 'new branch' },
    { key: 'g', action: 'generate-message', label: 'generate' },
    { key: 'e', action: 'sync', label: 'sync' },
    back,
  ],
  'git.branches': [
    up, down,
    { key: 'enter', action: 'switch', label: 'switch' },
    { key: 'n', action: 'new-branch', label: 'new' },
    { key: 'c', action: 'compare', label: 'compare' },
    { key: 'f', action: 'filter', label: 'filter' },
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
 * One line of hints for a view, at any width; the result never exceeds `columns`
 * and a word is never cut. Items are in priority order and `esc` (the way out)
 * is always kept when it fits. The longest priority prefix that fits is shown
 * with labels (`s stage`, joined by ` · `); the items that still fit after it
 * are appended as bare keys (`u d c`), skipping any that do not fit. Below 32
 * columns everything is bare. The number of keys shown never drops as width
 * grows: a labelled prefix is only used when it costs no keys.
 */
export function hintLine(view: View, columns: number): string {
  const width = Math.max(0, Math.floor(columns))
  const items: { keyText: string; label: string }[] = []
  for (const k of KEYS[view]) {
    const keyText = k.key === 'up' || k.key === 'down' ? '↑↓' : k.key
    if (keyText === '↑↓' && items.some((i) => i.keyText === '↑↓')) continue
    items.push({ keyText, label: k.label })
  }
  const n = items.length
  const escIdx = items.findIndex((i) => i.keyText === 'esc')
  const labelled = items.map((i) => `${i.keyText} ${i.label}`)
  const bareLen = (i: number) => items[i]!.keyText.length + 1 // with its separator space

  // Most bare keys from `idx` that fit in `budget` columns (shortest first).
  const maxFit = (idx: number[], budget: number): number => {
    let count = 0
    let left = budget
    for (const len of idx.map(bareLen).sort((x, y) => x - y)) {
      if (len > left) break
      left -= len
      count++
    }
    return count
  }

  // Items [0, k) labelled, the rest bare. Null when the labelled prefix does not fit.
  const layout = (k: number): { text: string; count: number } | null => {
    if (k === n) {
      const text = labelled.join(SEP)
      return text.length <= width ? { text, count: n } : null
    }
    const head = labelled.slice(0, k).join(SEP)
    if (head.length > width) return null
    const budget = width - (head ? head.length + SEP.length : 0) + 1 // +1: no trailing space
    const keepEsc = escIdx >= k && bareLen(escIdx) <= budget
    let left = budget - (keepEsc ? bareLen(escIdx) : 0)
    const rest: number[] = []
    for (let i = k; i < n; i++) if (i !== escIdx) rest.push(i)
    let need = maxFit(rest, left)
    const chosen: number[] = []
    rest.forEach((i, pos) => {
      if (need === 0 || bareLen(i) > left) return
      // take it only if the target count is still reachable afterwards
      if (1 + maxFit(rest.slice(pos + 1), left - bareLen(i)) >= need) {
        chosen.push(i)
        left -= bareLen(i)
        need--
      }
    })
    const shown = keepEsc ? [...chosen, escIdx] : chosen
    const bare = shown.map((i) => items[i]!.keyText).join(' ')
    return { text: head && bare ? head + SEP + bare : head + bare, count: k + shown.length }
  }

  const options: { text: string; count: number }[] = []
  for (let k = 0; k <= (width >= 32 ? n : 0); k++) {
    const r = layout(k)
    if (r) options.push(r)
  }
  const best = Math.max(...options.map((o) => o.count))
  return options.filter((o) => o.count === best).pop()?.text ?? ''
}
