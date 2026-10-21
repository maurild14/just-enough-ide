import { expect, test, type Mounted } from 'claude-code/testing'
import { historyPane, historyWorld, props as historyProps, select } from './history-fixture.ts'
import { ROOT, command, props, world } from '../../test/claude-search.ts'
import type { Node } from './measure.ts'

type Ui = Mounted<'terminal' | 'desktop', 'Pane'>

async function scrollRange(ui: Ui, rows: number) {
  // The native host chooses scroll events over focus-ring arrows only for an overflowing tree.
  expect(((await ui.drawn()) as Exclude<Node, string>).props?.height).toBe(rows + 1)
  expect((await ui.find({ key: 'pane-viewport' }))?.props.height).toBe(rows)
  expect((await ui.find({ key: 'arrow-scroll-range' }))?.props.height).toBe(1)
  expect(await ui.find({ key: 'hint' })).toBeDefined()
}

for (const surface of ['terminal', 'desktop'] as const) test(`Graph arrows cross the visible boundary with pinned clickable hints on ${surface}`, { timeoutMs: 60_000 }, async ($, on) => {
  const r = await historyWorld($, on)
  r.logHashes = Array.from({ length: 80 }, (_, i) => (i + 1).toString(16).padStart(40, '0'))
  for (const width of [24, 40, 80, 120]) for (const rows of [5, 10, 24]) {
    const ui = await historyPane($, width, rows, surface)
    await scrollRange(ui, rows)
    await select($, ui, `graph-${r.logHashes[0]}`)
    const visible = (await ui.findAll({ type: 'Button' })).filter(button => /^graph-[a-f0-9]{40}$/.test(button.key ?? ''))
    const last = visible.at(-1)!.key!
    await select($, ui, last)
    const index = r.logHashes.indexOf(last.slice(6))
    await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: 1, bodyRows: rows, contentRows: rows + 1, origin: { kind: 'person' } })
    expect(await ui.find({ key: `graph-${r.logHashes[index + 1]}` })).toBeDefined()
    await ui.press({ key: 'key-y' })
    expect(r.copies.at(-1)).toBe(r.logHashes[index + 1])
    await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: -1, bodyRows: rows, contentRows: rows + 1, origin: { kind: 'person' } })
    expect(await ui.find({ key: last })).toBeDefined()
    await ui.unmount()
  }
})

test('Branches, comparison and diff retain native arrow scrolling at five rows', async ($, on) => {
  await historyWorld($, on)
  const ui = await historyPane($, 40, 5)
  await ui.press({ key: 'key-b' }); await scrollRange(ui, 5)
  await ui.press({ key: 'key-c' }); await scrollRange(ui, 5)
  await ui.press({ key: 'compare-file-src/user.ts' }); await scrollRange(ui, 5)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`Search, Quick Open, source preview and Symbols keep native arrow scrolling on ${surface}`, async ($, on) => {
  let passedScrolls = 0
  on('ui.scroll', () => { passedScrolls++; return {} })
  const seen = await world($, on)
  seen.files['src/account.ts'] = Array.from({ length: 160 }, (_, i) => `export function load${i}() { return ${i} }`).join('\n')
  for (let i = 0; i < 80; i++) seen.files[`src/file-${i}.ts`] = 'export const value = 1\n'
  await $.command.run(command('search'))
  const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props(40, 10) })
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'search-query', origin: { kind: 'person' } })
  expect(await ui.find({ key: 'back-row' })).toBeUndefined()
  expect(await ui.find({ key: 'search-cancel' })).toBeDefined()
  await ui.input({ key: 'search-query', text: 'load', kind: 'submit' }); await seen.clock.advance(300)
  await scrollRange(ui, 10)
  const last = (await ui.findAll({ type: 'Button' })).filter(button => /^search-row-match-\d+$/.test(button.key ?? '')).at(-1)!.key!
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: last, origin: { kind: 'person' } })
  const next = `search-row-match-${Number(last.slice('search-row-match-'.length)) + 1}`
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: 1, bodyRows: 10, contentRows: 11, origin: { kind: 'person' } })
  expect(await ui.find({ key: next })).toBeDefined()
  await ui.press({ key: next }); await scrollRange(ui, 10)
  await ui.press({ key: 'back' }); await ui.press({ key: 'key-q' }); await scrollRange(ui, 10)
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 1, by: 1, bodyRows: 10, contentRows: 11, origin: { kind: 'person' } })
  expect(passedScrolls).toBe(0)
  await $.command.run(command(`${ROOT}/src/account.ts`)); await $.command.run(command('symbols')); await seen.clock.settle()
  await scrollRange(ui, 10)
  await ui.redraw({ ...historyProps(40, 5), isFocused: true }); await scrollRange(ui, 5)
  await ui.unmount()
})

test('a short list keeps its natural inline height without a synthetic scroll range', async ($, on) => {
  await world($, on)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', requestId: 'jei', props: { ...props(80), placement: 'inline' } })
  expect(await ui.find({ key: 'arrow-scroll-range' })).toBeUndefined()
  expect(((await ui.drawn()) as Exclude<Node, string>).props?.height).toBeUndefined()
  await ui.unmount()
})
