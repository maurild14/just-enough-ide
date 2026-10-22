import { nativeMount } from './measure.ts'
import { expect, test } from 'claude-code/testing'
import { cellWidth } from '../../core/shared/fit.ts'
import { lineWidths, type Node } from './measure.ts'
import type { EngineInterface, On } from 'claude-code'
import { register } from '../../hooks/register.tsx'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [24, 40, 80, 120] as const
const LATER = 'Coming in a later version.'

/** What the engine stamps on a typed `/jei`: the person's Enter, fullscreen at 160 columns. */
function jei(args = '') {
  return { command: 'jei', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
}

function paneProps(bodyColumns: number, bodyRows = 24) {
  return {
    title: 'JEI',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows },
    view: {},
  }
}

test('pane shell: tabs, headers, native tabs and hint on every surface', async ($, on) => {
  on('session.id', () => ({ value: 'pane-test' }))
  for (const surface of SURFACES) {
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    expect(await ui.find({ type: 'Text', text: /1 Files/ })).toBeDefined()

    await ui.press({ key: 'tab-3' })
    expect((await ui.find({ key: 'header' }))?.text.trim()).toBe('Git')
    const hint = await ui.find({ key: 'hint' })
    expect(hint).toBeDefined()
    expect(cellWidth(hint!.text)).toBeLessThanOrEqual(80)

    await ui.press({ key: 'tab-1' })
    expect((await ui.find({ key: 'header' }))?.text.trim()).toBe('Files')
    await ui.press({ key: 'tab-2' })
    expect(await ui.find({ type: 'Text', text: /Type to search the project/ })).toBeDefined()

    await ui.press({ key: 'tab-1' })
    expect(await ui.find({ type: 'Text', text: LATER })).toBeUndefined()
    await ui.unmount()
  }
})

test('the current tab is the primary Button', async ($) => {
  for (const surface of SURFACES) {
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'tab-3' })
    expect((await ui.find({ key: 'tab-3' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'tab-1' }))?.props.variant).not.toBe('primary')
    await ui.unmount()
  }
})

test('no line is wider than the pane at 24, 40, 80 and 120 columns', async ($, on) => {
  on('session.id', () => ({ value: 'pane-test' }))
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width), requestId: 'jei' })
      for (const key of ['tab-1', 'tab-1', 'tab-2', 'tab-3']) {
        await ui.press({ key })
        for (const w of lineWidths((await ui.drawn()) as Node)) expect(w).toBeLessThanOrEqual(width)
        const hint = await ui.find({ key: 'hint' })
        expect(hint).toBeDefined()
        expect(cellWidth(hint!.text)).toBeLessThanOrEqual(width)
      }
      await ui.unmount()
    }
  }
})

test('tab labels shorten with the width', async ($) => {
  for (const surface of SURFACES) {
    const wide = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(120), requestId: 'jei' })
    await wide.press({ key: 'tab-1' })
    expect(await wide.find({ type: 'Text', text: /3 Git/ })).toBeDefined()
    await wide.unmount()

    const mid = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(40), requestId: 'jei' })
    expect(await mid.find({ type: 'Text', text: /1 Files/ })).toBeDefined()
    expect(await mid.find({ type: 'Text', text: /3 Git/ })).toBeUndefined()
    await mid.unmount()

    const narrow = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(24), requestId: 'jei' })
    for (const b of await narrow.findAll({ type: 'Button' })) expect(b.text).toMatch(/^\d$/)
    expect((await narrow.find({ key: 'tab-1' }))?.text).toBe('1')
    await narrow.unmount()
  }
})

test('short panes retain native actions and drop the rule then header', async ($, on) => {
  on('session.id', () => ({ value: 'pane-test' }))
  for (const surface of SURFACES) {
    const tall = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(40, 10), requestId: 'jei' })
    expect(await tall.find({ key: 'hint' })).toBeDefined()
    await tall.press({ key: 'tab-1' }) // a view without letter actions (Search)
    await tall.unmount()
    const short = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(40, 7), requestId: 'jei' })
    expect(await short.find({ key: 'hint' })).toBeDefined()
    expect(await short.find({ key: 'rule' })).toBeUndefined()
    expect(await short.find({ key: 'header' })).toBeDefined()
    await short.unmount()
    const tiny = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(40, 5), requestId: 'jei' })
    expect(await tiny.find({ key: 'header' })).toBeUndefined()
    await tiny.press({ key: 'tab-1' })
    await tiny.unmount()
  }
})

test('Files keeps its letter keys on short panes: a bare hint down to 3 rows', async ($) => {
  for (const surface of SURFACES) {
    for (const rows of [9, 5, 3]) {
      const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80, rows), requestId: 'jei' })
      expect(await ui.find({ key: 'hint' })).toBeDefined()
      expect((await ui.find({ key: 'hint' }))?.text).not.toContain('move')
      await ui.unmount()
    }
    const ui = await nativeMount($)({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80, 2), requestId: 'jei' })
    expect(await ui.find({ key: 'hint' })).toBeUndefined()
    await ui.unmount()
  }
})

test('/jei git opens the pane on Git', async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const r = await $.command.run(jei('git'))
  expect(r.text).toBe('JEI opened on Git.')
  expect(opened).toEqual(['jei'])
})

test('/jei toggles, and /jei <path> opens Files', async ($, on) => {
  let placed = false
  on('ui.open', () => {
    placed = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    placed = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: placed ? [{ id: 'jei', title: 'JEI', isShown: true, isFocused: false, isPlaced: true }] : [] }))

  expect((await $.command.run(jei())).text).toBe('JEI opened.')
  expect((await $.command.run(jei())).text).toBe('JEI closed.')
  expect((await $.command.run(jei('./src/api/user.ts'))).text).toBe('JEI opened on Files.')

  const ui = await nativeMount($)({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80), requestId: 'jei' })
  expect((await ui.find({ key: 'tab-1' }))?.props.variant).toBe('primary')
  await ui.unmount()
})

test('/jei brings a pane that is open behind another forward instead of closing it', async ($, on) => {
  const opens: string[] = []
  on('ui.open', (_$, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    throw new Error('must not close')
  })
  on('ui.panes', () => ({ value: [{ id: 'jei', title: 'JEI', isShown: false, isFocused: false, isPlaced: true }] }))
  expect((await $.command.run(jei())).text).toBe('JEI opened.')
  expect(opens).toEqual(['jei'])
})

// The kit has no engine ui.open call; replay the real registered boundary.
function paneOpening() {
  const hooks: { event: string; matcher: any; run: any; recover?: any }[] = []
  const on = ((event: string, ...args: any[]) => {
    const entry = { event, matcher: typeof args[0] === 'function' ? undefined : args[0], run: args.at(-1) }
    hooks.push(entry)
    return { catch(recover: any) { Object.assign(entry, { recover }) } }
  }) as unknown as On
  register(on, {})
  const shown = { value: true, inspectionFails: false }
  const opened: string[] = []
  const $ = { ui: { panes: async () => { if (shown.inspectionFails) throw new Error('Pane inspection failed.'); return shown.value ? [{ id: 'jei', isShown: true, isPlaced: true }] : [] } } } as unknown as EngineInterface
  const open = async (id: string, plugin = 'cc-plugin-diff', fails = false) => {
    const next = Object.assign(async () => { opened.push(id); if (fails) throw new Error('Open failed.'); return { value: { isPlaced: true } } }, { origin: { plugin, tier: plugin === 'cc-plugin-diff' ? 'builtin' : 'user' } })
    const hook = hooks.find(h => h.event === 'ui.open' && (!h.matcher || h.matcher.id === id))
    if (!hook) return next()
    try { return await hook.run($, { id }, next) }
    catch (error) { if (hook.recover) return hook.recover($, { id }, next); throw error }
  }
  const manual = async (run: () => Promise<unknown>) => {
    const hook = hooks.find(h => h.event === 'command.run' && h.matcher?.command === 'diff')
    return hook ? hook.run($, { command: 'diff', origin: { kind: 'composer' } }, run) : run()
  }
  return { shown, opened, open, manual }
}

test('automatic diff panes cannot cover a shown JEI pane', async () => {
  const f = paneOpening(), result = await f.open('diff')
  expect(f.opened).toEqual([])
  expect(result.value.isPlaced).toBe(false)
})

test('manual diff and other panes still open, and a closed JEI does not block diff', async () => {
  const f = paneOpening()
  await f.manual(() => f.open('diff'))
  await f.open('help')
  f.shown.value = false
  await f.open('diff')
  expect(f.opened).toEqual(['diff', 'help', 'diff'])
})

test('a different plugin can open its own namespaced diff pane', async () => {
  const f = paneOpening()
  await f.open('diff', 'notes')
  expect(f.opened).toEqual(['diff'])
})

test('failed pane inspection passes through, and a failed open is never repeated', async () => {
  const f = paneOpening()
  f.shown.inspectionFails = true
  await f.open('diff')
  f.shown.inspectionFails = false
  await expect(f.manual(() => f.open('diff', 'cc-plugin-diff', true))).rejects.toThrow('Open failed.')
  expect(f.opened).toEqual(['diff', 'diff'])
  await f.open('diff')
  expect(f.opened).toEqual(['diff', 'diff'])
})

test('/jei says why when the pane cannot be shown', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  expect((await $.command.run(jei('git'))).text).toBe('JEI is open but not shown yet: no-surface.')
})

test('/jei <path> reveals paths inside the project and refuses the rest', async ($, on) => {
  // The test's $ has no state noun: watch the plugin's writes as they pass beneath it.
  const written: Record<string, unknown> = {}
  on('state.set', (_$, e, next) => {
    written[e.key] = e.value
    return next(e)
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('classic.CwdChanged', () => ({}))
  await $.classic.CwdChanged({ old_cwd: '/work', new_cwd: '/work/acme-app' })

  expect((await $.command.run(jei('/work/acme-app/src/api/user.ts'))).text).toBe('JEI opened on Files.')
  expect((written.tree as { expanded: string[] }).expanded).toEqual(['src', 'src/api'])
  const pane = written.pane as { tab: string; selected: { files?: string } }
  expect(pane.tab).toBe('files')
  expect(pane.selected.files).toBe('src/api/user.ts')

  for (const key of Object.keys(written)) delete written[key]
  for (const outside of ['/etc/passwd', '../other/x.ts', 'src/../../x.ts']) {
    expect((await $.command.run(jei(outside))).text).toBe('That path is outside the project.')
  }
  expect(written).toEqual({})
})
