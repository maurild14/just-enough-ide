import { nativeMount } from './measure.ts'
import { expect, test } from 'claude-code/testing'
import { ROOT, command, props, world } from '../../test/claude-search.ts'
import { findKey, lineWidths, type Node } from './measure.ts'

const focus = (element: string) => ({ component: 'Pane' as const, requestId: 'jei', plugin: 'jei', element, origin: { kind: 'person' as const } })

test('programmatic Clear remounts an empty-seeded native input so local text is actually cleared', async ($, on) => {
  await world($, on)
  for (const tab of ['files', 'search']) {
    await $.command.run(command(tab))
    const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
    const key = tab === 'files' ? 'filter' : 'search-query'
    await $.ui.focus(focus(key))
    const before = (await ui.find({ key }))!.key
    await ui.input({ key, text: 'user', kind: 'change' })
    await ui.press({ key: `${tab}-clear` })
    const field = (await ui.findAll({ type: 'Input' }))[0]!
    expect(field.key).not.toBe(before)
    expect(field.props.value).toBe('')
    await ui.unmount()
  }
})

test('native editing keeps the input seed stable while persisting the latest whole text', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await $.ui.focus(focus('search-query'))
  for (const text of ['f', 'fe', 'feat: comment the menu renderer']) {
    await ui.input({ key: 'search-query', text, kind: 'change' })
    expect((await ui.find({ key: 'search-query' }))?.props.value).toBe('')
  }
  expect(JSON.stringify(seen.states.searches)).toContain('feat: comment the menu renderer')
  await $.ui.focus(focus('tab-1'))
  expect((await ui.find({ key: 'search-query' }))?.props.value).toBe('feat: comment the menu renderer')
  await ui.unmount()
})

test('Search edit requests focus on the mounted editor rather than its preceding drawing', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'key-f' })
  expect((await ui.find({ key: 'search-query' }))?.props.autoFocus).toBe(true)
  // Editing must retain arrow routing even when the result list fits the viewport.
  expect(await ui.find({ key: 'arrow-scroll-range' })).toBeDefined()
  await ui.unmount()
})

for (const tab of ['files', 'search'] as const) test(`${tab} editor controls retain focus and geometry until activated`, { timeoutMs: 60_000 }, async ($, on) => {
  await world($, on)
  const input = tab === 'files' ? 'filter' : 'search-query', field = tab === 'files' ? 'files-search-field' : 'search-field'
  for (const surface of ['terminal', 'desktop'] as const) for (const width of [24, 40, 80, 120]) {
    await $.command.run(command(tab))
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props(width, 5) })
    for (const control of ['cancel', 'clear']) {
      await $.ui.focus(focus(input)); await ui.input({ key: input, text: 'other', kind: 'change' })
      const before = findKey(await ui.drawn() as Node, field)
      expect(before).toBeDefined()
      await $.ui.focus(focus(`${tab}-${control}`))
      expect(await ui.find({ key: `${tab}-cancel` })).toBeDefined()
      expect(findKey(await ui.drawn() as Node, field)).toEqual(before)
      expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBeUndefined()
      const widths = lineWidths(await ui.drawn() as Node)
      expect(widths.length).toBeLessThanOrEqual(5)
      for (const drawn of widths) expect(drawn).toBeLessThanOrEqual(width)
      await ui.press({ key: `${tab}-${control}` })
      if (control === 'cancel') {
        expect(await ui.find({ key: `${tab}-cancel` })).toBeUndefined()
        expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBe('3')
      }
      expect((await ui.find({ key: input }))?.props.value).toBe(control === 'cancel' ? 'other' : '')
    }
    await ui.unmount()
  }
})

test('Files arrows leave query editing on the highlighted result before moving', async ($, on) => {
  const seen = await world($, on)
  for (let i = 0; i < 3; i++) seen.files[`src/alpha-${i}.ts`] = 'sample'
  const selected = () => (seen.states.pane as { selected: { files: string } }).selected.files
  const scroll = (by: number) => $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by, bodyRows: 5, contentRows: 20, origin: { kind: 'person' } })
  for (const surface of ['terminal', 'desktop'] as const) for (const width of [24, 40, 80, 120]) {
    await $.command.run(command('files'))
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props(width, 5) })
    await ui.input({ key: 'filter', text: 'alpha', kind: 'change' })
    expect(selected()).toBe('src/alpha-0.ts')
    await scroll(1); expect(selected()).toBe('src/alpha-0.ts')
    expect((await ui.find({ key: 'tab-3' }))?.props.hotkey).toBe('3')
    await scroll(1); expect(selected()).toBe('src/alpha-1.ts')
    await $.ui.focus(focus('filter'))
    await scroll(-1); expect(selected()).toBe('src/alpha-1.ts')
    await scroll(-1); expect(selected()).toBe('src/alpha-0.ts')
    await ui.press({ key: 'files-clear' }); await ui.unmount()
  }
})

test('a late native Cancel focus after Down is routed to the selected filename result', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('files'))
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'filter', text: 'account', kind: 'change' })
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: 1, bodyRows: 24, contentRows: 25, origin: { kind: 'person' } })
  await $.ui.focus(focus('files-cancel'))
  expect(seen.focuses.at(-1)).toBe('row-src/account.ts')
  await ui.unmount()
})

test('leaving a Search or Files input restores tab hotkeys without submitting', async ($, on) => {
  const seen = await world($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(command('search'))
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props() })
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
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
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

test('Search mention uses the highlighted result after submitting another query', async ($, on) => {
  const seen = await world($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(command('search'))
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props() })
    await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
    await $.ui.focus(focus('search-row-match-1'))
    await ui.input({ key: 'search-query', text: 'save', kind: 'submit' }); await seen.clock.advance(300)
    expect((seen.states.pane as { selected: { search: string } }).selected.search).toBe('match-0')
    await ui.press({ key: 'key-a' })
    expect(seen.fillInputs.at(-1)).toEqual({ text: 'src/account.ts:2 (return save())', mode: 'insert' })
    await ui.unmount()
  }
})

test('Search Mention command uses the first result after a delayed new query', { timeoutMs: 15_000 }, async ($, on) => {
  const seen = await world($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(command('search'))
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props(24) })
    await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
    await $.ui.focus(focus('search-row-match-1'))
    seen.settings.slow = true; seen.settings.slowQuery = 'save'
    await ui.input({ key: 'search-query', text: 'save', kind: 'submit' }); await seen.clock.advance(150)
    expect((seen.states.searches as Record<string, { busy: boolean }>)[ROOT]!.busy).toBe(true)
    await seen.clock.advance(3000); seen.settings.slow = false
    expect((seen.states.searches as Record<string, { busy: boolean }>)[ROOT]!.busy).toBe(false)
    expect((seen.states.pane as { selected: { search: string } }).selected.search).toBe('match-0')
    expect(await ui.find({ key: 'search-row-command-mention' })).toBeDefined()
    await $.ui.focus(focus('search-row-command-mention')); await ui.press({ key: 'search-row-command-mention' })
    expect(seen.fillInputs.at(-1)).toEqual({ text: 'src/account.ts:2 (return save())', mode: 'insert' })
    await ui.unmount()
  }
})

test('Quick Open mention uses the highlighted file after its ranking changes', async ($, on) => {
  const seen = await world($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(command('search'))
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props() })
    await ui.press({ key: 'search-cancel' }); await ui.press({ key: 'key-q' })
    await ui.input({ key: 'search-query', text: '', kind: 'change' }); await ui.press({ key: 'search-cancel' })
    await $.ui.focus(focus('search-row-file-0'))
    await ui.input({ key: 'search-query', text: 'other', kind: 'change' }); await ui.press({ key: 'search-cancel' })
    expect((await ui.find({ key: 'search-row-file-0' }))?.text).toContain('other.ts')
    await ui.press({ key: 'key-a' })
    expect(seen.fillInputs.at(-1)).toEqual({ text: '@src/other.ts ', mode: 'insert' })
    await ui.unmount()
  }
})

test('Search retains its query/results across Quick Open and quick submit ranks its actual value', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(command('search'))
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
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
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props(24, 5) })
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
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
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
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
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
  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: props() })
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await ui.press({ key: 'search-row-match-0' })
  seen.settings.realRoot = '//work/acme-app'
  await ui.redraw(props())
  expect(await ui.find({ type: 'Text', text: /Cannot determine/ })).toBeDefined()
  expect(seen.calls).toHaveLength(0)
  await ui.unmount()
})
