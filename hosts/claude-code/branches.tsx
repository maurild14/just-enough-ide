import type { EngineInterface } from 'claude-code'
import { branches, compare } from '../../core/git/service.ts'
import type { Branch } from '../../core/git/branches.ts'
import { currentView, reducePane } from '../../core/pane.ts'
import { cellWidth, fitEnd, fitPath, padEnd } from '../../core/shared/fit.ts'
import { branchInput, historyAct, historyAction, historyConfirmation, historyKey, newBranch, openHistoryDiff, type HistoryItem } from './graph.tsx'
import { firstLine, hostFor, windowTop, type FilesAction, type FilesFrame, type FilesView, type PaneRender } from './files.tsx'
import { readGit, readGitUi, readHistory, readPane, readTick, updateHistory, updatePane } from './state.ts'
import { color } from './theme.ts'

const refOf = (b: Branch) => `refs/${b.remote ? 'remotes' : 'heads'}/${b.name}`
const lists = new Map<string, { ids: string[]; selected: string | undefined }>()

export async function focusBranches($: EngineInterface, id: string | undefined): Promise<void> {
  if (id && (id.startsWith('branch-refs/') || id.startsWith('compare-file-')) && currentView(await readPane($)) === 'git.branches') {
    await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git.branches', id }))
  }
}

export async function scrollBranches($: EngineInterface, by: number): Promise<boolean> {
  if (currentView(await readPane($)) !== 'git.branches') return false
  const list = lists.get(await $.session.id())
  if (!list?.ids.length) return true
  const from = list.ids.indexOf(list.selected ?? '')
  const id = list.ids[Math.max(0, Math.min(list.ids.length - 1, from + by))]!
  await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git.branches', id }))
  await $.ui.focus({ requestId: 'jei', key: id }).catch(() => undefined)
  return true
}

export async function renderBranches($: EngineInterface, e: PaneRender, frame: FilesFrame): Promise<FilesView> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const els = $.ui.resolve(e)
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const g = await readGit($)
  const pane = await readPane($)
  const ui = await readGitUi($)
  await readTick($)
  const line = (id: string, text: string, look?: 'error' | 'muted') => <Box key={id}><Text color={look === 'error' ? color('error') : undefined} dimColor={look === 'muted'}>{` ${fitEnd(text, frame.inner)}`}</Text></Box>
  const back = historyAct($, () => updatePane($, (s) => reducePane(s, { type: 'back' })))
  const header = <Box flexDirection="row"><Text> </Text><Button key="back" plain label={fitEnd('Branches', frame.inner)} onPress={back} /></Box>
  if (!g?.root) return { header, body: [line('notice', 'Git is still loading.', 'muted')], actions: [] }
  const root = g.root
  const historyUi = await readHistory($, root)
  const items: HistoryItem[] = []
  const rows = await branches(hostFor($, root), root).catch((err: unknown) => ({ branches: [] as Branch[], base: null, error: firstLine(err) }))
  const visible = rows.branches.filter((b) => b.name.toLowerCase().includes(historyUi.branchFilter.toLowerCase()))
  const ids = visible.map((b) => `branch-${refOf(b)}`)
  const wanted = pane.selected['git.branches']
  const selected = wanted && (ids.includes(wanted) || (historyUi.compared && wanted.startsWith('compare-file-'))) ? wanted : ids[0]
  const add = (id: string, text: string, fn?: () => Promise<unknown>, look?: 'error' | 'muted') => items.push({ id, isRow: !!fn, el: fn
    ? <Box key={`line-${id}`} flexDirection="row"><Text> </Text><Button key={id} plain onPress={historyAct($, fn)}><Text inverse={id === selected}>{fitEnd(text, frame.inner)}</Text></Button></Box>
    : line(id, text, look) })
  if ('error' in rows) add('branches-error', `Can't list branches: ${rows.error}.`, undefined, 'error')
  let remote = false
  for (const b of visible) {
    if (b.remote && !remote) { add('remote-heading', 'Remote'); remote = true }
    const counts = ` ↑${b.ahead} ↓${b.behind}${b.gone ? ' gone' : ''}`
    const room = Math.max(0, frame.inner - 2 - cellWidth(counts))
    const ref = refOf(b)
    add(`branch-${ref}`, `${b.current ? '*' : ' '} ${padEnd(fitPath(b.name, room), room)}${counts}`,
      () => historyAction($, { root, operation: 'switch', target: ref, start: null }))
  }
  if (!visible.length && !('error' in rows)) add('branches-empty', 'No branches match this filter.', undefined, 'muted')
  if (historyUi.compared) {
    add('compare-heading', `Compared with ${historyUi.compared.label}`)
    try {
      const files = await compare(hostFor($, root), root, historyUi.compared.base, historyUi.compared.head)
      if (!files.length) add('compare-empty', 'No changes.', undefined, 'muted')
      for (const file of files) {
        const id = `compare-file-${file.path}`
        const counts = file.added !== null && file.removed !== null ? ` +${file.added} −${file.removed}` : ''
        add(id, `${file.status} ${fitPath(file.path, Math.max(0, frame.inner - 2 - cellWidth(counts)))}${counts}`,
          () => openHistoryDiff($, file.path, { kind: 'compare', base: historyUi.compared!.base, head: historyUi.compared!.head }, 'git.branches', id))
        ids.push(id)
      }
    } catch (error) { add('compare-error', `Can't compare branches: ${firstLine(error)}.`, undefined, 'error') }
  }
  lists.set(await $.session.id(), { ids, selected })
  const actions: FilesAction[] = [
    { key: historyKey('git.branches', 'new-branch'), run: historyAct($, () => newBranch($, root, null)) },
    { key: historyKey('git.branches', 'compare'), run: historyAct($, async () => {
      if (!rows.base) { $.ui.toast('No main branch to compare with.'); return }
      const branch = rows.branches.find((b) => `branch-${refOf(b)}` === selected)
      if (!branch) { $.ui.toast('Select a branch first.'); return }
      const base = rows.branches.find((b) => refOf(b) === rows.base)
      if (!base) { $.ui.toast('No main branch to compare with.'); return }
      await updateHistory($, root, (historyUi) => ({ ...historyUi, compared: { base: base.hash, head: branch.hash, label: base.name } }))
    }) },
    { key: historyKey('git.branches', 'filter'), run: historyAct($, async () => {
      await updateHistory($, root, (historyUi) => ({ ...historyUi, branchFiltering: true }))
      await $.ui.focus({ requestId: 'jei', key: 'branch-filter' }).catch(() => undefined)
    }) },
  ]
  const question = ui.ask?.kind === 'history' && ui.ask.root === root ? ui.ask : null
  const pinned = question ? historyConfirmation($, e, frame, question) : await branchInput($, e, frame, root)
  if (!question && historyUi.branchFiltering && Input) pinned.push(<Box key="branch-filter-row" flexDirection="row"><Text> </Text><Input key="branch-filter" value={historyUi.branchFilter} placeholder="Filter branches"
    onInput={(branchFilter: string) => historyAct($, () => updateHistory($, root, (historyUi) => ({ ...historyUi, branchFilter })))()}
    onSubmit={(branchFilter: string) => historyAct($, () => updateHistory($, root, (historyUi) => ({ ...historyUi, branchFilter, branchFiltering: false })))()} /></Box>)
  const room = Math.max(1, frame.bodyRows - pinned.length)
  const top = windowTop('git.branches', items.map((i) => i.id), selected, room)
  return { header, body: [...pinned, ...items.slice(top, top + room).map((i) => i.el)], actions: historyUi.newBranch || historyUi.branchFiltering ? [] : actions }
}
