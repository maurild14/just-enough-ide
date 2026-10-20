import { Plugin } from '@opencode/plugin/tui'
import { createEffect, onCleanup } from 'solid-js'
import { parseJeiArgument } from '../../core/command.ts'
import { parseOptions } from '../../core/options.ts'
import { initialPane, normalizePane, reducePane } from '../../core/pane.ts'
import { Pane, paneMemory } from './pane.tsx'
import { JeiRpc } from './rpc.ts'

export default Plugin.define({
  id: 'jei',
  setup(ctx) {
    const options = parseOptions(ctx.options)
    const api = ctx.client.rpc(JeiRpc)
    const [memory, update] = paneMemory(ctx)
    const dispose = ctx.ui.slot({ append: 'session.panel', render: (input) => input.name === 'jei' ? <Pane input={input} ctx={ctx} api={api} /> : null })
    onCleanup(dispose)
    ctx.keymap.layer(() => ({ commands: [{
      id: 'jei.toggle', title: 'Toggle JEI', palette: true, slash: { name: 'jei', arguments: true },
      run(arg = '') {
        const route = ctx.ui.router.current()
        if (route.type !== 'session') return
        const request = parseJeiArgument(arg)
        if (request.toggle && ctx.ui.panel.current()?.name === 'jei' && ctx.ui.panel.current()?.sessionID === route.sessionID) {
          ctx.ui.panel.close()
          return
        }
        update((draft) => {
          let state = normalizePane(memory.panes[route.sessionID] ?? initialPane(options.defaultTab))
          if (request.tab) state = reducePane(state, { type: 'tab', tab: request.tab })
          if (request.reveal) state = reducePane(state, { type: 'select', view: 'files', id: request.reveal })
          draft.panes[route.sessionID] = state
        })
        if (ctx.ui.panel.open('jei', { presentation: 'panel' })) update((draft) => {
          if (!draft.started.includes(route.sessionID)) draft.started.push(route.sessionID)
        })
      },
    }] }))
    createEffect(() => {
      const route = ctx.ui.router.current()
      if (route.type !== 'session' || !options.startOpen || memory.started.includes(route.sessionID)) return
      if (ctx.ui.panel.open('jei', { presentation: 'panel' })) update((draft) => { draft.started.push(route.sessionID) })
    })
  },
})
