import type { EngineInterface, Register } from 'claude-code'
import { parseJeiArgument } from '../core/command.ts'
import { currentView, reducePane } from '../core/pane.ts'
import { parseOptions } from '../core/options.ts'
import { reveal } from '../core/files/tree.ts'
import { projectRel } from '../core/shared/paths.ts'
import { TAB_NAMES } from '../core/shared/tabs.ts'
import { refreshGit, registerActivity } from '../hosts/claude-code/activity.ts'
import { scrollDiff } from '../hosts/claude-code/diff.tsx'
import { focusFiles, forgetFileList, scrollFiles } from '../hosts/claude-code/files.tsx'
import { focusGit, scrollGitList } from '../hosts/claude-code/git.tsx'
import { focusBranches, scrollBranches } from '../hosts/claude-code/branches.tsx'
import { focusSearch, scrollSearch, stopSearch } from '../hosts/claude-code/search.tsx'
import { renderPane } from '../hosts/claude-code/pane.tsx'
import { focusInput, inputId, resetInputs } from '../hosts/claude-code/inputs.ts'
import { initPane, PANE_ID, readCwd, readPane, readTree, resetActiveActivity, resetGitUi, resetFilesUi, resetSearch, setCwd, updatePane, updateTree, updateSearch } from '../hosts/claude-code/state.ts'

const TITLE = 'JEI'

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Opens (or brings forward) the pane; null when it shows, else the answer to give. */
async function openPane($: EngineInterface): Promise<string | null> {
  try {
    const r = await $.ui.open({ id: PANE_ID, title: TITLE, focus: true })
    return r.isPlaced ? null : `JEI is open but not shown yet: ${r.reason}.`
  } catch (err) {
    return `JEI could not open: ${reason(err)}.`
  }
}

// Wiring only: what each hook does lives in hosts/claude-code/ and core/.
export const register: Register = (on, raw) => {
  const options = parseOptions(raw)
  // Armed only by a fresh session, so a hot reload never reopens a pane the person closed.
  let autoOpenArmed = false

  on('session.start', async ($, e, next) => {
    resetInputs()
    await resetActiveActivity($)
    await $.command.register({
      name: 'jei',
      description: 'Toggle the JEI pane: /jei [files|search|git|<path>]',
    })
    await stopSearch($, true)
    autoOpenArmed = (await initPane($, options.defaultTab)) && options.startOpen
    await setCwd($, e.cwd)
    await resetGitUi($)
    await resetFilesUi($)
    await resetSearch($)
    void refreshGit($).catch(() => undefined)
    return next(e)
  })

  // Open on start only where the surface docks the pane beside the transcript;
  // the first prompt-hint draw is the first moment the viewport is known.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (autoOpenArmed && e.viewport?.isFullscreen === true) {
      autoOpenArmed = false
      void $.ui.open({ id: PANE_ID, title: TITLE }).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'jei' }, async ($, e) => {
    resetInputs()
    const arg = parseJeiArgument(e.args ?? '') // a plugin's $.command.run may leave args out
    if (arg.toggle) {
      const mine = (await $.ui.panes()).find((p) => p.id === PANE_ID)
      if (mine?.isPlaced && mine.isShown) {
        try {
          await $.ui.close({ id: PANE_ID })
        } catch (err) {
          return { text: `JEI could not close: ${reason(err)}.` }
        }
        return { text: 'JEI closed.' }
      }
      return { text: (await openPane($)) ?? 'JEI opened.' }
    }
    let rel: string | null = null
    if (arg.reveal !== undefined) {
      rel = projectRel(await readCwd($), arg.reveal)
      if (rel === null) return { text: 'That path is outside the project.' }
    }
    const tab = arg.tab ?? 'files'
    await stopSearch($)
    await updatePane($, (s) => reducePane(s, { type: 'tab', tab }))
    if (tab === 'search') await updateSearch($, await readCwd($), s => ({ ...s, editing: 'query' }))
    if (rel) {
      const id = rel
      await updateTree($, (t) => ({ ...t, expanded: [...reveal(new Set(t.expanded), id)] }))
      await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id }))
    }
    const opened = await openPane($)
    return { text: opened ?? `JEI opened on ${TAB_NAMES[tab]}.` }
  })

  // Observes only: a failure must never hold up the cd, so the catch passes it on.
  on('classic.CwdChanged', async ($, e, next) => {
    resetInputs()
    await resetActiveActivity($)
    await stopSearch($)
    await setCwd($, e.new_cwd)
    void refreshGit($).catch(() => undefined) // never holds up the cd
    return next(e)
  }).catch(($, e, next) => next(e))

  // Tool calls and file events: the shimmer, follow-the-agent and refreshes.
  registerActivity(on, options)

  // The matchers spell PANE_ID as a literal so the validator can read it.
  on('ui.render', { component: 'Pane', requestId: 'jei' }, ($, e) => renderPane($, e, options))

  // The ring landing on a Files or Git row selects it; the ring always moves on.
  on('ui.focus', { requestId: 'jei' }, async ($, e, next) => {
    // A native arrow can finish its old ring move after Down removed Cancel.
    if (e.element === 'files-cancel' && !(await readTree($)).editing) {
      const pane = await readPane($)
      if (currentView(pane) === 'files' && pane.selected.files !== undefined) e = { ...e, element: `row-${pane.selected.files}` }
    }
    focusInput(e.element)
    const element = inputId(e.element)
    await focusFiles($, element)
    await focusGit($, element)
    await focusBranches($, element)
    await focusSearch($, element)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.input', { requestId: 'jei' }, ($, e, next) => { if (e.kind === 'submit') focusInput(undefined); return next(e) })

  // Each view owns its window; ignored scrolls must leave the pinned frame in place.
  on('ui.scroll', { requestId: 'jei' }, async ($, e) => {
    (await scrollFiles($, e.by)) || (await scrollGitList($, e.by)) || (await scrollBranches($, e.by)) || (await scrollDiff($, e.by)) || (await scrollSearch($, e.by))
    return {}
  },
  ).catch(
    ($, e, next) => next(e),
  )
  on('ui.close', async ($, e, next) => { if (e.id === 'jei') { await stopSearch($, true); forgetFileList(await readCwd($)) }; return next(e) }).catch(($, e, next) => next(e))
  on('session.end', async ($, e, next) => { await stopSearch($, true); return next(e) }).catch(($, e, next) => next(e))
}
