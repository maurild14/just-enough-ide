import { expect, test } from 'claude-code/testing'
import { command, props, world } from '../../test/claude-search.ts'
import { lineWidths, type Node } from './measure.ts'

test('Search native input streams, toggles argv, hands text and returns from a marked preview', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'change' }); await seen.clock.advance(300)
  expect(await ui.find({ key: 'search-row-match-0' })).toBeDefined()
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' })
  await ui.press({ key: 'key-c' }); await seen.clock.advance(300)
  expect(seen.runs.some(a => a.includes('-s') && a.includes('load'))).toBe(true)
  await ui.press({ key: 'key-a' })
  expect(seen.fills[0]).toBe('src/account.ts:1 (export function load() {)')
  await ui.press({ key: 'key-s' })
  expect(seen.fills[1]).toContain('src/account.ts:1')
  await ui.press({ key: 'search-row-match-0' })
  expect(await ui.find({ key: 'preview-line-1' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'search-row-match-0' })).toBeDefined()
  for (const width of [24, 40, 80, 120]) {
    await ui.redraw(props(width, 5))
    expect(await ui.find({ key: 'hint' })).toBeDefined()
    expect(await ui.find({ key: 'search-query' })).toBeDefined()
    const widths = lineWidths(await ui.drawn() as Node)
    expect(widths.length).toBeLessThanOrEqual(5)
    for (const n of widths) expect(n).toBeLessThanOrEqual(width)
  }
  await ui.unmount()
})

test('replacement reviews a native diff, confirms, refuses changed snapshots and refreshes written files', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'key-p' })
  await ui.input({ key: 'search-replacement', text: 'fetch', kind: 'submit' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.press({ key: 'key-a' })
  expect(seen.fills[0]).toBe('Replace "load" with "fetch" in: src/account.ts:1, src/other.ts:1')
  await ui.press({ key: 'replace-apply' })
  expect((await ui.find({ key: 'replace-question' }))?.text).toContain('Replace 1 matches in src/account.ts?')
  expect(seen.files['src/account.ts']).toContain('load')
  seen.files['src/account.ts'] += '// changed\n'
  await ui.press({ key: 'replace-confirm' })
  expect(await ui.find({ type: 'Text', text: /changed/ })).toBeDefined()
  await ui.press({ key: 'key-y' }); await ui.press({ key: 'replace-confirm' })
  expect(seen.files['src/other.ts']).toContain('fetch')
  await ui.unmount()
})

test('typing cancels an active native stream, batches its early rows and suppresses its late rows', async ($, on) => {
  const seen = await world($, on); seen.settings.slow = true
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'change' })
  await seen.clock.advance(150)
  expect(await ui.find({ key: 'search-row-match-0' })).toBeUndefined()
  await seen.clock.advance(100)
  expect((await ui.find({ key: 'search-row-match-0' }))?.text).toContain('load')
  await ui.input({ key: 'search-query', text: 'save', kind: 'change' })
  await seen.clock.advance(300)
  expect((await ui.find({ key: 'search-row-match-0' }))?.text).toContain('save')
  await seen.clock.advance(1200)
  expect(seen.settings.closed).toBeGreaterThanOrEqual(2)
  expect((await ui.find({ key: 'search-row-match-0' }))?.text).toContain('save')
  expect(await ui.find({ type: 'Text', text: /Searching/ })).toBeUndefined()
  await ui.unmount()
})

test('native toggles and filters reach shared argv; no rg outside a repository shows installation help', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'desktop', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: '-rf', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'key-x' }); await ui.press({ key: 'key-w' }); await ui.press({ key: 'key-i' })
  await ui.input({ key: 'search-globs', text: 'src/** !**/*.test.ts', kind: 'submit' }); await seen.clock.advance(300)
  const argv = seen.runs[seen.runs.length - 1]!
  expect(argv).toContain('-w'); expect(argv).not.toContain('-F')
  expect(argv).toContain('src/**'); expect(argv).toContain('!**/*.test.ts')
  expect(argv.slice(-2)).toEqual(['-e', '-rf'])
  seen.settings.missing = true; seen.settings.repo = false
  await ui.input({ key: 'search-query', text: 'missing', kind: 'submit' }); await seen.clock.advance(300)
  expect((await ui.find({ key: 'search-notice' }))?.text).toContain('ripgrep (rg) is not installed')
  await ui.unmount()
})

test('all native Search commands remain reachable through scroll at 24 columns and five rows', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props(24, 5) })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  const found = new Set<string>()
  for (let i = 0; i < 16; i++) {
    for (const row of await ui.findAll({ type: 'Button' })) if (row.key?.startsWith('search-row-command-')) found.add(row.key)
    await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: 1, bodyRows: 5, contentRows: 20, origin: { kind: 'person' } })
    const widths = lineWidths(await ui.drawn() as Node)
    expect(widths.length).toBeLessThanOrEqual(5)
    for (const n of widths) expect(n).toBeLessThanOrEqual(24)
  }
  for (const action of ['mention', 'send-all', 'toggle-case', 'toggle-regex', 'toggle-word', 'include', 'replace', 'quickopen']) expect(found.has(`search-row-command-${action}`)).toBe(true)
  await ui.press({ key: 'search-row-command-quickopen' })
  expect((await ui.find({ key: 'search-query' }))?.props.placeholder).toBe('Go to file')
  await ui.unmount()
})

test('Quick Open accepts a line and keeps editor letters and digits as text', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props(24, 5) })
  await ui.input({ key: 'search-query', text: 'qxw1234', kind: 'change' })
  expect((await ui.find({ key: 'tab-2' }))?.props.hotkey).toBeUndefined()
  await ui.input({ key: 'search-query', text: '', kind: 'submit' }); await seen.clock.advance(300)
  await ui.redraw(props())
  await ui.press({ key: 'key-q' })
  await ui.input({ key: 'search-query', text: 'account:42', kind: 'submit' })
  expect((await ui.find({ key: 'preview-title' }))?.text).toContain('account.ts')
  expect(await ui.find({ key: 'preview-line-4' })).toBeDefined()
  await ui.unmount()
})

test('unresolved double-slash projects refuse new Search and Symbols operations before any process or LSP request', async ($, on) => {
  const seen = await world($, on, '//work/acme-app')
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  expect((await ui.find({ key: 'search-notice' }))?.text).toContain('Cannot determine')
  expect(seen.runs.filter(argv => argv[0] === 'rg')).toHaveLength(0)
  await ui.press({ key: 'tab-3' })
  expect(await ui.find({ type: 'Text', text: /Cannot determine/ })).toBeDefined()
  expect(seen.checks).toHaveLength(0); expect(seen.calls).toHaveLength(0)
  await ui.unmount()
})

test('canonical POSIX evidence permits double-slash Search without treating case-distinct paths as UNC', async ($, on) => {
  const seen = await world($, on, '//work/acme-app'); seen.settings.realRoot = '/work/acme-app'
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  expect(await ui.find({ key: 'search-row-match-0' })).toBeDefined()
  await ui.unmount()
})

test('native Quick Open puts touched files before recent files at five rows', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'search-row-match-0' }); await ui.press({ key: 'back' })
  await $.tool.call({ tool: 'Read', file_path: '/work/acme-app/src/other.ts' } as never); await seen.clock.settle()
  await ui.press({ key: 'key-q' }); await ui.redraw(props(40, 5))
  expect((await ui.find({ key: 'search-row-file-0' }))?.text).toContain('other.ts')
  expect((await ui.find({ key: 'search-row-file-1' }))?.text).toContain('account.ts')
  await ui.unmount()
})

test('CSV line targets show marked source and replacement failures report already written files', async ($, on) => {
  const seen = await world($, on); seen.files['data.csv'] = 'name,value\nload,1\n'
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'desktop', component: 'Pane', requestId: 'jei', props: props() })
  await ui.press({ key: 'search-cancel' }); await ui.press({ key: 'key-q' })
  await ui.input({ key: 'search-query', text: 'data.csv:2', kind: 'submit' })
  expect((await ui.find({ key: 'preview-line-2' }))?.text).toContain('›')
  expect((await ui.find({ type: 'Code' }))?.text).toContain('load,1')
  await ui.press({ key: 'back' }); await ui.press({ key: 'key-q' })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'key-p' }); await ui.input({ key: 'search-replacement', text: 'fetch', kind: 'submit' })
  for (const width of [24, 40, 80, 120]) for (const height of [5, 24]) {
    await ui.redraw(props(width, height)); const widths = lineWidths(await ui.drawn() as Node)
    expect(widths.length).toBeLessThanOrEqual(height); for (const n of widths) expect(n).toBeLessThanOrEqual(width)
  }
  seen.settings.failWrite = 'src/other.ts'
  await ui.press({ key: 'key-y' }); await ui.press({ key: 'replace-confirm' })
  expect(seen.files['src/account.ts']).toContain('fetch')
  expect(seen.files['src/other.ts']).toContain('load')
  expect(seen.toasts.some(text => text.includes('Replaced 1 matches in 1 files.') && text.includes('Read-only file'))).toBe(true)
  await ui.unmount()
})
