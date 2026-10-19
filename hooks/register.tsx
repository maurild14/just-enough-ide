import type { EngineInterface, Register } from 'claude-code'
import { parseJeiArgument } from '../core/command.ts'
import { reducePane } from '../core/pane.ts'
import { parseOptions } from '../core/options.ts'
import { reveal } from '../core/files/tree.ts'
import { renderPane, TAB_NAMES } from '../hosts/claude-code/pane.tsx'
import { initPane, PANE_ID, setCwd, updatePane, updateTree } from '../hosts/claude-code/state.ts'

const TITLE = 'JEI'

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE_ID, title: TITLE, focus: true })

// Wiring only: what each hook does lives in hosts/claude-code/ and core/.
export const register: Register = (on, raw) => {
  const options = parseOptions(raw)
  let autoOpenTried = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jei',
      description: 'Toggle the JEI pane: /jei [files|search|symbols|git|<path>]',
    })
    await setCwd($, e.cwd)
    await initPane($, options.defaultTab)
    return next(e)
  })

  // Open on start only where the surface docks the pane beside the transcript;
  // the first prompt-hint draw is the first moment the viewport is known.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (!autoOpenTried && options.startOpen && e.viewport?.isFullscreen === true) {
      autoOpenTried = true
      void $.ui.open({ id: PANE_ID, title: TITLE }).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'jei' }, async ($, e) => {
    const arg = parseJeiArgument(e.args ?? '') // a plugin's $.command.run may leave args out
    if (arg.toggle) {
      const open = (await $.ui.panes()).some((p) => p.id === PANE_ID && p.isPlaced)
      if (open) {
        await $.ui.close({ id: PANE_ID })
        return { text: 'JEI closed.' }
      }
      await openPane($)
      return { text: 'JEI opened.' }
    }
    const tab = arg.tab ?? 'files'
    await updatePane($, (s) => reducePane(s, { type: 'tab', tab }))
    if (arg.reveal) {
      const rel = arg.reveal
      await updateTree($, (t) => ({ ...t, expanded: [...reveal(new Set(t.expanded), rel)] }))
      await updatePane($, (s) => reducePane(s, { type: 'select', view: 'files', id: rel }))
    }
    await openPane($)
    return { text: `JEI opened on ${TAB_NAMES[tab]}.` }
  })

  // Observes only: a failure must never hold up the cd, so the catch passes it on.
  on('classic.CwdChanged', async ($, e, next) => {
    await setCwd($, e.new_cwd)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The matcher spells PANE_ID as a literal so the validator can read it.
  on('ui.render', { component: 'Pane', requestId: 'jei' }, ($, e) => renderPane($, e))
}
