import { expect, test } from 'claude-code/testing'
import { ROOT, command, props, world } from '../../test/claude-search.ts'

const focus = (element: string) => ({ component: 'Pane' as const, requestId: 'jei', plugin: 'jei', element, origin: { kind: 'person' as const } })

test('leaving a Search or Files input restores tab hotkeys without submitting', async ($, on) => {
  const seen = await world($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(command('search'))
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props() })
    await $.ui.focus(focus('search-query'))
    await ui.input({ key: 'search-query', text: 'load4q', kind: 'change' })
    expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBeUndefined()
    await $.ui.focus(focus('tab-3'))
    expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBe('3')
    await ui.press({ key: 'tab-1' }); await ui.press({ key: 'key-f' })
    await $.ui.focus(focus('filter'))
    expect((await ui.find({ key: 'tab-2' }))?.props.hotkey).toBeUndefined()
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

test('native hot reload resets Search transient flags while retaining query/results', async ($, on) => {
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

test('Search query boundary changes focus once without repeated state writes', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await $.ui.focus(focus('search-row-match-0'))
  const before = seen.writes.length
  await $.ui.focus(focus('search-row-match-0'))
  expect(seen.writes.slice(before).filter(key => key === 'searches' || key === 'pane')).toEqual([])
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: -1, bodyRows: 24, contentRows: 20, origin: { kind: 'person' } })
  expect(seen.writes.slice(before).filter(key => key === 'searches' || key === 'pane')).toEqual(['searches'])
  const focused = seen.writes.length
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: -1, bodyRows: 24, contentRows: 20, origin: { kind: 'person' } })
  expect(seen.writes.slice(focused).filter(key => key === 'searches' || key === 'pane')).toEqual([])
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
