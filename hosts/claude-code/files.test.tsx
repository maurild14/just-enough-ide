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

test('Files native Windows confirmation refuses a canonical Unicode sibling before effects', async ($, on) => {
  on('ui.focus', () => ({}))
  const seen = await world($, on, true, undefined, path => path.replace(ROOT, path.includes('/src') ? 'C:/fixture/K' : 'C:/fixture/k'))
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: `C:${ROOT}` })
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src/api/user.ts', origin: { kind: 'person' } })
  await ui.press({ key: 'key-d' })
  expect(await ui.find({ key: 'files-operation-confirm' })).toBeUndefined()
  expect(seen.toasts.at(-1)).toContain('outside'); expect(seen.effects).toEqual([])
  await ui.unmount()
})

test('Files operations stay reachable, own typed input, cancel and always confirm deletion at five rows', { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  const seen = await world($, on)
  for (const surface of SURFACES) for (const width of WIDTHS) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width, 5), requestId: 'jei' })
    for (const key of ['n', 'r', 'm', 'd']) expect(await ui.find({ key: `key-${key}` })).toBeTruthy()
    await ui.press({ key: 'key-n' })
    expect(await ui.find({ key: 'files-operation-input' })).toBeTruthy()
    await ui.input({ key: 'files-operation-input', text: 'nrmd123.txt', kind: 'change' })
    expect((await ui.find({ key: 'files-operation-input' }))?.text).toContain('nrmd123.txt')
    expect((findKey(await ui.drawn() as Node, 'tab-1') as { props?: { hotkey?: string } })?.props?.hotkey).toBeUndefined()
    for (const resized of [120, 24, 40, 80, width]) {
      await ui.redraw(paneProps(resized, 5))
      expect((await ui.find({ key: 'files-operation-input' }))?.props.value).toBe('nrmd123.txt')
      expect(Math.max(0, ...lineWidths(await ui.drawn() as Node))).toBeLessThanOrEqual(resized)
      expect(lineWidths(await ui.drawn() as Node).length).toBeLessThanOrEqual(5)
    }
    await ui.redraw(paneProps(width, 2)); expect(await ui.find({ key: 'files-operation-input' })).toBeUndefined()
    expect(await ui.find({ key: 'files-operation-cancel' })).toBeTruthy()
    await ui.redraw(paneProps(width, 5))
    await ui.press({ key: 'files-operation-cancel' })
    await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src', origin: { kind: 'person' } })
    await ui.press({ key: 'key-d' })
    expect(await ui.find({ key: 'files-operation-confirm' })).toBeTruthy()
    expect(await ui.find({ key: 'files-operation-cancel' })).toBeTruthy()
    expect((await ui.find({ key: 'files-operation-title' }))?.text).toContain('recursive')
    await ui.redraw(paneProps(24, 2)); expect(await ui.find({ key: 'files-operation-confirm' })).toBeUndefined()
    expect(await ui.find({ key: 'files-operation-cancel' })).toBeTruthy()
    await ui.redraw(paneProps(width, 5)); expect(await ui.find({ key: 'files-operation-confirm' })).toBeTruthy()
    expect(seen.runs.filter(argv => ['rm', 'mv', 'mkdir', 'powershell.exe'].includes(argv[0]!))).toEqual([])
    expect(Math.max(0, ...lineWidths(await ui.drawn() as Node))).toBeLessThanOrEqual(width)
    await ui.press({ key: 'files-operation-cancel' })
    await ui.unmount()
  }
})

test('Files rename/move long-prefill editors and file confirmation retain native bounds through resize', { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  await world($, on)
  const longName = 'long-'.repeat(12) + 'file.txt', rel = `src/api/${longName}`
  TREE[`${ROOT}/src/api`]!.push(file(longName))
  try {
    for (const surface of SURFACES) for (const width of WIDTHS) {
      await $.command.run(jei(`${ROOT}/${rel}`))
      const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width, 5), requestId: 'jei' })
      for (const action of ['r', 'm']) {
        await ui.press({ key: `key-${action}` })
        for (const resized of [24, 40, 80, 120, width]) {
          await ui.redraw(paneProps(resized, 5))
          expect((await ui.find({ key: 'files-operation-input' }))?.props.value).toBe(action === 'r' ? longName : rel)
          expect(Math.max(0, ...lineWidths(await ui.drawn() as Node))).toBeLessThanOrEqual(resized)
          expect(lineWidths(await ui.drawn() as Node).length).toBeLessThanOrEqual(5)
        }
        await ui.redraw(paneProps(width, 2)); expect(await ui.find({ key: 'files-operation-input' })).toBeUndefined()
        await ui.redraw(paneProps(width, 5)); await ui.press({ key: 'files-operation-cancel' })
      }
      await ui.press({ key: 'key-d' }); expect((await ui.find({ key: 'files-operation-title' }))?.text).toContain('Delete file?')
      await ui.redraw(paneProps(24, 5)); expect(await ui.find({ key: 'files-operation-confirm' })).toBeTruthy()
      expect((await ui.find({ key: 'files-operation-path' }))?.text).toContain('.txt')
      expect(Math.max(0, ...lineWidths(await ui.drawn() as Node))).toBeLessThanOrEqual(24)
      await ui.press({ key: 'files-operation-cancel' }); await ui.unmount()
    }
  } finally { TREE[`${ROOT}/src/api`] = TREE[`${ROOT}/src/api`]!.filter(entry => entry.name !== longName) }
})

test('Files changed cwd and changed source after confirmation refuse with zero process effects', async ($, on) => {
  on('ui.focus', () => ({}))
  const seen = await world($, on)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src', origin: { kind: 'person' } })
  await ui.press({ key: 'key-d' })
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: '/work/other-app' })
  expect(await ui.find({ key: 'files-operation-confirm' })).toBeUndefined()
  expect(seen.runs.some(argv => argv[0] === 'rm')).toBe(false)
  await $.classic.CwdChanged({ old_cwd: '/work/other-app', new_cwd: ROOT })
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src/api/user.ts', origin: { kind: 'person' } })
  await ui.press({ key: 'key-d' })
  const original = TREE[`${ROOT}/src/api`]!.find(entry => entry.name === 'user.ts')!
  original.size++
  try { await ui.press({ key: 'files-operation-confirm' }); expect(seen.toasts.at(-1)).toContain('changed'); expect(seen.runs.some(argv => argv[0] === 'rm')).toBe(false) }
  finally { original.size-- }
  await ui.unmount()
})

test('Files duplicate native submits perform only one effect', async ($, on) => {
  on('ui.focus', () => ({}))
  const savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT), seen = await world($, on, true)
  try {
    const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
    await ui.press({ key: 'key-n' })
    await Promise.all([ui.input({ key: 'files-operation-input', text: 'once.txt', kind: 'submit' }), ui.input({ key: 'files-operation-input', text: 'once.txt', kind: 'submit' })])
    expect(seen.effects.filter(effect => effect.endsWith('/once.txt'))).toHaveLength(1)
    await ui.unmount()
  } finally {
    for (const key of Object.keys(TREE)) delete TREE[key]
    Object.assign(TREE, JSON.parse(savedTree))
    for (const key of Object.keys(CONTENT)) delete CONTENT[key]
    Object.assign(CONTENT, JSON.parse(savedContent))
  }
})

for (const phase of ['begin', 'apply'] as const) test(`Files ${phase} loses a real compare-and-set retry without taking another operation's lock`, async ($, on) => {
  let armed = false, injected = false, owner: string | null | undefined
  on('ui.focus', () => ({}))
  on('state.set', async (_$, event, next) => {
    if (armed && !injected && event.key === 'tree' && event.ifVersion !== undefined && (phase === 'begin' ? event.value.operationBusy && !event.previous?.operationBusy : event.value.operation?.working && !event.previous?.operation?.working)) {
      injected = true
      const winner = await next(phase === 'begin' ? { ...event, value: { ...event.value, operationBusy: 'competing-owner' } } : event)
      if (winner.value?.isSet) owner = phase === 'begin' ? 'competing-owner' : event.value.operationBusy
      // A competing writer won this exact version; update() must re-read and retry its callback.
      return winner.value ? { value: { isSet: false, version: winner.value.version } } : winner
    }
    const result = await next(event)
    if (event.key === 'tree' && result.value?.isSet) owner = event.value.operationBusy
    return result
  })
  const seen = await world($, on, true)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
  if (phase === 'begin') { armed = true; await ui.press({ key: 'key-n' }); expect(await ui.find({ key: 'files-operation-input' })).toBeUndefined(); expect(owner).toBe('competing-owner'); expect(seen.toasts.at(-1)).toContain('already running') }
  else { await ui.press({ key: 'key-n' }); armed = true; await ui.input({ key: 'files-operation-input', text: 'not-created.txt', kind: 'submit' }) }
  expect(injected).toBe(true)
  expect(seen.effects).toEqual([])
  await ui.unmount()
})

test('Files releases a preparing owner when native cwd change beats the editor installation retry', { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  const clock = mock.clock(on, { now: 0 }), other = '/work/other-app', savedTree = JSON.stringify(TREE)
  let armed = false, paused = false, misses = 0, current = ROOT
  let pending: Promise<unknown> | undefined
  on('state.set', async (_$, event, next) => {
    const installing = event.key === 'tree' && !!event.value.operation && !event.previous?.operation
    if (armed && !paused && installing) { paused = true; await clock.sleep(100) }
    const result = await next(event)
    if (installing && result.value?.isSet === false) misses++
    if (event.key === 'cwd' && result.value?.isSet) current = event.value
    return result
  })
  const seen = await world($, on, true); TREE[other] = []
  try {
    const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
    armed = true; pending = ui.press({ key: 'key-n' })
    await clock.settle(); expect(paused).toBe(true)
    await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: other }); expect(current).toBe(other)
    await clock.advance(100); await pending
    expect(misses).toBeGreaterThan(0)
    expect(await ui.find({ key: 'files-operation-input' })).toBeUndefined()
    expect(seen.effects).toEqual([])
    await ui.press({ key: 'key-n' }); expect(await ui.find({ key: 'files-operation-input' })).toBeTruthy()
    await ui.press({ key: 'files-operation-cancel' }); await ui.unmount()
  } finally { await clock.advance(100); await pending?.catch(() => {}); for (const key of Object.keys(TREE)) delete TREE[key]; Object.assign(TREE, JSON.parse(savedTree)) }
})

for (const stage of ['acquisition', 'installation'] as const) test(`Files releases its preparation after a one-shot native tree ${stage} error`, async ($, on) => {
  on('ui.focus', () => ({}))
  on('ui.log', () => ({ value: undefined }))
  let armed = false, rejected = false
  on('state.set', (_$, event, next) => {
    if (armed && !rejected && event.key === 'tree' && event.ifVersion !== undefined && (stage === 'acquisition' ? event.value.operationBusy && !event.previous?.operationBusy : event.value.operation && !event.previous?.operation)) {
      rejected = true
      return { deny: 'Temporary tree write failure.' }
    }
    return next(event)
  })
  const seen = await world($, on, true)
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
  armed = true; await ui.press({ key: 'key-n' })
  expect(rejected).toBe(true); expect(seen.effects).toEqual([])
  expect(await ui.find({ key: 'files-operation-input' })).toBeUndefined()
  await ui.press({ key: 'key-n' }); expect(await ui.find({ key: 'files-operation-input' })).toBeTruthy()
  await ui.press({ key: 'files-operation-cancel' }); await ui.unmount()
})

test('Files holds its effect owner across cwd change/cancel and cannot release or select into another project', { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  const clock = mock.clock(on, { now: 0 })
  let owner: string | null | undefined, selected: string | undefined
  on('state.set', async (_$, event, next) => {
    const result = await next(event)
    if (result.value?.isSet) {
      if (event.key === 'tree') owner = event.value.operationBusy
      if (event.key === 'pane') selected = event.value.selected.files
    }
    return result
  })
  const savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT), seen = await world($, on, true)
  const other = '/work/other-app'; TREE[other] = []
  seen.holdEffects(clock.sleep(100))
  try {
    const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(24, 5), requestId: 'jei' })
    await ui.press({ key: 'key-n' })
    const pending = ui.input({ key: 'files-operation-input', text: 'first.txt', kind: 'submit' })
    await clock.settle()
    expect(seen.effectEntered).toBe(true)
    await ui.press({ key: 'files-operation-cancel' })
    await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: other })
    const before = selected
    await ui.press({ key: 'key-n' })
    expect(seen.toasts.at(-1)).toContain('already running')
    expect(seen.effects).toHaveLength(1)
    await clock.advance(100); await pending
    expect(owner).toBeFalsy()
    expect(selected).toBe(before)
    expect(TREE[other]).toEqual([])
    seen.holdEffects(undefined)
    await ui.press({ key: 'key-n' }); await ui.input({ key: 'files-operation-input', text: 'second.txt', kind: 'submit' })
    expect(CONTENT[`${ROOT}/first.txt`]).toBe(''); expect(CONTENT[`${other}/second.txt`]).toBe('')
    await ui.unmount()
  } finally {
    await clock.advance(100)
    for (const key of Object.keys(TREE)) delete TREE[key]
    Object.assign(TREE, JSON.parse(savedTree))
    for (const key of Object.keys(CONTENT)) delete CONTENT[key]
    Object.assign(CONTENT, JSON.parse(savedContent))
  }
})

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
async function world($: Engine, on: On, operations = false, onRun?: (argv: readonly string[]) => Promise<void>, canonical?: (path: string) => string) {
  on('session.id', () => ({ value: 'files-test-session' }))
  const lists: string[] = []
  const runs: string[][] = []
  const fills: { text: string; mode?: string }[] = []
  const toasts: string[] = []
  const effects: string[] = []
  let operationFailure: 'exit' | 'skip' | null = null
  let refreshFailure = false
  let effectHold: Promise<void> | undefined
  let effectEntered = false
  let fileListHold: Promise<void> | undefined
  let fileListEntered = false
  const create = (path: string, kind: 'file' | 'dir') => {
    const parent = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
    TREE[parent]!.push(kind === 'dir' ? dir(name) : file(name, 0))
    if (kind === 'dir') TREE[path] = []
    else CONTENT[path] = ''
  }
  const remove = (path: string) => {
    const parent = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1)
    TREE[parent] = TREE[parent]!.filter(entry => entry.name !== name)
    for (const key of Object.keys(TREE)) if (key === path || key.startsWith(path + '/')) delete TREE[key]
    for (const key of Object.keys(CONTENT)) if (key === path || key.startsWith(path + '/')) delete CONTENT[key]
  }
  if (operations) on('fs.write', async (_$, e) => { const path = posix(e.path); effects.push(`write:${path}`); effectEntered = true; await effectHold; create(path, 'file'); return { value: undefined } })
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
    return { value: { kind: hit.kind, size: hit.size, mtimeMs: 0, isLink: false, realPath: canonical?.(path) ?? path } }
  })
  on('fs.read', (_$, e) => {
    const path = posix(e.path)
    const text = CONTENT[path]
    if (text === undefined) return { deny: `ENOENT: ${path}` }
    return { value: e.as === 'bytes' ? { base64: btoa(text) } : text }
  })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    await onRun?.(argv)
    runs.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (refreshFailure && argv.includes('status')) return { value: { exitCode: 1, stdout: '', stderr: 'Status unavailable.', isStdoutTruncated: false, isStderrTruncated: false } }
    if (operations && ['mkdir', 'mv', 'rm'].includes(argv[0]!)) {
      effects.push(argv.join(' '))
      if (operationFailure === 'exit') return { value: { exitCode: 1, stdout: '', stderr: 'Access denied.', isStdoutTruncated: false, isStderrTruncated: false } }
      if (operationFailure === 'skip') return ok('')
      const destination = posix(argv.at(-1)!)
      if (argv[0] === 'mkdir') create(destination, 'dir')
      else if (argv[0] === 'rm') remove(destination)
      else {
        const source = posix(argv.at(-2)!), isDir = !!TREE[source]
        const contents = Object.entries(CONTENT).filter(([key]) => key === source || key.startsWith(source + '/'))
        const folders = Object.entries(TREE).filter(([key]) => key === source || key.startsWith(source + '/'))
        create(destination, isDir ? 'dir' : 'file'); remove(source)
        for (const [key, value] of contents) CONTENT[destination + key.slice(source.length)] = value
        for (const [key, value] of folders) TREE[destination + key.slice(source.length)] = value
      }
      return ok('')
    }
    if (argv[0] === 'xdg-open') return { deny: 'xdg-open: not found\nmore detail' }
    if (argv.includes('--show-toplevel')) return ok(`${ROOT}\n`)
    if (argv.includes('--absolute-git-dir')) return ok(`${ROOT}/.git\n`)
    if (argv.includes('check-ignore')) return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv.includes('ls-files') && argv.includes('-co')) {
      const snapshot = (operations ? Object.entries(TREE).flatMap(([parent, entries]) => entries.filter(e => e.kind === 'file').map(e => `${parent}/${e.name}`.slice(ROOT.length + 1))) : FILES).join('\0') + '\0'
      if (fileListHold) { fileListEntered = true; await fileListHold }
      return ok(snapshot)
    }
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
  return { lists, runs, fills, toasts, effects, setOperationFailure(value: typeof operationFailure) { operationFailure = value }, setRefreshFailure(value: boolean) { refreshFailure = value }, holdEffects(value: Promise<void> | undefined) { effectHold = value }, get effectEntered() { return effectEntered }, holdFileList(value: Promise<void> | undefined) { fileListHold = value; fileListEntered = false }, get fileListEntered() { return fileListEntered } }
}

for (const phase of ['post-refresh', 'tree-retry', 'pane-retry'] as const) test(`Files completion refuses ${phase} publication after a native cwd change`, { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  const clock = mock.clock(on, { now: 0 })
  const other = '/work/other-app', savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT)
  let effected = false, changed = false, current = ROOT, misses = 0
  let pending: Promise<unknown> | undefined
  const leaks: string[] = []
  on('state.set', async ($, event, next) => {
    const treeWrite = event.key === 'tree' && event.value.expanded.includes('docs') && !event.previous?.expanded.includes('docs')
    const paneWrite = event.key === 'pane' && event.value.selected.files === 'docs/race.txt'
    if (effected && !changed && (phase === 'tree-retry' && treeWrite || phase === 'pane-retry' && paneWrite)) {
      changed = true; await clock.sleep(100)
    }
    const result = await next(event)
    if (current === other && (treeWrite || paneWrite) && result.value?.isSet === false) misses++
    if (result.value?.isSet) {
      if (event.key === 'cwd') current = event.value
      if (current === other && (treeWrite || paneWrite || phase === 'post-refresh' && event.key === 'pane' && !!event.value.selected.files)) leaks.push(event.key)
    }
    return result
  })
  await world($, on, true, async argv => {
    if (effected && phase === 'post-refresh' && !changed && argv.includes('status')) { changed = true; await clock.sleep(100) }
    if (argv[0] === 'rm' || argv[0] === 'mv') effected = true
  }); TREE[other] = []
  try {
    const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(40, 5), requestId: 'jei' })
    await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: `row-${phase === 'post-refresh' ? 'README.md' : 'src/api/user.ts'}`, origin: { kind: 'person' } })
    await ui.press({ key: phase === 'post-refresh' ? 'key-d' : 'key-m' })
    pending = phase === 'post-refresh' ? ui.press({ key: 'files-operation-confirm' }) : ui.input({ key: 'files-operation-input', text: 'docs/race.txt', kind: 'submit' })
    await clock.settle(); expect(changed).toBe(true)
    await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: other }); expect(current).toBe(other)
    await clock.advance(100); await pending
    if (phase !== 'post-refresh') expect(misses).toBeGreaterThan(0)
    expect(leaks).toEqual([]); expect(TREE[other]).toEqual([])
    await ui.unmount()
  } finally { await clock.advance(100); await pending?.catch(() => {}); for (const key of Object.keys(TREE)) delete TREE[key]; Object.assign(TREE, JSON.parse(savedTree)); for (const key of Object.keys(CONTENT)) delete CONTENT[key]; Object.assign(CONTENT, JSON.parse(savedContent)) }
})

for (const scenario of ['hidden', 'capped', 'hidden-parent', 'git-fallback'] as const) test(`Files successful ${scenario} destination has a visible native row or explicit fallback`, { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  const savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT), seen = await world($, on, true)
  TREE[ROOT]!.push(dir('.private'), dir('.git')); TREE[`${ROOT}/.private`] = []; TREE[`${ROOT}/.git`] = []
  if (scenario === 'capped') TREE[ROOT]!.push(...Array.from({ length: 501 }, (_, i) => file(`entry${String(i).padStart(3, '0')}.txt`)))
  try {
    const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(40, 5), requestId: 'jei' })
    const moving = scenario === 'hidden-parent' || scenario === 'git-fallback', destination = scenario === 'hidden' ? '.new.txt' : scenario === 'capped' ? 'zzz-new.txt' : scenario === 'hidden-parent' ? '.private/after.txt' : '.git/after.txt'
    await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: `row-${moving ? 'src/api/user.ts' : 'README.md'}`, origin: { kind: 'person' } })
    await ui.press({ key: moving ? 'key-m' : 'key-n' }); await ui.input({ key: 'files-operation-input', text: destination, kind: 'submit' })
    if (scenario === 'git-fallback') { expect(seen.toasts.at(-1)).toContain(destination); expect(seen.toasts.at(-1)).toContain('.git is hidden'); expect((await ui.findAll({ type: 'Button' })).some(row => row.key?.startsWith('row-') && row.children.some(child => typeof child === 'object' && child !== null && 'props' in child && (child.props as { inverse?: boolean }).inverse))).toBe(true) }
    else {
      expect(await ui.find({ key: `row-${destination}` })).toBeTruthy()
      if (scenario === 'capped') { await ui.press({ key: 'key-h' }); await ui.press({ key: 'key-h' }) }
      else await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src', origin: { kind: 'person' } })
      expect(await ui.find({ key: `row-${destination}` })).toBeUndefined()
    }
    await ui.unmount()
  } finally { for (const key of Object.keys(TREE)) delete TREE[key]; Object.assign(TREE, JSON.parse(savedTree)); for (const key of Object.keys(CONTENT)) delete CONTENT[key]; Object.assign(CONTENT, JSON.parse(savedContent)) }
})

test('Files mutation invalidation wins over an already started old filename-list refresh', { timeoutMs: 60_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 10_000 })
  answerTools(on)
  const savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT), seen = await world($, on, true)
  let release!: () => void
  const oldList = new Promise<void>(resolve => { release = resolve })
  try {
    const ui = await mountAt($)
    await ui.press({ key: 'key-f' }); await ui.input({ key: 'filter', text: 'user', kind: 'change' }); await ui.press({ key: 'files-cancel' })
    await ui.press({ key: 'key-r' })
    seen.holdFileList(oldList)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/src/index.ts`, content: 'x' } as never)
    await clock.advance(300)
    expect(seen.fileListEntered).toBe(true)
    await ui.input({ key: 'files-operation-input', text: 'renamed.txt', kind: 'submit' })
    expect(CONTENT[`${ROOT}/src/api/renamed.txt`]).toBe(USER_TS)
    seen.holdFileList(undefined); release(); await clock.settle()
    await ui.press({ key: 'key-f' }); await ui.input({ key: 'filter', text: 'renamed', kind: 'change' })
    expect(await ui.find({ key: 'row-src/api/renamed.txt' })).toBeTruthy()
    await ui.input({ key: 'filter', text: 'user', kind: 'change' })
    expect(await ui.find({ key: 'row-src/api/user.ts' })).toBeUndefined()
    await ui.unmount()
  } finally { release(); await clock.settle(); for (const key of Object.keys(TREE)) delete TREE[key]; Object.assign(TREE, JSON.parse(savedTree)); for (const key of Object.keys(CONTENT)) delete CONTENT[key]; Object.assign(CONTENT, JSON.parse(savedContent)) }
})

for (const surface of SURFACES) test(`Files new entry retains expanded descendants on ${surface}`, async ($, on) => {
  on('ui.focus', () => ({}))
  const savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT)
  await world($, on, true)
  try {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'row-src' }); await ui.press({ key: 'row-src/api' })
    expect(await ui.find({ key: 'row-src/api/user.ts' })).toBeTruthy()
    await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'row-src', origin: { kind: 'person' } })
    await ui.press({ key: 'key-n' }); await ui.input({ key: 'files-operation-input', text: 'added.txt', kind: 'submit' })
    expect(await ui.find({ key: 'row-src/added.txt' })).toBeTruthy()
    expect(await ui.find({ key: 'row-src/api/user.ts' })).toBeTruthy()
    await ui.unmount()
  } finally { for (const key of Object.keys(TREE)) delete TREE[key]; Object.assign(TREE, JSON.parse(savedTree)); for (const key of Object.keys(CONTENT)) delete CONTENT[key]; Object.assign(CONTENT, JSON.parse(savedContent)) }
})

test('Files cancel and refused rename retain the filename filter on both native surfaces', async ($, on) => {
  const seen = await world($, on, true)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(80), requestId: 'jei' })
    await ui.press({ key: 'key-f' }); await ui.input({ key: 'filter', text: 'user', kind: 'change' }); await ui.press({ key: 'files-cancel' })
    await ui.press({ key: 'key-r' }); await ui.press({ key: 'files-operation-cancel' })
    expect((await ui.find({ key: 'filter' }))?.props.value).toBe('user')
    expect(await ui.find({ key: 'row-src/api/user.ts' })).toBeTruthy()
    await ui.press({ key: 'key-r' }); await ui.input({ key: 'files-operation-input', text: 'run.sh', kind: 'submit' })
    expect(seen.toasts.at(-1)).toContain('already exists')
    expect((await ui.find({ key: 'filter' }))?.props.value).toBe('user')
    expect(await ui.find({ key: 'row-src/api/user.ts' })).toBeTruthy()
    expect(seen.effects).toEqual([])
    await ui.press({ key: 'files-clear' }); await ui.unmount()
  }
})

test('Files mutations refresh caches/state, select surviving targets and never simulate failed or skipped moves', { timeoutMs: 60_000 }, async ($, on) => {
  on('ui.focus', () => ({}))
  const savedTree = JSON.stringify(TREE), savedContent = JSON.stringify(CONTENT), seen = await world($, on, true)
  try {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(40, 5), requestId: 'jei' })
      const focus = async (rel: string) => $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: `row-${rel}`, origin: { kind: 'person' } })
      await focus('src')
      await ui.press({ key: 'key-n' }); await ui.input({ key: 'files-operation-input', text: 'created.txt', kind: 'submit' })
      expect(CONTENT[`${ROOT}/src/created.txt`]).toBe('')
      expect(await ui.find({ key: 'row-src/created.txt' })).toBeTruthy()
      await ui.press({ key: 'key-r' }); await ui.input({ key: 'files-operation-input', text: 'renamed.txt', kind: 'submit' })
      expect(CONTENT[`${ROOT}/src/renamed.txt`]).toBe('')
      await ui.press({ key: 'key-m' }); await ui.input({ key: 'files-operation-input', text: 'moved.txt', kind: 'submit' })
      expect(CONTENT[`${ROOT}/moved.txt`]).toBe('')
      await ui.press({ key: 'key-f' }); await ui.input({ key: 'filter', text: 'moved', kind: 'change' })
      expect(await ui.find({ key: 'row-moved.txt' })).toBeTruthy()
      await ui.press({ key: 'files-cancel' })
      const before = seen.effects.length
      await ui.press({ key: 'key-d' }); expect(seen.effects.length).toBe(before)
      await ui.press({ key: 'files-operation-confirm' }); expect(CONTENT[`${ROOT}/moved.txt`]).toBeUndefined()
      expect((await ui.findAll({ type: 'Button' })).some(row => row.key?.startsWith('row-') && row.children.some(child => typeof child === 'object' && child !== null && 'props' in child && (child.props as { inverse?: boolean }).inverse))).toBe(true)
      await focus('src')
      await ui.press({ key: 'key-n' }); await ui.input({ key: 'files-operation-input', text: 'new-folder/', kind: 'submit' })
      await ui.press({ key: 'key-n' }); await ui.input({ key: 'files-operation-input', text: 'child.txt', kind: 'submit' })
      expect(CONTENT[`${ROOT}/src/new-folder/child.txt`]).toBe('')
      await focus('src/new-folder'); await ui.press({ key: 'key-d' })
      expect((await ui.find({ key: 'files-operation-title' }))?.text).toContain('recursive')
      await ui.press({ key: 'files-operation-confirm' }); expect(CONTENT[`${ROOT}/src/new-folder/child.txt`]).toBeUndefined()
      await focus('src/api/user.ts')
      for (const failure of ['exit', 'skip'] as const) {
        seen.setOperationFailure(failure)
        await ui.press({ key: 'key-m' }); await ui.input({ key: 'files-operation-input', text: 'failed.txt', kind: 'submit' })
        expect(CONTENT[`${ROOT}/src/api/user.ts`]).toBe(USER_TS)
        expect(CONTENT[`${ROOT}/failed.txt`]).toBeUndefined()
        expect(seen.toasts.at(-1)).toContain(failure === 'exit' ? 'Access denied' : 'did not complete')
      }
      seen.setOperationFailure(null)
      seen.setRefreshFailure(true)
      await focus('src'); await ui.press({ key: 'key-n' }); await ui.input({ key: 'files-operation-input', text: 'completed.txt', kind: 'submit' })
      expect(CONTENT[`${ROOT}/src/completed.txt`]).toBe('')
      expect(seen.toasts.at(-1)).toContain('Operation completed. Refresh failed:')
      seen.setRefreshFailure(false)
      delete CONTENT[`${ROOT}/src/completed.txt`]; TREE[`${ROOT}/src`] = TREE[`${ROOT}/src`]!.filter(entry => entry.name !== 'completed.txt')
      await ui.unmount()
    }
  } finally {
    for (const key of Object.keys(TREE)) delete TREE[key]
    Object.assign(TREE, JSON.parse(savedTree))
    for (const key of Object.keys(CONTENT)) delete CONTENT[key]
    Object.assign(CONTENT, JSON.parse(savedContent))
  }
})

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
      expect(await ui.find({ key: 'row-src/api/user.ts' }), `${surface} ${width}: ${(await rowKeys(ui)).join(',')}`).toBeDefined()
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
