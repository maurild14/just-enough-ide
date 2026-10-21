import { expect, test } from 'claude-code/testing'
import { ROOT, command, props, world } from '../../test/claude-search.ts'

const focus = (element: string) => ({ component: 'Pane' as const, requestId: 'jei', plugin: 'jei', element, origin: { kind: 'person' as const } })

test('leaving a Search or Symbols input restores tab hotkeys without submitting', async ($, on) => {
  const seen = await world($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(command('search'))
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props() })
    await $.ui.focus(focus('search-query'))
    await ui.input({ key: 'search-query', text: 'load4q', kind: 'change' })
    expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBeUndefined()
    await $.ui.focus(focus('tab-3'))
    expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBe('3')
    await ui.press({ key: 'tab-2' }); await seen.clock.settle()
    await ui.press({ key: 'key-f' })
    await $.ui.focus(focus('symbols-find'))
    expect((await ui.find({ key: 'tab-1' }))?.props.hotkey).toBeUndefined()
    await $.ui.focus(focus('tab-1'))
    expect((await ui.find({ key: 'tab-1' }))?.props.hotkey).toBe('1')
    await ui.press({ key: 'tab-1' })
    expect((await ui.find({ key: 'tab-1' }))?.props.variant).toBe('primary')
    await ui.unmount()
  }
})

test('command controls retain the selected Search result, Quick Open file and replacement file', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await $.ui.focus(focus('search-row-match-1'))
  await $.ui.focus(focus('search-row-command-mention')); await ui.press({ key: 'search-row-command-mention' })
  expect(seen.fills[0]).toContain('src/other.ts:1')
  await ui.press({ key: 'key-q' })
  await ui.input({ key: 'search-query', text: '', kind: 'change' }); await ui.press({ key: 'search-cancel' })
  await $.ui.focus(focus('search-row-file-1'))
  await $.ui.focus(focus('search-row-command-mention')); await ui.press({ key: 'search-row-command-mention' })
  expect(seen.fills[1]).toBe('@src/other.ts ')
  await ui.press({ key: 'key-q' })
  await ui.press({ key: 'search-cancel' }); await ui.press({ key: 'key-p' })
  await ui.input({ key: 'search-replacement', text: 'fetch', kind: 'submit' })
  await $.ui.focus(focus('search-row-src/other.ts'))
  await $.ui.focus(focus('search-row-apply')); await ui.press({ key: 'search-row-apply' })
  expect((await ui.find({ key: 'replace-question' }))?.text).toContain('src/other.ts?')
  await ui.unmount()
})

test('Search retains its query/results across Quick Open and quick submit ranks its actual value', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'key-q' })
  await ui.input({ key: 'search-query', text: 'other:1', kind: 'submit' })
  expect((await ui.find({ key: 'preview-title' }))?.text).toContain('other.ts')
  await ui.press({ key: 'back' }); await ui.press({ key: 'key-q' })
  expect((await ui.find({ key: 'search-query' }))?.props.value).toBe('load')
  expect((await ui.find({ key: 'search-row-match-0' }))?.text).toContain('load')
  await ui.unmount()
})

test('own allowed LSP calls keep trusted plugin origin and do not touch activity or follow Files', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`))
  seen.permission('allow', 'Document symbols:\nload (function) src/account.ts:1:17-3:1\n')
  await $.command.run(command('symbols')); await seen.clock.settle()
  expect(seen.origins).toContain('jei')
  expect(seen.states.activity ?? {}).toEqual({})
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/other.ts` } as never); await seen.clock.settle()
  expect(Object.keys(seen.states.activity ?? {})).toContain('src/other.ts')
})

test('a closed Quick Open cache refreshes and a rejected listing is visible at compact sizes and retries', async ($, on) => {
  const seen = await world($, on)
  seen.settings.largeList = true
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props(24, 5) })
  await ui.press({ key: 'search-cancel' }); await ui.redraw(props()); await ui.press({ key: 'key-q' }); await ui.redraw(props(24, 5))
  expect(await ui.find({ type: 'Text', text: /too large/i })).toBeDefined()
  seen.settings.largeList = false
  await ui.redraw(props())
  expect(await ui.find({ key: 'search-row-file-0' })).toBeDefined()
  const before = seen.runs.filter(a => a.includes('ls-files')).length
  seen.settings.shown = true
  await $.command.run(command(''))
  seen.files['new.ts'] = 'new'
  await ui.redraw(props())
  expect(seen.runs.filter(a => a.includes('ls-files')).length).toBeGreaterThan(before)
  await ui.unmount()
})

test('native hot reload resets Search and Symbols transient flags while retaining query/results', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  seen.settings.slow = true
  await ui.input({ key: 'search-query', text: 'load', kind: 'change' }); await seen.clock.advance(150)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const actual = seen.states.searches as Record<string, { busy: boolean; confirm: string[] | null }>
  expect(actual[ROOT]!.busy).toBe(false); expect(actual[ROOT]!.confirm).toBeNull()
  expect((await ui.find({ key: 'search-query' }))?.props.value).toBe('load')
  await ui.unmount()
})

test('Symbols fallback work cancels its actual stream when leaving the tab', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  seen.settings.slow = true
  await ui.press({ key: 'key-r' }); await seen.clock.advance(100)
  const before = seen.settings.closed
  await ui.press({ key: 'tab-1' }); await seen.clock.advance(1200)
  expect(seen.settings.closed).toBeGreaterThan(before)
  expect((await ui.find({ key: 'header' }))?.text).not.toContain('References')
  await ui.unmount()
})

test('Symbols cancellation stops the next sequential callee search', async ($, on) => {
  const seen = await world($, on)
  seen.files['src/account.ts'] = 'export function load() {\n return save() + finish()\n}\nexport function save() { return 1 }\nexport function finish() { return 2 }\n'
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  seen.settings.slow = true; seen.settings.slowQuery = 'save'
  await ui.press({ key: 'key-c' }); await ui.press({ key: 'symbols-row-calls' }); await seen.clock.advance(100)
  await ui.press({ key: 'tab-1' }); await seen.clock.advance(1200)
  expect(seen.settings.closed).toBeGreaterThan(0)
  expect(seen.runs.filter(a => a[0] === 'rg' && a[a.indexOf('-e') + 1]?.includes('finish'))).toHaveLength(0)
  await ui.unmount()
})

test('opening Symbols publishes its approximate outline before a slow LSP check and re-enters after cwd change', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`))
  seen.settings.holdOutline = true
  seen.permission('allow', 'Document symbols:\nload (function) src/account.ts:1:17-3:1\n')
  expect((await $.command.run(command('symbols'))).text).toBe('JEI opened on Symbols.')
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  expect(await ui.find({ key: 'symbols-row-node-0' })).toBeDefined()
  expect(await ui.find({ key: 'symbols-loading' })).toBeDefined()
  expect(seen.calls).toHaveLength(0)
  await seen.clock.advance(1200)
  expect((await ui.find({ key: 'header' }))?.text).toContain('LSP')
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: '/work/another-app' }); await seen.clock.settle()
  expect(await ui.find({ type: 'Text', text: /Select a file/ })).toBeDefined()
  await ui.unmount()
})

test('deliberate LSP definitions open one target and refusals report feedback', async ($, on) => {
  const seen = await world($, on)
  seen.files['src/other.ts'] += 'export function load() { return 2 }\n'
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  seen.permission('ask', 'Definitions:\nsrc/other.ts:1:17 - other\n')
  await ui.press({ key: 'key-d' })
  await ui.press({ key: 'symbols-row-permission' })
  expect((await ui.find({ key: 'preview-title' }))?.text).toContain('other.ts')
  await ui.press({ key: 'back' }); await ui.press({ key: 'back' })
  seen.permission('ask', 'References:\nsrc/account.ts:1:17 - load\n')
  await ui.press({ key: 'key-r' })
  seen.permission('deny'); await ui.press({ key: 'symbols-row-permission' })
  expect(seen.toasts.some(text => text.includes('LSP request refused'))).toBe(true)
  await ui.unmount()
})

test('repeated focus and boundary scroll do not write Search or Symbols state', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await $.ui.focus(focus('search-row-match-0'))
  const before = seen.writes.length
  await $.ui.focus(focus('search-row-match-0'))
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: -1, bodyRows: 24, contentRows: 20, origin: { kind: 'person' } })
  expect(seen.writes.slice(before).filter(key => key === 'searches' || key === 'pane')).toEqual([])
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  await seen.clock.settle()
  await $.ui.focus(focus('symbols-row-node-0'))
  const symbolsBefore = seen.writes.length
  await $.ui.focus(focus('symbols-row-node-0'))
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: -1, bodyRows: 24, contentRows: 20, origin: { kind: 'person' } })
  expect(seen.writes.slice(symbolsBefore).filter(key => key === 'symbols' || key === 'pane')).toEqual([])
  await ui.unmount()
})

test('an unresolved preview project paints a safe notice instead of failing the whole drawing', async ($, on) => {
  const seen = await world($, on, '//work/acme-app')
  seen.settings.realRoot = '/work/acme-app'
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'search-row-match-0' })
  seen.settings.realRoot = '//work/acme-app'
  await ui.redraw(props())
  expect(await ui.find({ type: 'Text', text: /Cannot determine/ })).toBeDefined()
  expect(seen.calls).toHaveLength(0)
  await ui.unmount()
})
