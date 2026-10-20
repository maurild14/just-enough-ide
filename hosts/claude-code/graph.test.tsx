import { expect, test } from 'claude-code/testing'
import { A, B, C, ROOT, historyPane, historyWorld, props, select } from './history-fixture.ts'
import { drawnLine, findKey, lineWidths, type Node } from './measure.ts'

test('merge topology preserves fork connectors and side-lane positions on both surfaces', async ($, on) => {
  const r = await historyWorld($, on); r.topology = true
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, 80, 30, surface)
    expect((await ui.find({ key: `connector-${A}` }))?.text).toBe('├─╮')
    expect(drawnLine(findKey(await ui.drawn() as Node, `graph-${C}`)!)).toContain('│ ● ccccccc')
    await select($, ui, `graph-${C}`); await ui.redraw(props(24, 5))
    expect(await ui.find({ key: `graph-${C}` })).toBeDefined()
    const widths = lineWidths(await ui.drawn() as Node)
    expect(widths.length).toBeLessThanOrEqual(5)
    for (const width of widths) expect(width).toBeLessThanOrEqual(24)
    await ui.unmount()
  }
})

test('clean ahead Graph contexts keep Sync reachable at 40 columns and 24 by five rows', { options: { graphLimit: '1' } }, async ($, on) => {
  const r = await historyWorld($, on); r.upstream = 'origin/main'; r.ahead = 1
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: ROOT }); await r.clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, 40, 30, surface)
    await select($, ui, 'group-graph')
    expect(await ui.find({ key: 'key-e' })).toBeDefined()
    const before = r.runs.filter(a => a.includes('push')).length
    await ui.press({ key: 'key-e' })
    expect(r.runs.filter(a => a.includes('push'))).toHaveLength(before + 1)
    expect(r.runs.filter(a => a.includes('push')).at(-1)?.slice(4)).toEqual(['push'])
    await ui.press({ key: `graph-${A}` })
    for (const id of ['group-graph', 'graph-more', `commit-file-${A}-src/user.ts`, `checkout-${A}`, `revert-${A}`, `web-${A}`]) {
      await select($, ui, id); await ui.redraw(props(24, 5))
      expect(await ui.find({ key: 'key-e' })).toBeDefined()
      for (const key of ['b', 'f', 't']) expect(await ui.find({ key: `key-${key}` })).toBeDefined()
      const widths = lineWidths(await ui.drawn() as Node)
      expect(widths.length).toBeLessThanOrEqual(5)
      for (const width of widths) expect(width).toBeLessThanOrEqual(24)
    }
    const narrowBefore = r.runs.filter(a => a.includes('push')).length
    await ui.press({ key: 'key-e' })
    expect(r.runs.filter(a => a.includes('push'))).toHaveLength(narrowBefore + 1)
    await select($, ui, `graph-${A}`)
    expect(await ui.find({ key: 'key-e' })).toBeUndefined()
    for (const key of ['y', 'a', 'b', 'f', 't', 'n']) expect(await ui.find({ key: `key-${key}` })).toBeDefined()
    await ui.press({ key: `graph-${A}` }); await ui.unmount()
  }
})

test('history errors and empty rows have semantic Text props and a single period', async ($, on) => {
  const r = await historyWorld($, on); r.logError = true
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, 80, 30, surface)
    expect((await ui.findAll({ type: 'Text' })).find(n => n.text === "Can't load history: Invalid branch.")?.props.color).toBe('error')
    await ui.unmount()
  }
  r.logError = false; r.empty = true
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: ROOT }); await r.clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, 80, 30, surface)
    expect((await ui.findAll({ type: 'Text' })).find(n => n.text === 'No commits yet.')?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('web opener ignores returned nonzero exits and surfaces spawn errors on both surfaces', async ($, on) => {
  const r = await historyWorld($, on); r.openerCode = 1
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, 80, 30, surface)
    await ui.press({ key: `graph-${A}` })
    const before = r.toasts.length
    await ui.press({ key: `web-${A}` }); expect(r.toasts).toHaveLength(before)
    r.openerError = true
    await ui.press({ key: `web-${A}` }); expect(r.toasts.at(-1)).toBe('Opener unavailable')
    r.openerError = false
    await ui.press({ key: `graph-${A}` }); await ui.unmount()
  }
})

for (const width of [24, 40, 80, 120]) test(`graph actions, files, back and resize at ${width}`, { timeoutMs: 60000 }, async ($, on) => {
  const r = await historyWorld($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await historyPane($, width, 30, surface)
    await select($, ui, `graph-${A}`)
    expect(await ui.find({ key: `graph-${A}` })).toBeDefined()
    for (const k of ['y', 'a', 'b', 'f', 't', 'n']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
    await ui.press({ key: 'key-y' }); expect(r.copies.at(-1)).toBe(A)
    await ui.press({ key: 'key-a' }); expect(r.fills.at(-1)).toBe('Explain commit aaaaaaa ("feat: add user").')
    const row = drawnLine(findKey(await ui.drawn() as Node, `graph-${A}`)!)
    expect(row).toContain('aaaaaaa')
    if (width === 24) expect(row).not.toContain('v1.0')
    await ui.press({ key: `graph-${A}` })
    await ui.press({ key: `checkout-${A}` })
    expect(await ui.find({ key: 'history-confirm' })).toBeDefined()
    await ui.press({ key: 'history-cancel' })
    r.merge = true
    await ui.press({ key: `revert-${A}` })
    expect(r.toasts.at(-1)).toBe('Reverting a merge commit is not supported.')
    r.merge = false
    await ui.press({ key: `web-${A}` })
    expect(r.runs.some((a) => a.includes(`https://github.com/acme/acme-app/commit/${A}`))).toBe(true)
    await ui.press({ key: `commit-file-${A}-src/user.ts` })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+after')
    await ui.press({ key: 'key-j' }); expect((await ui.find({ key: 'diff-path' }))?.text).toContain('other.ts')
    await ui.press({ key: 'key-k' })
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: `commit-file-${A}-src/user.ts` })).toBeDefined()
    await select($, ui, `graph-${A}`)
    await ui.redraw(props(24, 5))
    expect(await ui.find({ key: `graph-${A}` })).toBeDefined()
    expect(await ui.find({ key: 'hint' })).toBeDefined()
    for (const w of lineWidths(await ui.drawn() as Node)) expect(w).toBeLessThanOrEqual(24)
    await ui.redraw(props(width))
    for (const w of lineWidths(await ui.drawn() as Node)) expect(w).toBeLessThanOrEqual(width)
    await ui.press({ key: `graph-${A}` })
    await ui.unmount()
  }
})

test('graph filtering, paging, confirmations, contextual branch and fetch errors', { options: { graphLimit: '1' } }, async ($, on) => {
  const r = await historyWorld($, on)
  const ui = await historyPane($, 80)
  expect(await ui.find({ key: 'graph-more' })).toBeDefined()
  await ui.press({ key: 'graph-more' }); expect(await ui.find({ key: `graph-${B}` })).toBeDefined()
  await select($, ui, `graph-${A}`)
  r.copy = false; await ui.press({ key: 'key-y' }); expect(r.toasts.at(-1)).toBe('Copy failed: refused.')
  await ui.press({ key: 'key-n' }); expect((await ui.find({ key: 'new-branch' }))?.props.placeholder).toContain('from aaaaaaa')
  await ui.input({ key: 'new-branch', text: 'topic', kind: 'submit' })
  expect(r.runs.some((a) => a.includes('switch') && a.includes('topic') && a.includes(A))).toBe(true)
  await select($, ui, `graph-${A}`); await ui.press({ key: `graph-${A}` })
  await ui.press({ key: `checkout-${A}` })
  expect(await ui.find({ key: 'history-confirm' })).toBeDefined()
  const mutations = r.runs.filter((a) => a.includes('switch')).length
  await ui.press({ key: 'history-cancel' }); expect(r.runs.filter((a) => a.includes('switch')).length).toBe(mutations)
  r.merge = true
  await ui.press({ key: `revert-${A}` }); expect(r.toasts.at(-1)).toBe('Reverting a merge commit is not supported.')
  expect(r.runs.some((a) => a.includes('revert'))).toBe(false)
  await select($, ui, `graph-${A}`); await ui.press({ key: 'key-f' })
  await ui.input({ key: 'graph-filter', text: 'author:leo', kind: 'submit' })
  expect(await ui.find({ key: `graph-${A}` })).toBeUndefined(); expect(await ui.find({ key: `graph-${B}` })).toBeDefined()
  expect((await ui.find({ key: 'group-graph' }))?.text).toContain('filtered')
  await select($, ui, `graph-${B}`); r.fetchError = 'fetch unavailable\nmore detail'
  await ui.press({ key: 'key-t' }); expect(r.toasts.at(-1)).toBe('Fetch failed: fetch unavailable.')
})

test('wide graph metadata shows readable author and relative hours', async ($, on) => {
  const r = await historyWorld($, on)
  r.time -= 3600
  const ui = await historyPane($, 120)
  expect((await ui.find({ key: `graph-${A}` }))?.text).toContain('Ana Rivera 1h ago')
})

test('agent tool commits are marked and state is isolated by session and repository', async ($, on) => {
  const r = await historyWorld($, on)
  r.shell = async () => { r.head = C; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`) }
  await $.tool.call({ tool: 'Bash', command: 'git commit -m feat', description: 'Commit' })
  const ui = await historyPane($, 120)
  expect((await ui.find({ key: `graph-${C}` }))?.text).toContain('✦')
  expect(r.histories[r.session]?.[ROOT]?.agents).toEqual([C])
  r.session = 'another-session'
  await ui.redraw()
  expect((await ui.find({ key: `graph-${C}` }))?.text).not.toContain('✦')
  r.session = 'history-session'; r.root = '/work/other-acme-app'
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: r.root }); await r.clock.settle(); await ui.redraw()
  expect((await ui.find({ key: `graph-${C}` }))?.text).not.toContain('✦')
  r.root = ROOT
  await $.classic.CwdChanged({ old_cwd: '/work/other-acme-app', new_cwd: ROOT }); await r.clock.settle(); await ui.redraw()
  expect((await ui.find({ key: `graph-${C}` }))?.text).toContain('✦')
})

for (const hooks of [false, true]) test(`JEI commit suppresses its shell and overlapping agent windows, hooks=${hooks}`, async ($, on) => {
  const r = await historyWorld($, on, { hooks, dirty: true })
  let release = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  r.shell = async (command) => {
    if (command === 'agent-wait') await pending
    else if (/\scommit\s/.test(command)) { r.head = C; r.dirty = false; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`) }
  }
  const agent = $.tool.call({ tool: 'Bash', command: 'agent-wait', description: 'Wait' })
  await r.clock.settle()
  const ui = await historyPane($, 120)
  await ui.input({ key: 'message', text: 'feat: user change', kind: 'submit' })
  release(); await agent; await r.clock.settle(); await ui.redraw()
  expect(r.head).toBe(C)
  expect((await ui.find({ key: `graph-${C}` }))?.text).not.toContain('✦')
  expect(r.histories[r.session]?.[ROOT]?.agents ?? []).toEqual([])
  if (hooks) expect(r.tools.some((s) => /\scommit\s/.test(s))).toBe(true)
})

test('a standalone hooked JEI commit never marks its own new shell window', async ($, on) => {
  const r = await historyWorld($, on, { hooks: true, dirty: true })
  r.shell = async () => { r.head = C; r.dirty = false; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`) }
  const ui = await historyPane($, 80)
  await ui.input({ key: 'message', text: 'feat: user change', kind: 'submit' })
  expect(r.head).toBe(C)
  expect((await ui.find({ key: `graph-${C}` }))?.text).not.toContain('✦')
  expect(r.histories[r.session]?.[ROOT]?.agents ?? []).toEqual([])
})

test('an agent window starting during a direct JEI mutation is suppressed for its whole interval', async ($, on) => {
  const r = await historyWorld($, on, { dirty: true })
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  r.beforeRun = async (argv) => { if (argv.includes('commit')) await held }
  r.shell = async () => { r.head = C; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`) }
  const ui = await historyPane($, 80)
  const commit = ui.input({ key: 'message', text: 'feat: user change', kind: 'submit' })
  await r.clock.settle()
  expect(r.runs.some((a) => a.includes('commit'))).toBe(true)
  await $.tool.call({ tool: 'Bash', command: 'agent-commit', description: 'Commit' })
  release(); await commit
  expect(r.histories[r.session]?.[ROOT]?.agents ?? []).toEqual([])
})

test('overlapping agent windows are conservative and failed evidence leaves the tool result intact', async ($, on) => {
  const r = await historyWorld($, on)
  let release = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  r.shell = async (command) => {
    if (command === 'first') await pending
    else { r.head = C; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`) }
  }
  const first = $.tool.call({ tool: 'Bash', command: 'first', description: 'First' })
  await r.clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'second', description: 'Second' })
  release(); await first
  expect(r.histories[r.session]?.[ROOT]?.agents ?? []).toEqual([])
  r.evidenceError = true
  const result = await $.tool.call({ tool: 'Bash', command: 'third', description: 'Third' })
  expect(result.text).toBe('ok')
  expect(r.tools).toHaveLength(3)
  expect(r.histories[r.session]?.[ROOT]?.agents ?? []).toEqual([])
})

test('overlap is suppressed even before the first pending baseline has a core token', async ($, on) => {
  const r = await historyWorld($, on)
  await r.clock.settle()
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let reads = 0
  r.beforeRun = async (argv) => { if (argv.includes('rev-parse') && argv.includes('--verify') && ++reads === 1) await held }
  r.shell = async () => { r.head = C; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`) }
  const first = $.tool.call({ tool: 'Bash', command: 'first', description: 'First' })
  await r.clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'second', description: 'Second' })
  expect(r.histories[r.session]?.[ROOT]?.agents ?? []).toEqual([])
  release(); await first
})

test('confirmed history and branch actions use the hook-aware runner, including revert', async ($, on) => {
  const r = await historyWorld($, on, { hooks: true, dirty: true })
  const ui = await historyPane($, 80)
  await ui.press({ key: `graph-${A}` })
  await ui.press({ key: `checkout-${A}` })
  expect(r.tools).toHaveLength(0)
  await ui.press({ key: 'history-confirm' })
  expect(r.tools.at(-1)).toContain('switch --detach --end-of-options ' + A)
  await ui.press({ key: `revert-${A}` }); await ui.press({ key: 'history-confirm' })
  expect(r.tools.at(-1)).toContain('revert --no-edit --end-of-options ' + A)
  await select($, ui, `graph-${A}`); await ui.press({ key: 'key-b' })
  await ui.press({ key: 'branch-refs/heads/feature' }); await ui.press({ key: 'history-confirm' })
  expect(r.tools.at(-1)).toContain('switch --end-of-options feature')
  await ui.press({ key: 'key-n' }); await ui.input({ key: 'new-branch', text: 'topic', kind: 'submit' })
  await ui.redraw(props(24, 5))
  expect(await ui.find({ key: 'history-confirm' })).toBeDefined()
  expect(await ui.find({ key: 'history-cancel' })).toBeDefined()
  await ui.press({ key: 'history-confirm' })
  expect(r.tools.at(-1)).toContain('switch -c topic --end-of-options')
  expect(r.tools.at(-1)).not.toContain(A)
})
