import { expect, test } from 'claude-code/testing'
import { ROOT, command, props, world } from '../../test/claude-search.ts'
import { lineWidths, type Node } from './measure.ts'

test('native Symbols outline, source labels, definition, references, calls, send and preview Back', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  expect((await ui.find({ key: 'header' }))?.text).toContain('approximate')
  expect(await ui.find({ key: 'symbols-row-node-0' })).toBeDefined()
  await ui.press({ key: 'key-r' })
  expect((await ui.find({ key: 'header' }))?.text).toContain('References')
  await ui.press({ key: 'key-a' }); expect(seen.fills[0]).toContain('load')
  await ui.press({ key: 'back' }); await ui.press({ key: 'key-c' })
  expect(await ui.find({ key: 'symbols-row-callers' })).toBeDefined()
  await ui.press({ key: 'symbols-row-calls' })
  expect(await ui.find({ type: 'Text', text: /save/ })).toBeDefined()
  await ui.press({ key: 'back' }); await ui.press({ key: 'key-d' })
  expect(await ui.find({ key: 'preview-line-1' })).toBeDefined()
  await ui.press({ key: 'back' })
  for (const width of [24, 40, 80, 120]) { await ui.redraw(props(width, 5)); for (const n of lineWidths(await ui.drawn() as Node)) expect(n).toBeLessThanOrEqual(width) }
  await ui.unmount()
})

test('ask shows deliberate LSP action; each request checks its verified identifier location', async ($, on) => {
  const seen = await world($, on)
  seen.permission('ask', 'Document symbols:\nload (function) src/account.ts:1:17-3:1\n')
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  expect(await ui.find({ key: 'symbols-use-lsp' })).toBeDefined()
  expect(seen.calls).toHaveLength(0)
  await ui.press({ key: 'symbols-use-lsp' })
  expect((await ui.find({ key: 'header' }))?.text).toContain('LSP')
  seen.permission('deny')
  await ui.press({ key: 'key-r' })
  expect(seen.calls).toHaveLength(1)
  expect(seen.checks).toContainEqual({ operation: 'findReferences', filePath: `${ROOT}/src/account.ts`, line: 1, character: 17 })
  expect((await ui.find({ key: 'header' }))?.text).toContain('approximate')
  await ui.unmount()
})

test('synthetic allowed LSP output labels the actual list; unknown output falls back', async ($, on) => {
  const seen = await world($, on)
  seen.permission('allow', 'Document symbols:\nload (function) src/account.ts:1:17-3:1\n')
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'desktop', component: 'Pane', requestId: 'jei', props: props() })
  expect((await ui.find({ key: 'header' }))?.text).toContain('LSP')
  expect(seen.calls).toHaveLength(1)
  seen.permission('allow', 'unrecognized output')
  await ui.press({ key: 'key-r' })
  expect((await ui.find({ key: 'header' }))?.text).toContain('approximate')
  expect(seen.calls).toHaveLength(2)
  expect(seen.checks).toHaveLength(2)
  await ui.unmount()
})

test('Find symbol editors and source labels survive the native surface and compact-size matrix', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props() })
    await ui.press({ key: 'key-f' })
    await ui.input({ key: 'symbols-find', text: 'qxw1234', kind: 'change' })
    expect((await ui.find({ key: 'tab-2' }))?.props.hotkey).toBeUndefined()
    expect(await ui.find({ key: 'key-c' })).toBeUndefined()
    for (const width of [24, 40, 80, 120]) {
      await ui.redraw(props(width, 5))
      expect(await ui.find({ key: 'symbols-find' })).toBeDefined()
      expect(await ui.find({ key: 'symbols-cancel' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /approximate/ })).toBeDefined()
      const widths = lineWidths(await ui.drawn() as Node)
      expect(widths.length).toBeLessThanOrEqual(5); for (const n of widths) expect(n).toBeLessThanOrEqual(width)
    }
    await ui.redraw(props())
    await ui.input({ key: 'symbols-find', text: 'load', kind: 'submit' }); await seen.clock.settle()
    expect((await ui.find({ key: 'header' }))?.text).toContain('Symbols: load')
    expect(await ui.find({ key: 'symbols-row-ref-0' })).toBeDefined()
    await ui.press({ key: 'back' }); await ui.unmount()
  }
})

test('expanding a call child resolves the child file and verified identifier for the fresh LSP check', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.press({ key: 'key-c' }); await ui.press({ key: 'symbols-row-calls' })
  await ui.press({ key: 'symbols-row-calls/0' })
  expect(seen.checks).toContainEqual({ operation: 'outgoingCalls', filePath: `${ROOT}/src/account.ts`, line: 4, character: 17 })
  const keys = (await ui.findAll({ type: 'Button' })).map(row => row.key)
  expect(keys.filter(key => key === 'symbols-row-calls/0')).toHaveLength(1)
  await ui.unmount()
})

test('Cancel during a pending native workspace permission check cannot restore results or call LSP', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  seen.permission('allow'); seen.settings.holdWorkspace = true
  await ui.press({ key: 'key-f' }); await ui.input({ key: 'symbols-find', text: 'load', kind: 'submit' })
  await ui.press({ key: 'symbols-cancel' }); await seen.clock.advance(1200)
  expect((await ui.find({ key: 'header' }))?.text).toContain('Outline')
  expect(await ui.find({ key: 'symbols-row-ref-0' })).toBeUndefined()
  expect(seen.calls).toHaveLength(0)
  await ui.unmount()
})
