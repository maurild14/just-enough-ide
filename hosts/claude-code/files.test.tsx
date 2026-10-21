import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { drawnLine, findKey, lineWidths, type Node } from './measure.ts'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [24, 40, 80, 120] as const
const ROOT = '/work/acme-app'
/** A source file whose lines are far wider than any pane. */
const WIDE_TS = Array.from({ length: 40 }, (_, i) => `export const value${i} = '${'x'.repeat(200)}'`).join('\n') + '\n'
const USER_TS = 'export async function getUser(id: string) {\n  return { id }\n}\n'

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number }
const dir = (name: string): Entry => ({ name, kind: 'dir', size: 0 })
const file = (name: string, size = 10): Entry => ({ name, kind: 'file', size })

/** The sample repo's folders, by absolute path. */
const TREE: Record<string, Entry[]> = {
  [ROOT]: [file('README.md', 20), file('.env'), dir('src'), file('people.csv', 40), file('logo.bin', 64), dir('docs'), file('big.log', 5 * 1024 * 1024), file('empty.txt', 0)],
  [`${ROOT}/src`]: [dir('api'), file('index.ts')],
  [`${ROOT}/src/api`]: [file('user.ts', USER_TS.length), file('run.sh', 20), file('wide.ts', WIDE_TS.length)],
  [`${ROOT}/docs`]: [],
}
const CONTENT: Record<string, string> = {
  [`${ROOT}/README.md`]: '# acme-app\n\nThe sample app.\n',
  [`${ROOT}/src/api/user.ts`]: USER_TS,
  [`${ROOT}/src/api/wide.ts`]: WIDE_TS,
  [`${ROOT}/src/api/run.sh`]: '#!/bin/sh\necho hi\n',
  [`${ROOT}/people.csv`]: 'name,email\nAna Rivera,ana@example.com\nLeo Park,leo@example.com\n',
  [`${ROOT}/logo.bin`]: 'PNG\u0000\u0001\u0002',
}
/** The kit hands $.fs native absolute paths (a drive letter on Windows); the fixtures are posix. */
const posix = (p: string) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

const FILES = ['README.md', 'people.csv', 'logo.bin', 'big.log', 'empty.txt', 'src/index.ts', 'src/api/user.ts']

test('repeated Files focus and boundary scroll leave selection state unchanged', async ($, on) => {
  const writes: string[] = []
  on('state.set', (_$, e, next) => { writes.push(e.key); return next(e) })
  on('ui.focus', () => ({}))
  await world($, on)
  const ui = await mountAt($)
  const focus = { component: 'Pane' as const, requestId: 'jei', plugin: 'jei', element: 'row-docs', origin: { kind: 'person' as const } }
  await $.ui.focus(focus)
  const before = writes.length
  await $.ui.focus(focus)
  await $.ui.scroll({ component: 'Pane', requestId: 'jei', offset: 0, by: -1, bodyRows: 24, contentRows: 30, origin: { kind: 'person' } })
  expect(writes.slice(before).filter(key => key === 'pane' || key === 'tick')).toEqual([])
  await ui.unmount()
})

function paneProps(bodyColumns: number, bodyRows = 24) {
  return { title: 'JEI', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} }
}

function jei(args: string) {
  return { command: 'jei', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
}

/** Answers the files, git and the session beneath the plugin. Returns the calls it saw. */
async function world($: Engine, on: On) {
  on('session.id', () => ({ value: 'files-test-session' }))
  const lists: string[] = []
  const runs: string[][] = []
  const fills: { text: string; mode?: string }[] = []
  const toasts: string[] = []
  on('fs.list', (_$, e) => {
    const path = posix(e.path)
    lists.push(path)
    const entries = TREE[path]
    if (!entries) return { deny: `ENOENT: ${path}` }
    return { value: entries.map((x) => ({ ...x, mtimeMs: 0, isLink: false })) }
  })
  on('fs.stat', (_$, e) => {
    const path = posix(e.path)
    const parent = path.slice(0, path.lastIndexOf('/'))
    const name = path.slice(path.lastIndexOf('/') + 1)
    const hit = TREE[path] ? dir(name) : TREE[parent]?.find((x) => x.name === name)
    if (!hit) return { deny: `ENOENT: ${path}` }
    return { value: { kind: hit.kind, size: hit.size, mtimeMs: 0, isLink: false, realPath: path } }
  })
  on('fs.read', (_$, e) => {
    const path = posix(e.path)
    const text = CONTENT[path]
    if (text === undefined) return { deny: `ENOENT: ${path}` }
    return { value: e.as === 'bytes' ? { base64: btoa(text) } : text }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'xdg-open') return { deny: 'xdg-open: not found\nmore detail' }
    if (argv.includes('--show-toplevel')) return ok(`${ROOT}\n`)
    if (argv.includes('--absolute-git-dir')) return ok(`${ROOT}/.git\n`)
    if (argv.includes('check-ignore')) return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv.includes('ls-files') && argv.includes('-co')) return ok(FILES.join('\0') + '\0')
    if (argv.includes('status')) return ok('# branch.oid 1111111111111111111111111111111111111111\0# branch.head main\0' + '1 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 1111111111111111111111111111111111111111 src/api/user.ts\0')
    return ok('')
  })
  on('prompt.fill', (_$, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('classic.CwdChanged', () => ({}))
  await $.classic.CwdChanged({ old_cwd: '/work', new_cwd: ROOT })
  return { lists, runs, fills, toasts }
}

const rowKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map((b) => b.key ?? '').filter((k) => k.startsWith('row-'))

test('root listing renders folders first, hidden files off', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    const keys = await rowKeys(ui)
    expect(keys.slice(0, 2)).toEqual(['row-docs', 'row-src'])
    expect(keys).toContain('row-README.md')
    expect(keys).not.toContain('row-.env')
    expect((await ui.find({ key: 'header' }))?.text).toContain('acme-app')
    await ui.unmount()
  }
})

test('pressing a folder row expands it and lists it once', async ($, on) => {
  const seen = await world($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    if (surface === 'terminal') {
      await ui.press({ key: 'row-src' })
      await ui.press({ key: 'key-h' })
      await ui.press({ key: 'key-h' })
    }
    expect(await rowKeys(ui)).toContain('row-src/api')
    expect(await rowKeys(ui)).toContain('row-src/index.ts')
    expect(seen.lists.filter((p) => p === `${ROOT}/src`)).toHaveLength(1)
    await ui.unmount()
  }
})

test('h toggles hidden files', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'key-h' })
    expect(await rowKeys(ui)).toContain('row-.env')
    await ui.press({ key: 'key-h' })
    expect(await rowKeys(ui)).not.toContain('row-.env')
    await ui.unmount()
  }
})

test('f opens the filter and typing ranks the best file first', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'key-f' })
    expect(await ui.find({ type: 'Input', key: 'filter' })).toBeDefined()
    await ui.input({ key: 'filter', text: 'usr', kind: 'change' })
    expect((await rowKeys(ui))[0]).toBe('row-src/api/user.ts')
    await ui.input({ key: 'filter', text: 'zzzz', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: 'No files match "zzzz".' })).toBeDefined()
    await ui.press({ key: 'files-clear' })
    expect((await ui.find({ type: 'Input', key: 'filter' }))?.props.value).toBe('')
    expect(await rowKeys(ui)).toContain('row-src')
    await ui.unmount()
  }
})

for (const width of WIDTHS) test(`Back retains the Files filter and q remains editable at ${width} by five rows`, async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width, 5), requestId: 'jei' })
    await ui.press({ key: 'key-f' })
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBeUndefined()
    await ui.input({ key: 'filter', text: 'usr', kind: 'submit' })
    expect((await ui.find({ key: 'back' }))?.props.hotkey).toBe('q')
    await ui.press({ key: 'back' })
    expect((await ui.find({ key: 'filter' }))?.props.value).toBe('usr')
    await ui.input({ key: 'filter', text: 'usrq', kind: 'change' })
    expect((await ui.find({ key: 'filter' }))?.props.value).toBe('usrq')
    await ui.press({ key: 'files-clear' })
    expect((await ui.find({ key: 'filter' }))?.props.value).toBe('')
    for (const cells of lineWidths(await ui.drawn() as Node)) expect(cells).toBeLessThanOrEqual(width)
    await ui.unmount()
  }
})

test('enter on a file shows its preview; the header goes back', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    await $.command.run(jei(`${ROOT}/src/api/user.ts`))
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'row-src/api/user.ts' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.language).toBe('typescript')
    expect(code?.text).toContain('getUser')
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await rowKeys(ui)).toContain('row-src/api/user.ts')
    await ui.unmount()
  }
})

test('previews by kind: markdown and its source, csv table, notices', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(40), requestId: 'jei' })
    await ui.press({ key: 'row-README.md' })
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('# acme-app')
    await ui.press({ key: 'key-m' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect((await ui.find({ type: 'Code' }))?.props.language).toBe('markdown')
    await ui.press({ key: 'key-m' })
    await ui.press({ key: 'back' })

    await ui.press({ key: 'row-people.csv' })
    expect(await ui.find({ type: 'Text', text: /^ name\s+email/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ana Rivera/ })).toBeDefined()
    for (const w of lineWidths((await ui.drawn()) as Node)) expect(w).toBeLessThanOrEqual(40)
    await ui.press({ key: 'back' })

    await ui.press({ key: 'row-logo.bin' })
    expect(await ui.find({ type: 'Text', text: 'Binary file. Press o to open it.' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-big.log' })
    expect(await ui.find({ type: 'Text', text: 'Too large to preview (5.0 MB).' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-empty.txt' })
    expect(await ui.find({ type: 'Text', text: 'This file is empty.' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-docs' })
    expect(await ui.find({ type: 'Text', text: 'This folder is empty.' })).toBeDefined()
    await ui.press({ key: 'row-docs' }) // collapse again: state outlives the drawing
    await ui.unmount()
  }
})

test('a mentions the selected file in the prompt', async ($, on) => {
  const seen = await world($, on)
  for (const surface of SURFACES) {
    await $.command.run(jei(`${ROOT}/src/api/user.ts`))
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'key-a' })
    await ui.unmount()
  }
  expect(seen.fills).toEqual([
    { text: '@src/api/user.ts ', mode: 'insert' },
    { text: '@src/api/user.ts ', mode: 'insert' },
  ])
})

test('an unreadable file shows an error notice on both surfaces and at every pane width', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    await $.command.run(jei(`${ROOT}/src/index.ts`))
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(120), requestId: 'jei' })
    await ui.press({ key: 'row-src/index.ts' })
    for (const width of WIDTHS) {
      for (const height of [10, 5]) {
        await ui.redraw(paneProps(width, height))
        expect(await ui.find({ type: 'Text', text: "Can't read this file." })).toBeDefined()
        expect(await ui.find({ type: 'Code' })).toBeUndefined()
        for (const w of lineWidths((await ui.drawn()) as Node)) expect(w).toBeLessThanOrEqual(width)
      }
    }
    await ui.redraw(paneProps(120))
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('o opens the file and a failure becomes a toast', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(jei(`${ROOT}/src/api/user.ts`))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80), requestId: 'jei' })
  await ui.press({ key: 'key-o' })
  expect(seen.runs).toContainEqual(['xdg-open', `${ROOT}/src/api/user.ts`])
  expect(seen.toasts).toEqual(["Can't open user.ts: xdg-open: not found."])
  await ui.unmount()
})

test('a Read glows its row and follows the agent; the glow ends after 2 s', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 })
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  await world($, on)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80), requestId: 'jei' })
  expect(await ui.find({ key: 'glow-src/api/user.ts' })).toBeUndefined()
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/api/user.ts` } as never)
  expect(await ui.find({ key: 'glow-src/api/user.ts' })).toBeDefined()
  expect(await rowKeys(ui)).toContain('row-src/api')
  const name = await ui.find({ key: 'row-src/api/user.ts' })
  expect(name).toBeDefined()
  await clock.advance(2250)
  expect(await ui.find({ key: 'glow-src/api/user.ts' })).toBeUndefined()
  expect(await ui.find({ key: 'mark-src/api/user.ts' })).toBeDefined()
  await ui.unmount()
})

test('with activity on writes, a Read does not glow', { options: { activity: 'writes' } }, async ($, on) => {
  mock.clock(on, { now: 10_000 })
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  await world($, on)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80), requestId: 'jei' })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/api/user.ts` } as never)
  expect(await ui.find({ key: 'glow-src/api/user.ts' })).toBeUndefined()
  expect(await rowKeys(ui)).not.toContain('row-src/api')
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/index.ts`, content: 'x' } as never)
  expect(await ui.find({ key: 'glow-src/index.ts' })).toBeDefined()
  await ui.unmount()
})

test('paths outside the project never glow', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  await world($, on)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80), requestId: 'jei' })
  await $.tool.call({ tool: 'Read', file_path: '/etc/hosts' } as never)
  expect(await ui.findAll({ type: 'Box' }).then((b) => b.filter((x) => (x.key ?? '').startsWith('glow-')))).toHaveLength(0)
  await ui.unmount()
})

test('status letters show on changed rows and roll up to folders', async ($, on) => {
  const clock = mock.clock(on)
  await world($, on)
  await clock.settle()
  await $.command.run(jei(`${ROOT}/src/api/user.ts`))
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80), requestId: 'jei' })
  const row = await ui.find({ key: 'row-src/api/user.ts' })
  expect(row?.text.trimEnd().endsWith('M')).toBe(true)
  expect((await ui.find({ key: 'row-src' }))?.text.trimEnd().endsWith('M')).toBe(true)
  await ui.unmount()
})

test('no line is wider than the pane, and the selection survives a resize', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) {
    await $.command.run(jei(`${ROOT}/src/api/user.ts`))
    for (const width of WIDTHS) {
      const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width), requestId: 'jei' })
      for (const w of lineWidths((await ui.drawn()) as Node)) expect(w, `tree ${surface} ${width}`).toBeLessThanOrEqual(width)
      await ui.redraw(paneProps(width, 5))
      expect(await ui.find({ key: 'row-src/api/user.ts' })).toBeDefined()
      for (const w of lineWidths((await ui.drawn()) as Node)) expect(w).toBeLessThanOrEqual(width)
      await ui.redraw(paneProps(width, 24))
      await ui.press({ key: 'key-f' })
      await ui.input({ key: 'filter', text: 'user', kind: 'change' })
      for (const w of lineWidths((await ui.drawn()) as Node)) expect(w, `filter ${surface} ${width}`).toBeLessThanOrEqual(width)
      await ui.press({ key: 'files-cancel' })
      await ui.press({ key: 'row-src/api/user.ts' })
      for (const w of lineWidths((await ui.drawn()) as Node)) expect(w, `preview ${surface} ${width}`).toBeLessThanOrEqual(width)
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
})

// Fix round 1 ------------------------------------------------------------------

const answerTools = (on: On) => on('tool.call', () => ({ result: {} as never, text: 'ok' }))
const mountAt = ($: Engine, width = 80, rows = 24) =>
  $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(width, rows), requestId: 'jei' })

test('a shell command refreshes the whole tree, even one JEI cannot read', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 })
  answerTools(on)
  await world($, on)
  const saved = TREE[`${ROOT}/src`]!
  try {
    const ui = await mountAt($)
    await ui.press({ key: 'row-src' })
    expect(await rowKeys(ui)).toContain('row-src/index.ts')
    TREE[`${ROOT}/src`] = saved.filter((x) => x.name !== 'index.ts')
    await $.tool.call({ tool: 'Bash', command: 'rm src/index.ts' } as never)
    await clock.advance(300)
    expect(await rowKeys(ui)).not.toContain('row-src/index.ts')
    TREE[`${ROOT}/src`] = saved
    await $.tool.call({ tool: 'Bash', command: 'make build' } as never)
    await clock.advance(300)
    expect(await rowKeys(ui)).toContain('row-src/index.ts')
    await ui.unmount()
  } finally {
    TREE[`${ROOT}/src`] = saved
  }
})

test('a write in a new folder shows the folder in its parent', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 })
  answerTools(on)
  await world($, on)
  const saved = TREE[`${ROOT}/src`]!
  try {
    const ui = await mountAt($)
    await ui.press({ key: 'row-src' })
    TREE[`${ROOT}/src`] = [...saved, dir('lib')]
    TREE[`${ROOT}/src/lib`] = [file('db.ts')]
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/lib/db.ts`, content: 'x' } as never)
    await clock.advance(300)
    expect(await rowKeys(ui)).toContain('row-src/lib')
    expect(await rowKeys(ui)).toContain('row-src/lib/db.ts')
    await ui.unmount()
  } finally {
    TREE[`${ROOT}/src`] = saved
    delete TREE[`${ROOT}/src/lib`]
  }
})

test('follow-agent never takes over an open preview', async ($, on) => {
  mock.clock(on, { now: 10_000 })
  answerTools(on)
  await world($, on)
  const ui = await mountAt($)
  await ui.press({ key: 'row-README.md' })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/api/user.ts` } as never)
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('# acme-app')
    expect((await ui.find({ key: 'preview-title' }))?.text).toContain('README.md')
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'glow-src/api/user.ts' })).toBeDefined()
  await ui.unmount()
})

test('the selected row is inverted unless the focus ring is on it', async ($, on) => {
  on('ui.focus', () => ({}))
  await world($, on)
  await $.command.run(jei(`${ROOT}/src/api/user.ts`))
  const ui = await mountAt($)
  const nameOf = async () => ((await ui.find({ key: 'row-src/api/user.ts' }))?.children[0] as { props: { inverse?: boolean } }).props
  expect((await nameOf()).inverse).toBe(true)
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src/api/user.ts', origin: { kind: 'person' } })
  expect((await nameOf()).inverse).toBeFalsy()
  await ui.unmount()
})

test('an unreadable folder says so, and is read again when reopened', async ($, on) => {
  await world($, on)
  const root = TREE[ROOT]!
  TREE[ROOT] = [...root, dir('locked')]
  try {
    const ui = await mountAt($)
    await ui.press({ key: 'row-locked' })
    expect(await ui.find({ type: 'Text', text: "Can't read this folder." })).toBeDefined()
    TREE[`${ROOT}/locked`] = [file('a.txt')]
    await ui.press({ key: 'row-locked' })
    await ui.press({ key: 'row-locked' })
    expect(await rowKeys(ui)).toContain('row-locked/a.txt')
    await ui.press({ key: 'row-locked' })
    await ui.unmount()
  } finally {
    TREE[ROOT] = root
    delete TREE[`${ROOT}/locked`]
  }
})

test('letter keys still work on a short pane', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(jei(`${ROOT}/src/api/user.ts`))
  const ui = await mountAt($, 80, 5)
  expect((await ui.find({ key: 'hint' }))?.text).not.toContain('mention')
  await ui.press({ key: 'key-a' })
  expect(seen.fills).toEqual([{ text: '@src/api/user.ts ', mode: 'insert' }])
  await ui.unmount()
})

test('a steady stream of writes refreshes within 1.5 s', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 })
  answerTools(on)
  const seen = await world($, on)
  const statusRuns = () => seen.runs.filter((a) => a.includes('status')).length
  const before = statusRuns()
  for (let i = 0; i < 8; i++) {
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/index.ts`, content: String(i) } as never)
    await clock.advance(200)
  }
  expect(statusRuns()).toBeGreaterThan(before)
})

test('session start asks to watch the git index and HEAD', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  await world($, on)
  const r = await $.classic.SessionStart({ source: 'startup', cwd: ROOT } as never)
  expect(r.watchPaths).toEqual([`${ROOT}/.git/index`, `${ROOT}/.git/HEAD`])
})

// Final review fixes --------------------------------------------------------------

const hintLineOf = async (ui: { drawn: () => Promise<unknown> }) => {
  const box = findKey((await ui.drawn()) as Node, 'hint')
  return box ? drawnLine(box) : ''
}

test('o refuses a runnable file when no editor command is set, and runs nothing', async ($, on) => {
  const seen = await world($, on)
  await $.command.run(jei(`${ROOT}/src/api/run.sh`))
  const ui = await mountAt($)
  await ui.press({ key: 'key-o' })
  expect(seen.toasts).toEqual(['Set editorCommand to open this file type.'])
  expect(seen.runs.filter((a) => a[0] === 'xdg-open' || a[0] === 'open' || a[0] === 'explorer.exe')).toEqual([])
  await ui.unmount()
})

test('a preview of long lines cuts them at the edge, so the hint keys stay drawn', { timeoutMs: 60_000 }, async ($, on) => {
  await world($, on)
  await $.command.run(jei(`${ROOT}/src/api/wide.ts`))
  for (const width of WIDTHS) {
    for (const rows of [24, 12, 6]) {
      const ui = await mountAt($, width, rows)
      await ui.press({ key: 'row-src/api/wide.ts' })
      expect((await ui.find({ type: 'Code' }))?.props.wrap).toBe('truncate-end')
      const box = findKey((await ui.drawn()) as Node, 'preview')
      expect(box !== undefined && typeof box !== 'string' ? box.props?.overflow : undefined).toBe('hidden')
      for (const k of ['a', 'o', 'm']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
  // Rendered Markdown wraps on its own: its box clips it to the window.
  await $.command.run(jei(`${ROOT}/README.md`))
  const md = await mountAt($, 40, 8)
  await md.press({ key: 'row-README.md' })
  const box = findKey((await md.drawn()) as Node, 'preview')
  expect(box !== undefined && typeof box !== 'string' ? box.props?.overflow : undefined).toBe('hidden')
  await md.press({ key: 'back' })
  await md.unmount()
})

test('the Files and preview hints keep every key within 24, 40, 80 and 120 columns', { timeoutMs: 60_000 }, async ($, on) => {
  await world($, on)
  await $.command.run(jei(`${ROOT}/src/api/user.ts`))
  for (const width of WIDTHS) {
    for (const rows of [24, 6]) {
      const ui = await mountAt($, width, rows)
      const tree = await hintLineOf(ui)
      expect(tree.length).toBeLessThanOrEqual(width - 1)
      for (const k of ['a', 'o', 'f', 'h']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
      await ui.press({ key: 'row-src/api/user.ts' })
      const preview = await hintLineOf(ui)
      expect(preview.length).toBeLessThanOrEqual(width - 1)
      for (const k of ['a', 'o', 'm']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
})

test('Files field stays editable, bounded and cancelable at three, four and five rows', async ($, on) => {
  await world($, on)
  for (const surface of SURFACES) for (const width of WIDTHS) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width, 5), requestId: 'jei' })
    for (const rows of [3, 4, 5]) {
      await ui.redraw(paneProps(width, rows)); await ui.press({ key: 'key-f' })
      await ui.input({ key: 'filter', text: 'user', kind: 'change' })
      const widths = lineWidths(await ui.drawn() as Node)
      expect(widths.length).toBeLessThanOrEqual(rows)
      for (const drawn of widths) expect(drawn).toBeLessThanOrEqual(width)
      expect((await ui.find({ key: 'filter' }))?.props.value).toBe('user')
      expect((await ui.find({ key: 'tab-2' }))?.props.hotkey).toBeUndefined()
      await ui.press({ key: 'files-clear' })
      expect((await ui.find({ key: 'filter' }))?.props.value).toBe('')
    }
    await ui.unmount()
  }
})

test('on mobile, which draws no Input, the filter shows as text', async ($, on) => {
  await world($, on)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'mobile', component: 'Pane', props: paneProps(40), requestId: 'jei' })
  await ui.press({ key: 'key-f' })
  expect((await ui.find({ key: 'files-search-field' }))?.text).toContain('Find files by name')
  await ui.press({ key: 'files-clear' })
  await ui.unmount()
})
