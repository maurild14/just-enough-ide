import { TAB_KEYS, type Tab } from '../keys.ts'
import { cellWidth } from './fit.ts'

export const TAB_NAMES: Readonly<Record<Tab, string>> = {
  files: 'Files',
  symbols: 'Symbols',
  git: 'Git',
}

const DIGITS = Object.keys(TAB_KEYS) as (keyof typeof TAB_KEYS)[]

export type TabLabel = { digit: string; tab: Tab; label: string }
export type TabBar = { labels: TabLabel[]; gap: number; width: number }

/**
 * Tab labels for a pane width (docs/design.md section 5): every tab named from
 * 60 columns, only the active one from 32, numbers only below. `chrome` is the
 * cells a host draws around each label (Claude Code's `[ ` and ` ]` is 4). If a
 * form still does not fit `room`, the gap shrinks (2, 1, 0), then the labels do;
 * the last, narrowest form is returned even when nothing fits.
 */
export function tabBar(columns: number, room: number, active: Tab, chrome = 0): TabBar {
  const forms: ((t: Tab) => boolean)[] = [
    (t) => columns >= 60 || (columns >= 32 && t === active),
    (t) => columns >= 32 && t === active,
    () => false,
  ]
  let last: TabBar = { labels: [], gap: 0, width: 0 }
  for (const form of forms) {
    const labels = DIGITS.map((digit) => {
      const tab = TAB_KEYS[digit]
      return { digit, tab, label: form(tab) ? `${digit} ${TAB_NAMES[tab]}` : digit }
    })
    const used = labels.reduce((n, l) => n + cellWidth(l.label) + chrome, 0)
    for (const gap of [2, 1, 0]) {
      last = { labels, gap, width: used + gap * (labels.length - 1) }
      if (last.width <= room) return last
    }
  }
  return last
}
