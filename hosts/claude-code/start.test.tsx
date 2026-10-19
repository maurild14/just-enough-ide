import { expect, test } from 'claude-code/testing'

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }


test('a fresh fullscreen session opens the pane once', async ($, on) => {
  const opens: string[] = []
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text', children: ['hint'] }))
  await $.session.start({ cwd: '/work/acme-app', surface: 'terminal', isInteractive: true })
  const viewport = { columns: 160, rows: 40, isFullscreen: true }
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'PromptHint', props: HINT, viewport })
  await ui.redraw({ ...HINT, isDraft: true })
  expect(opens).toEqual(['jei'])
  await ui.unmount()

  // A second start in the same session (a hot reload) finds the pane state written: no reopen.
  await $.session.start({ cwd: '/work/acme-app', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'PromptHint', props: HINT, viewport })
  expect(opens).toEqual(['jei'])
  await again.unmount()
})

test('the main screen never opens the pane unasked', async ($, on) => {
  const opens: string[] = []
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text', children: ['hint'] }))
  await $.session.start({ cwd: '/work/acme-app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 160, rows: 40, isFullscreen: false } })
  expect(opens).toEqual([])
  await ui.unmount()
})

test('startOpen off never opens the pane unasked', { options: { startOpen: 'off' } }, async ($, on) => {
  const opens: string[] = []
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text', children: ['hint'] }))
  await $.session.start({ cwd: '/work/acme-app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns: 160, rows: 40, isFullscreen: true } })
  expect(opens).toEqual([])
  await ui.unmount()
})
