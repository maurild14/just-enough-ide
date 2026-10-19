import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import { hintLine, TAB_KEYS, type Tab, type View } from '../../core/keys.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { toPosix } from '../../core/shared/paths.ts'
import { cellWidth, fitEnd } from '../../core/shared/fit.ts'
import { readCwd, readPane, updatePane } from './state.ts'

export type PaneRender = RenderInput<'Pane'>

export const TAB_NAMES: Readonly<Record<Tab, string>> = {
  files: 'Files',
  search: 'Search',
  symbols: 'Symbols',
  git: 'Git',
}

const DIGITS = Object.keys(TAB_KEYS) as (keyof typeof TAB_KEYS)[]

/** Cells a terminal Button takes around its label: `[ ` and ` ]`. */
const BUTTON_CHROME = 4

export const LATER = 'Coming in a later version.'

export type TabLabel = { digit: string; tab: Tab; label: string }
export type TabBar = { labels: TabLabel[]; gap: number; width: number }

/**
 * Tab labels for a pane width (docs/design.md section 5): every tab named from
 * 60 columns, only the active one from 32, numbers only below. If a form still
 * does not fit `room`, the gap shrinks (2, 1, 0), then the labels do.
 */
export function tabBar(columns: number, room: number, active: Tab): TabBar {
  const named = (t: Tab) => columns >= 60 || (columns >= 32 && t === active)
  const forms: ((t: Tab) => boolean)[] = [named, (t) => columns >= 32 && t === active, () => false]
  let last: TabBar | null = null
  for (const form of forms) {
    const labels = DIGITS.map((digit) => {
      const tab = TAB_KEYS[digit]
      return { digit, tab, label: form(tab) ? `${digit} ${TAB_NAMES[tab]}` : digit }
    })
    const used = labels.reduce((n, l) => n + cellWidth(l.label) + BUTTON_CHROME, 0)
    for (const gap of [2, 1, 0]) {
      last = { labels, gap, width: used + gap * (labels.length - 1) }
      if (last.width <= room) return last
    }
  }
  return last!
}

function rootName(dir: string): string {
  const parts = toPosix(dir).replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || TAB_NAMES.files
}

/** Header text for a view: what the body is about. */
function headerOf(view: View, root: string): string {
  if (view === 'files' || view === 'files.preview') return rootName(root)
  if (view === 'git' || view === 'git.diff') return TAB_NAMES.git
  return TAB_NAMES[view]
}

/** Body rows for a view. Files and Git are filled by their own tabs. */
function bodyOf(view: View): string[] {
  if (view === 'search' || view === 'symbols') return [LATER]
  return []
}

/**
 * The JEI pane: tab bar, rule, header row, body and hint line, sized to
 * `e.props.bodyColumns` on every draw. Reads state, never writes it.
 */
export async function renderPane($: EngineInterface, e: PaneRender): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const state = await readPane($)
  const root = await readCwd($)
  const view = currentView(state)
  const columns = Math.max(0, Math.floor(e.props.bodyColumns))
  const rows = e.props.scroll.bodyRows
  // Column 0 is the gutter and the last column stays empty (design.md section 4).
  const room = Math.max(0, columns - 1)
  const inner = Math.max(0, room - 1)
  const row = (s: string) => (inner > 0 ? ` ${fitEnd(s, inner)}` : '')
  const bar = tabBar(columns, room, state.tab)

  const showHint = rows >= 10
  const showRule = rows >= 8
  const showHeader = rows >= 6
  const showBar = rows >= 3

  const select = (tab: Tab) => () => {
    void updatePane($, (s) => reducePane(s, { type: 'tab', tab }))
  }

  // Text takes no key, so each named row is a keyed Box holding one Text.
  return (
    <Box flexDirection="column" height={e.props.placement === 'dock' ? rows : undefined}>
      {showBar && (
        <Box flexDirection="row" gap={bar.gap}>
          {bar.labels.map((l) => (
            <Button
              key={`tab-${l.digit}`}
              hotkey={l.digit}
              variant={l.tab === state.tab ? 'primary' : 'secondary'}
              onPress={select(l.tab)}
            >
              <Text weight={l.tab === state.tab ? 'bold' : 'regular'}>{l.label}</Text>
            </Button>
          ))}
        </Box>
      )}
      {showRule && (
        <Box key="rule">
          <Text dimColor wrap="truncate-end">
            {'─'.repeat(room)}
          </Text>
        </Box>
      )}
      {showHeader && (
        <Box key="header">
          <Text wrap="truncate-end">{row(headerOf(view, root))}</Text>
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {bodyOf(view).map((text, i) => (
          <Box key={`body-${i}`}>
            <Text dimColor wrap="truncate-end">
              {row(text)}
            </Text>
          </Box>
        ))}
      </Box>
      {showHint && (
        <Box key="hint">
          <Text dimColor wrap="truncate-end">
            {row(hintLine(view, inner))}
          </Text>
        </Box>
      )}
    </Box>
  )
}
