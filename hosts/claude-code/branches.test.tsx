import { expect, test } from 'claude-code/testing'
import { A, historyPane, historyWorld, props, select } from './history-fixture.ts'
import { lineWidths, type Node } from './measure.ts'

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
