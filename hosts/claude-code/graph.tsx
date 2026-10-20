import type { EngineInterface, RenderElement } from 'claude-code'
import { KEYS } from '../../core/keys.ts'
import type { Options } from '../../core/options.ts'
import { openUrlArgv } from '../../core/files/open.ts'
import { graphLine, layoutGraph } from '../../core/git/graph.ts'
import { parseGraphFilter, type LogCommit } from '../../core/git/log.ts'
import { checkout, commitFiles, createBranch, fetchAll, graph, revert, switchBranch, validBranchName, webUrl } from '../../core/git/service.ts'
import { GitError } from '../../core/git/run.ts'
import { reducePane, type DiffSource } from '../../core/pane.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import type { JeiAsk } from '../../types/index.d.ts'
import { onRefresh } from './activity.ts'
import { busy, runHookAware, type Repo } from './git.tsx'
import { firstLine, hostFor, type FilesAction, type FilesFrame, type PaneRender } from './files.tsx'
import { readGit, readGitUi, readHistory, updateGitUi, updateHistory, updatePane } from './state.ts'
import { color, graphColor } from './theme.ts'

export type HistoryItem = { id: string; isRow: boolean; el: RenderElement }
type Question = Extract<JeiAsk, { kind: 'history' }>
const cache = new Map<string, Promise<Awaited<ReturnType<typeof graph>>>>()
onRefresh(() => cache.clear())

export function historyAct($: EngineInterface, fn: () => Promise<unknown>): () => void {
  return () => { void fn().catch((e: unknown) => $.ui.toast(e instanceof GitError ? e.firstLine : firstLine(e))) }
}

export function historyKey(view: 'git' | 'git.branches', action: string): string {
  return KEYS[view].find((key) => key.action === action)!.key
}

export async function openHistoryDiff($: EngineInterface, path: string, source: DiffSource, view: 'git' | 'git.branches' | 'git.compare', id: string): Promise<void> {
  await updateGitUi($, (u) => ({ ...u, diffTop: 0 }))
  await updatePane($, (s) => reducePane(reducePane(s, { type: 'select', view, id }), { type: 'open-diff', path, source }))
}

/** The service repeats all validation and confirmation reads on the approved retry. */
export async function historyAction($: EngineInterface, q: Omit<Question, 'kind' | 'confirm'>, confirmed = false): Promise<void> {
  const g = await readGit($)
  if (g?.root !== q.root) return
  await busy($, `${q.operation === 'create' ? 'Creating branch' : q.operation === 'switch' ? 'Switching' : q.operation === 'checkout' ? 'Checking out' : 'Reverting'}…`, async () => {
    await updateGitUi($, (u) => ({ ...u, ask: null }))
    const host = hostFor($, q.root)
    const run = (steps: string[][]) => runHookAware($, q.root, steps, g.hooks)
    const r = q.operation === 'create' ? await createBranch(host, q.root, q.target, q.start, confirmed, run)
      : q.operation === 'switch' ? await switchBranch(host, q.root, q.target, confirmed, run)
      : q.operation === 'checkout' ? await checkout(host, q.root, q.target, confirmed, run)
      : await revert(host, q.root, q.target, confirmed, run)
    if (!r.ok) await updateGitUi($, (u) => ({ ...u, ask: { ...q, kind: 'history', confirm: r.confirm } }))
    else await updateHistory($, q.root, (historyUi) => ({ ...historyUi, newBranch: null }))
  })
}

export async function newBranch($: EngineInterface, root: string, start: string | null): Promise<void> {
  await updateHistory($, root, (historyUi) => ({ ...historyUi, newBranch: { start, name: '' } }))
  await $.ui.focus({ requestId: 'jei', key: 'new-branch' }).catch(() => undefined)
}

/** Shared branch-name editor: kept above the viewport, including five-row panes. */
export async function branchInput($: EngineInterface, e: PaneRender, frame: FilesFrame, root: string): Promise<RenderElement[]> {
  const historyUi = await readHistory($, root)
  if (!historyUi.newBranch) return []
  const { Box, Text, Button } = $.ui.resolve(e)
  const els = $.ui.resolve(e)
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const start = historyUi.newBranch.start
  const submit = historyAct($, async () => {
    const name = (await readHistory($, root)).newBranch?.name ?? ''
    if (!await validBranchName(hostFor($, root), root, name)) { $.ui.toast('Not a valid branch name.'); return }
    await historyAction($, { root, operation: 'create', target: name, start })
  })
  return [
    <Box key="branch-input-row" flexDirection="row"><Text> </Text>{Input ? <Input key="new-branch" value={historyUi.newBranch.name}
      placeholder={`New branch name${start ? ` from ${start.slice(0, 7)}` : ''}`} onInput={(name: string) => historyAct($, () => updateHistory($, root, (historyUi) => ({ ...historyUi, newBranch: { start, name } })))()}
      onSubmit={(name: string) => historyAct($, async () => { await updateHistory($, root, (historyUi) => ({ ...historyUi, newBranch: { start, name } })); submit() })()} />
      : <Text>{fitEnd('New branch name requires an input surface.', frame.inner)}</Text>}</Box>,
    <Box key="branch-input-controls" flexDirection="row"><Text> </Text><Button key="branch-input-cancel" plain label="Cancel" onPress={historyAct($, () => updateHistory($, root, (historyUi) => ({ ...historyUi, newBranch: null })))} /></Box>,
  ]
}

export function historyConfirmation($: EngineInterface, e: PaneRender, frame: FilesFrame, q: Question): RenderElement[] {
  const { Box, Text, Button } = $.ui.resolve(e)
  return [
    <Box key="history-question"><Text color={color('warning')}>{` ${fitEnd(q.confirm, frame.inner)}`}</Text></Box>,
    <Box key="history-answers" flexDirection="row"><Text> </Text>
      <Button key="history-confirm" plain label="Confirm" onPress={historyAct($, () => historyAction($, q, true))} /><Text>  </Text>
      <Button key="history-cancel" plain label="Cancel" onPress={historyAct($, () => updateGitUi($, (u) => ({ ...u, ask: null })))} />
    </Box>,
  ]
}

export async function renderGraph($: EngineInterface, e: PaneRender, frame: FilesFrame, options: Options, g: Repo, selected: string | undefined, workingSelection?: string) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const els = $.ui.resolve(e)
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const historyUi = await readHistory($, g.root)
  const inner = frame.inner
  const items: HistoryItem[] = []
  const row = (id: string, text: string, run?: () => void, look?: 'error' | 'muted') => {
    const content = <Text inverse={id === selected} color={look === 'error' ? color('error') : undefined} dimColor={look === 'muted'}>{fitEnd(text, inner)}</Text>
    items.push({ id, isRow: !!run, el: <Box key={`line-${id}`} flexDirection="row"><Text> </Text>{run ? <Button key={id} plain onPress={run}>{content}</Button> : <Box key={id}>{content}</Box>}</Box> })
  }
  const closed = (await readGitUi($)).collapsed.includes('graph')
  let commits: LogCommit[] = []
  if (!closed) {
    const key = `${g.root}\0${historyUi.filter}\0${historyUi.pages}\0${options.graphLimit}`
    try {
      let p = cache.get(key)
      if (!p) { p = graph(hostFor($, g.root), g.root, parseGraphFilter(historyUi.filter), options.graphLimit * historyUi.pages); cache.set(key, p) }
      const loaded = await p
      commits = loaded.commits
      selected ??= commits.length ? 'group-graph' : workingSelection ?? 'group-graph'
      const now = commits.length ? await $.clock.now() : 0
      const glyphs = layoutGraph(commits, 'unicode')
      for (let i = 0; i < commits.length; i++) {
        const c = commits[i]!
        const id = `graph-${c.hash}`
        const line = graphLine(c, glyphs[i]!, inner, historyUi.agents.includes(c.hash), now)
        items.push({ id, isRow: true, el: <Box key={`line-${id}`} flexDirection="row"><Text> </Text><Button key={id} plain onPress={historyAct($, async () => {
          await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id }))
          await updateHistory($, g.root, (historyUi) => ({ ...historyUi, expanded: historyUi.expanded === c.hash ? null : c.hash }))
        })}>{line.spans.map(span => <Text inverse={selected === id} color={selected === id ? undefined : graphColor(span)} dimColor={selected !== id && span.role === 'muted'}>{span.text}</Text>)}</Button></Box> })
        if (historyUi.expanded === c.hash) {
          try {
            for (const file of await commitFiles(hostFor($, g.root), g.root, c.hash)) {
              const counts = file.added !== null && file.removed !== null ? ` +${file.added} −${file.removed}` : ''
              const fileId = `commit-file-${c.hash}-${file.path}`
              row(fileId, `${file.status} ${fitPath(file.path, Math.max(0, inner - 2 - cellWidth(counts)))}${counts}`,
                historyAct($, () => openHistoryDiff($, file.path, { kind: 'commit', hash: c.hash }, 'git', fileId)))
            }
            for (const operation of ['checkout', 'revert'] as const) row(`${operation}-${c.hash}`, operation === 'checkout' ? 'Checkout' : 'Revert', historyAct($, () => historyAction($, { root: g.root, operation, target: c.hash, start: null })))
            const url = await webUrl(hostFor($, g.root), g.root, c.hash)
            if (url) row(`web-${c.hash}`, `Open on ${url.startsWith('https://github.com/') ? 'GitHub' : 'GitLab'}`, historyAct($, async () => {
              const host = hostFor($, g.root)
              const argv = openUrlArgv(url, host.platform)
              if (argv) await host.run(argv)
            }))
          } catch (error) { row(`files-error-${c.hash}`, `Can't list files: ${firstLine(error)}.`, undefined, 'error') }
        }
        if (line.connector.length) items.push({ id: `connector-${c.hash}`, isRow: false, el: <Box key={`connector-${c.hash}`} flexDirection="row"><Text> </Text>{line.connector.map(span => <Text color={graphColor(span)} dimColor={span.role === 'muted'}>{span.text}</Text>)}</Box> })
      }
      if (loaded.more) row('graph-more', 'Load more', historyAct($, () => updateHistory($, g.root, (historyUi) => ({ ...historyUi, pages: historyUi.pages + 1 }))))
      if (!commits.length) row('graph-empty', historyUi.filter ? 'No commits match this filter.' : 'No commits yet.', undefined, 'muted')
    } catch (error) { row('graph-error', `Can't load history: ${firstLine(error)}.`, undefined, 'error') }
  }
  selected ??= closed ? 'group-graph' : workingSelection ?? 'group-graph'
  row('group-graph', `${closed ? '▸' : '▾'} Graph${historyUi.filter ? ' (filtered)' : ''}`, historyAct($, async () => {
    await updatePane($, (s) => reducePane(s, { type: 'select', view: 'git', id: 'group-graph' }))
    await updateGitUi($, (u) => ({ ...u, collapsed: closed ? u.collapsed.filter((x) => x !== 'graph') : [...u.collapsed, 'graph'] }))
  }))
  items.unshift(items.pop()!)
  const selectedCommit = commits.find((c) => selected === `graph-${c.hash}`)
  const actions: FilesAction[] = []
  const action = (name: string, fn: () => Promise<unknown>) => actions.push({ key: historyKey('git', name), run: historyAct($, fn) })
  if (selectedCommit) {
    action('copy-hash', async () => { const r = await $.ui.copy({ text: selectedCommit.hash, surface: e.surface }); if (!r.isCopied) $.ui.toast(`Copy failed: ${r.reason}.`) })
    action('ask', async () => { const r = await $.prompt.fill({ text: `Explain commit ${selectedCommit.hash.slice(0, 7)} ("${selectedCommit.subject}").`, mode: 'insert' }); if (!r.isFilled) $.ui.toast("The prompt can't take the request right now.") })
    action('new-branch', () => newBranch($, g.root, selectedCommit.hash))
  }
  action('branches', () => updatePane($, (s) => reducePane(s, { type: 'branches' })))
  action('filter', async () => { await updateHistory($, g.root, (historyUi) => ({ ...historyUi, filtering: true, draft: historyUi.filter })); await $.ui.focus({ requestId: 'jei', key: 'graph-filter' }).catch(() => undefined) })
  action('fetch', () => busy($, 'fetching…', () => fetchAll(hostFor($, g.root), g.root)).catch((err: unknown) => $.ui.toast(`Fetch failed: ${firstLine(err).replace(/\.+$/, '')}.`)))
  const pinned = await branchInput($, e, frame, g.root)
  if (historyUi.filtering && Input) pinned.push(<Box key="graph-filter-row" flexDirection="row"><Text> </Text><Input key="graph-filter" placeholder="Filter: text, author:, path:, branch:*" value={historyUi.draft}
    onInput={(draft: string) => historyAct($, () => updateHistory($, g.root, (historyUi) => ({ ...historyUi, draft })))()}
    onSubmit={(filter: string) => historyAct($, async () => { await updateHistory($, g.root, (historyUi) => ({ ...historyUi, filter, draft: filter, filtering: false, pages: 1 })); await updatePane($, (s) => ({ ...s, selected: { ...s.selected, git: 'group-graph' } })) })()} /></Box>)
  return { items, actions, pinned, commitSelected: !!selectedCommit, defaultSelection: commits.length || closed ? 'group-graph' : workingSelection ?? 'group-graph' }
}
