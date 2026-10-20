import { expect, test } from 'claude-code/testing'
import { A, B, C, historyPane, historyWorld, props, select } from './history-fixture.ts'
import { lineWidths, type Node } from './measure.ts'

test('comparison validates a retained file selection against the new files', async ($, on) => {
  const r = await historyWorld($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    r.comparedFiles = null
    const ui = await historyPane($, 40, 10, surface)
    await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
    await select($, ui, 'branch-refs/heads/feature'); await ui.press({ key: 'key-c' })
    await select($, ui, 'compare-file-src/other.ts')
    r.comparedFiles = ['src/replacement.ts']
    await ui.redraw()
    expect((await ui.findAll({ type: 'Text' })).some(node => node.props.inverse === true && node.text.includes('replacement.ts'))).toBe(true)
    await ui.press({ key: 'back' }); await ui.press({ key: 'back' }); await ui.unmount()
  }
})

test('Branches names use semantic current, local and remote colors on both surfaces', async ($, on) => {
  await historyWorld($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, 80, 20, surface)
    await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
    await select($, ui, 'branch-refs/heads/feature')
    let texts = await ui.findAll({ type: 'Text' })
    expect(texts.find(node => node.text.includes('* main'))?.props.color).toBe('suggestion')
    expect(texts.find(node => node.text.includes('origin/main'))?.props.color).toBe('autoAccept')
    await select($, ui, 'branch-refs/heads/main')
    texts = await ui.findAll({ type: 'Text' })
    expect(texts.find(node => node.text.includes('  feature'))?.props.color).toBe('success')
    expect(texts.find(node => node.text.includes('* main'))?.props.inverse).toBe(true)
    expect(texts.find(node => node.text.includes('* main'))?.props.color).toBeUndefined()
    await ui.press({ key: 'back' }); await ui.unmount()
  }
})

test('branches errors and empty rows use semantic Text props and a single period', async ($, on) => {
  const r = await historyWorld($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    r.branchesError = false
    const ui = await historyPane($, 80, 30, surface)
    await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
    r.branchesError = true; await ui.redraw()
    expect((await ui.findAll({ type: 'Text' })).find(n => n.text.trim() === "Can't list branches: Invalid branch.")?.props.color).toBe('error')
    r.branchesError = false; await ui.redraw(); await ui.press({ key: 'key-f' })
    await ui.input({ key: 'branch-filter', text: 'missing', kind: 'submit' })
    expect((await ui.findAll({ type: 'Text' })).find(n => n.text.trim() === 'No branches match this filter.')?.props.dimColor).toBe(true)
    await ui.press({ key: 'key-f' }); await ui.input({ key: 'branch-filter', text: '', kind: 'submit' })
    await ui.press({ key: 'back' }); await ui.unmount()
  }
})

for (const width of [24, 40, 80, 120]) test(`branches switch, create, compare and short resize at ${width}`, async ($, on) => {
  const r = await historyWorld($, on)
  const ui = await historyPane($, width)
  await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
  expect(await ui.find({ key: 'branch-refs/heads/feature' })).toBeDefined()
  expect((await ui.find({ key: 'branch-refs/heads/feature' }))?.text).toContain('gone')
  r.dirty = true
  await ui.press({ key: 'branch-refs/heads/feature' })
  expect(await ui.find({ key: 'history-confirm' })).toBeDefined()
  await ui.press({ key: 'history-cancel' }); expect(r.runs.some((a) => a.includes('switch'))).toBe(false)
  await ui.press({ key: 'key-n' }); await ui.input({ key: 'new-branch', text: 'a..b', kind: 'submit' })
  expect(r.toasts.at(-1)).toBe('Not a valid branch name.')
  await ui.press({ key: 'branch-input-cancel' })
  await select($, ui, 'branch-refs/heads/feature')
  await ui.press({ key: 'key-c' })
  expect((await ui.find({ key: 'compare-heading' }))?.text).toContain('Compared with main')
  await ui.press({ key: 'compare-file-src/user.ts' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('+after')
  await ui.press({ key: 'key-j' }); await ui.press({ key: 'key-k' }); await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'compare-file-src/user.ts' })).toBeDefined()
  await ui.press({ key: 'back' })
  await select($, ui, 'branch-refs/heads/feature'); await ui.redraw(props(width, 5))
  expect(await ui.find({ key: 'branch-refs/heads/feature' })).toBeDefined(); expect(await ui.find({ key: 'hint' })).toBeDefined()
  for (const w of lineWidths(await ui.drawn() as Node)) expect(w).toBeLessThanOrEqual(width)
  await ui.press({ key: 'key-f' }); await ui.input({ key: 'branch-filter', text: 'feature', kind: 'submit' })
  expect(await ui.find({ key: 'branch-refs/heads/main' })).toBeUndefined()
  expect(await ui.find({ key: 'branch-refs/heads/feature' })).toBeDefined()
})

test('compare without main shows the specified notice', async ($, on) => {
  const r = await historyWorld($, on)
  r.base = false
  const ui = await historyPane($, 40)
  await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
  await ui.press({ key: 'key-c' })
  expect(r.toasts.at(-1)).toBe('No main branch to compare with.')
})

for (const surface of ['terminal', 'desktop'] as const) test(`compare preserves the custom remote main base on ${surface}`, async ($, on) => {
  const r = await historyWorld($, on)
  r.originHead = 'refs/remotes/main'; r.remoteRef = 'main'; r.remoteHash = C
  const ui = await historyPane($, 40, 10, surface)
  await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
  await select($, ui, 'branch-refs/heads/feature'); await ui.press({ key: 'key-c' })
  expect(r.runs.some(argv => argv.includes(`${C}...${B}`))).toBe(true)
  expect((await ui.find({ key: 'compare-heading' }))?.text).toContain('Compared with main')
})

for (const surface of ['terminal', 'desktop'] as const) test(`dirty switch suspends and restores the filter within five rows on ${surface}`, async ($, on) => {
  const r = await historyWorld($, on, { dirty: true })
  const ui = await historyPane($, 24, 5, surface)
  await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
  await ui.press({ key: 'key-f' })
  await ui.input({ key: 'branch-filter', text: 'feat', kind: 'change' })
  await select($, ui, 'branch-refs/heads/feature')
  await ui.press({ key: 'branch-refs/heads/feature' })
  const check = async () => {
    const widths = lineWidths(await ui.drawn() as Node)
    expect(widths.length).toBeLessThanOrEqual(5)
    for (const width of widths) expect(width).toBeLessThanOrEqual(24)
    expect(await ui.find({ key: 'branch-refs/heads/feature' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).some((node) => node.props.inverse === true && node.text.includes('feature'))).toBe(true)
    expect(await ui.find({ key: 'hint' })).toBeDefined()
    expect(await ui.find({ key: 'history-confirm' })).toBeDefined()
    expect(await ui.find({ key: 'history-cancel' })).toBeDefined()
    expect(await ui.find({ key: 'branch-filter' })).toBeUndefined()
  }
  await check()
  expect(r.runs.filter((argv) => argv.includes('switch'))).toHaveLength(0)
  await ui.press({ key: 'history-cancel' })
  expect((await ui.find({ key: 'branch-filter' }))?.props.value).toBe('feat')
  expect(r.runs.filter((argv) => argv.includes('switch'))).toHaveLength(0)
  await ui.press({ key: 'branch-refs/heads/feature' })
  await check()
  expect(r.runs.filter((argv) => argv.includes('switch'))).toHaveLength(0)
  await ui.press({ key: 'history-confirm' })
  expect(r.runs.filter((argv) => argv.includes('switch'))).toHaveLength(1)
  expect((await ui.find({ key: 'branch-filter' }))?.props.value).toBe('feat')
  await ui.unmount()
})
