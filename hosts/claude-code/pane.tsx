import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import { hintLine, KEYS, type Tab, type View } from '../../core/keys.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { toPosix } from '../../core/shared/paths.ts'
import { fitEnd } from '../../core/shared/fit.ts'
import { tabBar, TAB_NAMES } from '../../core/shared/tabs.ts'
import { renderFiles, type FilesAction } from './files.tsx'
import { readCwd, readPane, updatePane } from './state.ts'

export type PaneRender = RenderInput<'Pane'>

/** Cells a terminal Button draws around its label: `[ ` and ` ]`. */
const BUTTON_CHROME = 4

export const LATER = 'Coming in a later version.'

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

const SEP = ' · '
type HintItem = { keyText: string; label: string; run?: () => void }

/**
 * The hint line of a view whose letter keys are Buttons: on this host a key
 * reaches a pane only through a Button's `hotkey`, drawn plain as `a: label`
 * (`a: ` bare, counted as 3 cells). Items keep core's priority order; Esc is the host's own (it
 * returns to the prompt), so it is not listed. The longest labelled prefix
 * that fits is shown, the rest bare; below 32 columns every item is bare,
 * and items that still do not fit drop from the end.
 */
export function hintItems(view: View, width: number, actions: readonly FilesAction[]): { items: HintItem[]; labelled: number } {
  const all: HintItem[] = []
  for (const k of KEYS[view]) {
    if (k.key === 'esc') continue
    const keyText = k.key === 'up' || k.key === 'down' ? '↑↓' : k.key
    if (all.some((i) => i.keyText === keyText)) continue
    if (/^[a-z0-9]$/.test(k.key)) {
      const action = actions.find((a) => a.key === k.key)
      if (action) all.push({ keyText, label: k.label, run: action.run })
    } else all.push({ keyText, label: k.label })
  }
  const cost = (i: HintItem, labelled: boolean) =>
    (i.run ? i.keyText.length + 2 : i.keyText.length) + (labelled ? 1 + i.label.length : 0)
  const total = (items: HintItem[], k: number) =>
    items.reduce((sum, item, idx) => sum + cost(item, idx < k) + (idx === 0 ? 0 : idx < k ? SEP.length : 1), 0)
  for (let k = width >= 32 ? all.length : 0; k >= 0; k--) {
    if (total(all, k) <= width) return { items: all, labelled: k }
  }
  const items = [...all]
  while (items.length > 0 && total(items, 0) > width) items.pop()
  return { items, labelled: 0 }
}

/**
 * The JEI pane: tab bar, rule, header row, body and hint line, sized to
 * `e.props.bodyColumns` on every draw. Reads state, never writes it.
 */
export async function renderPane($: EngineInterface, e: PaneRender, options: Options): Promise<RenderElement> {
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
  const bar = tabBar(columns, room, state.tab, BUTTON_CHROME)

  const showHint = rows >= 10
  const showRule = rows >= 8
  const showHeader = rows >= 6
  const showBar = rows >= 3

  const pinned = (showBar ? 1 : 0) + (showRule ? 1 : 0) + (showHeader ? 1 : 0) + (showHint ? 1 : 0)
  const files =
    view === 'files' || view === 'files.preview'
      ? await renderFiles($, e, { columns, inner, bodyRows: Math.max(1, rows - pinned), isFocused: e.props.isFocused }, options)
      : null

  const hintRow = (): RenderElement => {
    if (files === null) {
      return (
        <Text dimColor wrap="truncate-end">
          {row(hintLine(view, inner))}
        </Text>
      )
    }
    const { items, labelled } = hintItems(view, inner, files.actions)
    return (
      <Box flexDirection="row">
        <Text dimColor>{inner > 0 ? ' ' : ''}</Text>
        {items.flatMap((item, i) => {
          const sep = i === 0 ? [] : [<Text dimColor>{i < labelled ? SEP : ' '}</Text>]
          const shown = i < labelled ? item.label : ''
          const el = item.run ? (
            <Button key={`key-${item.keyText}`} plain dimColor hotkey={item.keyText} label={shown} onPress={item.run} />
          ) : (
            <Text dimColor>{shown ? `${item.keyText} ${shown}` : item.keyText}</Text>
          )
          return [...sep, el]
        })}
      </Box>
    )
  }

  const select = (tab: Tab) => () => {
    void updatePane($, (s) => reducePane(s, { type: 'tab', tab })).catch((err: unknown) => {
      $.ui.log(`jei: tab switch failed: ${err instanceof Error ? err.message : String(err)}`)
    })
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
        <Box key="header">{files ? files.header : <Text wrap="truncate-end">{row(headerOf(view, root))}</Text>}</Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {files
          ? files.body
          : bodyOf(view).map((text, i) => (
              <Box key={`body-${i}`}>
                <Text dimColor wrap="truncate-end">
                  {row(text)}
                </Text>
              </Box>
            ))}
      </Box>
      {showHint && <Box key="hint">{hintRow()}</Box>}
    </Box>
  )
}
