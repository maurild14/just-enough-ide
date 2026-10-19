import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import { fitHint, hintLine, KEYS, type Tab, type View } from '../../core/keys.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { toPosix } from '../../core/shared/paths.ts'
import { cellWidth, fitEnd } from '../../core/shared/fit.ts'
import { tabBar, TAB_NAMES } from '../../core/shared/tabs.ts'
import { renderDiff } from './diff.tsx'
import { renderFiles, type FilesAction } from './files.tsx'
import { renderGit } from './git.tsx'
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
 * (`a: ` bare, 3 cells). Items keep core's priority order; Esc is the host's
 * own (docs/decisions/0009), so it is not listed. `fitHint` picks the labelled
 * prefix; `bareOnly` keeps every key on a short pane.
 */
export function hintItems(
  view: View,
  width: number,
  actions: readonly FilesAction[],
  bareOnly = false,
): { items: HintItem[]; labelled: number } {
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
  // A bare Button draws `k: `: its trailing space is the gap to the next item, so it costs
  // the key plus 1 and the fit runs 1 cell short (the last item's trailing space).
  const fitOf = (list: HintItem[]) => {
    const costs = list.map((i) => {
      const key = cellWidth(i.keyText)
      return i.run ? { bare: key + 1, labelled: key + 2 + cellWidth(i.label) } : { bare: key, labelled: key + 1 + cellWidth(i.label) }
    })
    return fitHint(costs, Math.max(0, width - 1), bareOnly)
  }
  const fit = fitOf(all)
  if (fit.count < all.length) {
    // Too narrow for every key: the letter keys stay (they are the only way to press them), the
    // navigation words (arrows, enter) go first.
    const keys = all.filter((i) => i.run)
    const kfit = fitOf(keys)
    if (kfit.count > all.slice(0, fit.count).filter((i) => i.run).length) return { items: keys.slice(0, kfit.count), labelled: kfit.labelled }
  }
  return { items: all.slice(0, fit.count), labelled: fit.labelled }
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

  const isFiles = view === 'files' || view === 'files.preview'
  const isGit = view === 'git' || view === 'git.diff'
  // Letter keys live on the hint's Buttons, so a view with letter actions keeps
  // its hint (bare below 10 rows) down to 3 rows (docs/design.md section 6).
  const showHint = isFiles || isGit ? rows >= 3 : rows >= 10
  const bareHint = rows < 10
  const showRule = rows >= 8
  const showHeader = rows >= 6
  const showBar = rows >= 3

  const pinned = (showBar ? 1 : 0) + (showRule ? 1 : 0) + (showHeader ? 1 : 0) + (showHint ? 1 : 0)
  const frame = { columns, inner, bodyRows: Math.max(1, rows - pinned), isFocused: e.props.isFocused }
  // Tabs that draw their own header, body and letter actions.
  const content = isFiles
    ? await renderFiles($, e, frame, options)
    : view === 'git'
      ? await renderGit($, e, frame, options)
      : view === 'git.diff'
        ? await renderDiff($, e, frame, options)
        : null

  const hintRow = (): RenderElement => {
    if (content === null) {
      return (
        <Text dimColor wrap="truncate-end">
          {row(hintLine(view, inner))}
        </Text>
      )
    }
    const { items, labelled } = hintItems(view, inner, content.actions, bareHint)
    return (
      <Box flexDirection="row">
        <Text dimColor>{inner > 0 ? ' ' : ''}</Text>
        {items.flatMap((item, i) => {
          // A bare Button ends in its own space, so a bare item after it needs no gap.
          const prevBare = i > 0 && i - 1 >= labelled && items[i - 1]!.run !== undefined
          const sep = i === 0 || (prevBare && i >= labelled) ? [] : [<Text dimColor>{i < labelled ? SEP : ' '}</Text>]
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
        <Box key="header">{content ? content.header : <Text wrap="truncate-end">{row(headerOf(view, root))}</Text>}</Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {content
          ? content.body
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
