import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import { hintLine, KEYS, type Tab, type View } from '../../core/keys.ts'
import type { Options } from '../../core/options.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { toPosix } from '../../core/shared/paths.ts'
import { cellWidth, fitEnd } from '../../core/shared/fit.ts'
import { tabBar, TAB_NAMES } from '../../core/shared/tabs.ts'
import { renderDiff } from './diff.tsx'
import { renderFiles, type FilesAction } from './files.tsx'
import { renderGit } from './git.tsx'
import { renderBranches } from './branches.tsx'
import { readCwd, readPane, updatePane } from './state.ts'
import { backContext, goBack } from './navigation.ts'
import { renderSearch, stopSearch } from './search.tsx'
import { enterSymbols, renderSymbols, stopSymbols } from './symbols.tsx'

export type PaneRender = RenderInput<'Pane'>

/** Cells a terminal Button draws around its label: `[ ` and ` ]`. */
const BUTTON_CHROME = 4

function rootName(dir: string): string {
  const parts = toPosix(dir).replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || TAB_NAMES.files
}

/** Header text for a view: what the body is about. */
function headerOf(view: View, root: string): string {
  if (view === 'files' || view === 'files.preview') return rootName(root)
  if (view === 'git' || view === 'git.diff' || view === 'git.branches' || view === 'git.compare') return TAB_NAMES.git
  return view === 'quickopen' || view.startsWith('search') ? TAB_NAMES.search : TAB_NAMES.symbols
}

const SEP = ' · '
type HintItem = { keyText: string; label: string; run?: () => void }
/**
 * How a hint item is drawn: `label` (`↑↓ move`, a letter key's plain Button
 * `s: stage`), `bare` (a navigation word's key alone), `chip` (a letter key's
 * Button `[ s ]`, its hotkey not drawn) or `strip` (a plain Button with no
 * label, `s: `). `sep` is the text drawn before it.
 */
export type HintPart = HintItem & { form: 'label' | 'bare' | 'chip' | 'strip'; sep: string }

/** Cells a part draws, its separator included. A labelless plain Button draws `k: `. */
function partWidth(p: HintPart): number {
  const key = cellWidth(p.keyText)
  const body =
    p.form === 'label' ? key + (p.run ? 2 : 1) + cellWidth(p.label) : p.form === 'chip' ? key + BUTTON_CHROME : p.form === 'strip' ? key + 2 : key
  return cellWidth(p.sep) + body
}

/**
 * The hint line of a view whose letter keys are Buttons: on this host a key
 * reaches a pane only through a Button's `hotkey`, and a plain one always
 * draws `k: ` before its label, so a letter key is never shown as `k: ` with
 * nothing after it while anything else fits (docs/design.md section 5). The
 * first form that fits `width` wins: every label; the navigation words bare;
 * no navigation words; the longest labelled prefix of letter keys and the
 * rest as keycaps `[ c ]` after ` · `; keycaps only (spaced, then tight); a
 * strip of labelless keys `s: u: `; then that strip cut from the end. Every
 * letter key shows in all but the last, so the count never drops as width
 * grows. Esc is the host's own (docs/decisions/0009), so it is not listed.
 * `bareOnly` (a short pane) starts at the keycaps.
 */
export function hintItems(view: View, width: number, actions: readonly FilesAction[], bareOnly = false): HintPart[] {
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
  const nav = all.filter((i) => !i.run)
  const keys = all.filter((i) => i.run)
  const as = (list: HintItem[], form: HintPart['form'], sep: string): HintPart[] => list.map((i, n) => ({ ...i, form, sep: n === 0 ? '' : sep }))
  const join = (...groups: HintPart[][]): HintPart[] =>
    groups.filter((g) => g.length > 0).flatMap((g, n) => (n === 0 ? g : [{ ...g[0]!, sep: SEP }, ...g.slice(1)]))

  const forms: HintPart[][] = []
  if (!bareOnly) {
    forms.push(join(as(nav, 'label', SEP), as(keys, 'label', SEP)))
    forms.push(join(as(nav, 'bare', ' '), as(keys, 'label', SEP)))
    // k = 0 would be every key as a chip: the keycaps form pushed next.
    for (let k = keys.length; k >= 1; k--) forms.push(join(as(keys.slice(0, k), 'label', SEP), as(keys.slice(k), 'chip', ' ')))
  }
  forms.push(as(keys, 'chip', ' '), as(keys, 'chip', ''))
  const last = keys.length > 0 ? as(keys, 'strip', '') : as(nav, 'bare', ' ')
  for (let n = last.length; n >= 0; n--) forms.push(last.slice(0, n))
  const fits = (parts: HintPart[]) => parts.reduce((sum, p) => sum + partWidth(p), 0) <= width
  return forms.find((f) => f.length > 0 && fits(f)) ?? []
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
  const back = await backContext($)
  const columns = Math.max(0, Math.floor(e.props.bodyColumns))
  const rows = e.props.scroll.bodyRows
  // Column 0 is the gutter and the last column stays empty (design.md section 4).
  const room = Math.max(0, columns - 1)
  const inner = Math.max(0, room - 1)
  const row = (s: string) => (inner > 0 ? ` ${fitEnd(s, inner)}` : '')
  const bar = tabBar(columns, room, state.tab, BUTTON_CHROME)

  const isFiles = view === 'files' || view === 'files.preview'
  const isGit = state.tab === 'git'
  // Letter keys live on the hint's Buttons, so a view with letter actions keeps
  // its hint (bare below 10 rows) down to 3 rows (docs/design.md section 6).
  const showHint = rows >= 3
  const bareHint = rows < 10
  const showRule = rows >= 8
  const showHeader = rows >= 6
  const showBar = rows >= 3
  const compactEditor = view === 'search' || view === 'quickopen' || view === 'symbols' || view === 'symbols.results'
  const showBack = back.active && !back.inline && rows >= 4 && !(compactEditor && rows <= 5 && back.editing)

  const pinned = (showBar ? 1 : 0) + (showRule ? 1 : 0) + (showHeader ? 1 : 0) + (showHint ? 1 : 0) + (showBack ? 1 : 0)
  const frame = { columns, inner, bodyRows: Math.max(0, rows - pinned), isFocused: e.props.isFocused }
  // Tabs that draw their own header, body and letter actions.
  const content = isFiles
    ? await renderFiles($, e, frame, options)
    : view === 'git'
      ? await renderGit($, e, frame, options)
      : view === 'git.diff'
        ? await renderDiff($, e, frame, options)
        : view === 'git.branches' || view === 'git.compare' ? await renderBranches($, e, frame)
          : view === 'search' || view === 'quickopen' || view === 'search.replace' ? await renderSearch($, e, frame)
            : view === 'symbols' || view === 'symbols.results' ? await renderSymbols($, e, frame) : null

  const hintRow = (): RenderElement => {
    if (content === null) {
      return (
        <Text dimColor wrap="truncate-end">
          {row(hintLine(view, inner))}
        </Text>
      )
    }
    const parts = hintItems(view, inner, content.actions, bareHint)
    return (
      <Box flexDirection="row">
        <Text dimColor>{inner > 0 ? ' ' : ''}</Text>
        {parts.flatMap((p) => {
          const el = !p.run ? (
            <Text dimColor>{p.form === 'label' ? `${p.keyText} ${p.label}` : p.keyText}</Text>
          ) : p.form === 'chip' ? (
            <Button key={`key-${p.keyText}`} dimColor hotkey={p.keyText} label={p.keyText} onPress={p.run} />
          ) : (
            <Button key={`key-${p.keyText}`} plain dimColor hotkey={p.keyText} label={p.form === 'label' ? p.label : ''} onPress={p.run} />
          )
          return p.sep ? [<Text dimColor>{p.sep}</Text>, el] : [el]
        })}
      </Box>
    )
  }

  const select = (tab: Tab) => () => {
    void (async () => { await stopSearch($); await stopSymbols($); await updatePane($, (s) => reducePane(s, { type: 'tab', tab })); if (tab === 'symbols') await enterSymbols($) })().catch((err: unknown) => {
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
              hotkey={back.editing && compactEditor ? undefined : l.digit}
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
      {showBack && <Box key="back-row" flexDirection="row"><Text> </Text><Button key="back" plain hotkey={back.editing ? undefined : KEYS[view].find(key => key.action === 'back' && /^[a-z0-9]$/.test(key.key))?.key} label="Back" onPress={() => { void goBack($).catch(err => $.ui.log(`jei: back failed: ${String(err)}`)) }} /></Box>}
      <Box flexDirection="column" flexGrow={1}>
        {content
          ? content.body
          : []}
      </Box>
      {showHint && <Box key="hint">{hintRow()}</Box>}
    </Box>
  )
}
