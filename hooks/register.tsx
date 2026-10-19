import type { EngineInterface, Register } from 'claude-code'
import { parseJeiArgument } from '../core/command.ts'
import { reducePane } from '../core/pane.ts'
import { parseOptions } from '../core/options.ts'
import { reveal } from '../core/files/tree.ts'
import { projectRel } from '../core/shared/paths.ts'
import { TAB_NAMES } from '../core/shared/tabs.ts'
import { refreshGit, registerActivity } from '../hosts/claude-code/activity.ts'
import { focusFiles, scrollFiles } from '../hosts/claude-code/files.tsx'
import { renderPane } from '../hosts/claude-code/pane.tsx'
import { initPane, PANE_ID, readCwd, setCwd, updatePane, updateTree } from '../hosts/claude-code/state.ts'

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
    await $.command.register({
      name: 'jei',
      description: 'Toggle the JEI pane: /jei [files|search|symbols|git|<path>]',
    })
    await setCwd($, e.cwd)
    autoOpenArmed = (await initPane($, options.defaultTab)) && options.startOpen
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
    await updatePane($, (s) => reducePane(s, { type: 'tab', tab }))
    if (rel) {
      const id = rel
      await updateTree($, (t) => ({ ...t, expanded: [...reveal(new Set(t.expanded), id)] }))
      await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id }))
    }
    return { text: (await openPane($)) ?? `JEI opened on ${TAB_NAMES[tab]}.` }
  })

  // Observes only: a failure must never hold up the cd, so the catch passes it on.
  on('classic.CwdChanged', async ($, e, next) => {
    await setCwd($, e.new_cwd)
    void refreshGit($).catch(() => undefined) // never holds up the cd
    return next(e)
  }).catch(($, e, next) => next(e))

  // Tool calls and file events: the shimmer, follow-the-agent and refreshes.
  registerActivity(on, options)

  // The matchers spell PANE_ID as a literal so the validator can read it.
  on('ui.render', { component: 'Pane', requestId: 'jei' }, ($, e) => renderPane($, e, options))

  // The ring landing on a Files row selects it; the ring always moves on.
  on('ui.focus', { requestId: 'jei' }, async ($, e, next) => {
    await focusFiles($, e.element)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Files draws its own window (pinned header and hint), so it takes the scroll.
  on('ui.scroll', { requestId: 'jei' }, async ($, e, next) => ((await scrollFiles($, e.by)) ? {} : next(e))).catch(
    ($, e, next) => next(e),
  )
}
