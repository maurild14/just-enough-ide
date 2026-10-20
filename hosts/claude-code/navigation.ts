import type { EngineInterface } from 'claude-code'
import { currentView, reducePane } from '../../core/pane.ts'
import { readGit, readGitUi, readHistory, readPane, readTree, updateGitUi, updateHistory, updatePane, updateTree } from './state.ts'
import { leaveSearchEditor, searchEditing } from './search.tsx'
import { leaveSymbolsEditor, stopSymbols, symbolsEditing } from './symbols.tsx'

/** The visible control and keyboard shortcut share the same one-level return. */
export async function backContext($: EngineInterface) {
  const pane = await readPane($)
  const view = currentView(pane)
  const tree = pane.tab === 'files' ? await readTree($) : null
  const git = pane.tab === 'git' ? await readGit($) : null
  const editorView = view === 'git' || view === 'git.branches' || view === 'git.compare'
  const ui = editorView ? await readGitUi($) : null
  const history = editorView && git?.root ? await readHistory($, git.root) : null
  const question = !!ui?.ask && (view === 'git' || ui.ask.kind === 'history' && ui.ask.root === git?.root)
  const filtering = view === 'files' && tree?.filtering || view === 'git' && history?.filtering || view === 'git.branches' && history?.branchFiltering
  const editing = await searchEditing($) || await symbolsEditing($)
  return { active: pane.stack.length > 1 || !!filtering || question || !!history?.newBranch || editing, editing: !!filtering || !!history?.newBranch || editing, inline: question || !!history?.newBranch }
}

export async function goBack($: EngineInterface): Promise<void> {
  const pane = await readPane($)
  const view = currentView(pane)
  if (['search', 'quickopen', 'search.replace'].includes(view) && await leaveSearchEditor($)) return
  if ((view === 'symbols' || view === 'symbols.results') && await leaveSymbolsEditor($)) return
  if (view === 'symbols' || view === 'symbols.results') await stopSymbols($)
  if (view === 'git' || view === 'git.branches' || view === 'git.compare') {
    const git = await readGit($)
    const { ask } = await readGitUi($)
    if (ask && (view === 'git' || ask.kind === 'history' && ask.root === git?.root)) { await updateGitUi($, ui => ({ ...ui, ask: null })); return }
    if (git?.root) {
      const history = await readHistory($, git.root)
      if (history.newBranch) { await updateHistory($, git.root, h => ({ ...h, newBranch: null })); return }
      if (view === 'git' && history.filtering) { await updateHistory($, git.root, h => ({ ...h, filtering: false, draft: h.filter })); return }
      if (view === 'git.branches' && history.branchFiltering) { await updateHistory($, git.root, h => ({ ...h, branchFiltering: false })); return }
    }
  }
  if (view === 'files' && (await readTree($)).filtering) { await updateTree($, tree => ({ ...tree, filtering: false, filter: '' })); return }
  await updatePane($, state => reducePane(state, { type: 'back' }))
}
