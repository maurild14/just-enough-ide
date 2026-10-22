import { afterEach, expect, spyOn, test } from 'bun:test'
import { CodeRenderable, InputRenderable, RGBA } from '@opentui/core'
import { testRender } from '@opentui/solid'
import type { Plugin } from '@opencode/plugin/tui'
import { createMemo, createSignal, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { cellWidth } from '../../core/shared/fit.ts'
import { parseOptions } from '../../core/options.ts'
import plugin from '../../tui.ts'
import { paneMemory } from './pane.tsx'
import { activityColor } from './colors.ts'
import { ACTIVITY_FRAME_MS } from '../../core/activity/shimmer.ts'

type Context = Plugin.Context
type Layer = ReturnType<Parameters<Context['keymap']['layer']>[0]>
type Claim = Extract<Parameters<Context['ui']['slot']>[0], { append: 'session.panel' }>
const renderers: Awaited<ReturnType<typeof testRender>>[] = []
afterEach(() => { for (const r of renderers.splice(0)) r.renderer.destroy() })
const file = (name: string) => ({ name, kind: 'file', size: 10 })
const dir = (name: string) => ({ name, kind: 'dir', size: 0 })

for (const scenario of ['hidden', 'capped', 'ignored-parent', 'git-fallback'] as const) test(`Files successful ${scenario} target is visibly revealed within the cap`, async () => {
  const f = fixture()
  f.tree['.git'] = []
  if (scenario === 'capped') f.tree['']!.push(...Array.from({ length: 501 }, (_, i) => file(`entry${String(i).padStart(3, '0')}.txt`)))
  const r = await f.mount(40, 5)
  const destination = scenario === 'hidden' ? '.new.txt' : scenario === 'capped' ? 'zzz-new.txt' : scenario === 'ignored-parent' ? 'dist/after.txt' : '.git/after.txt'
  if (scenario === 'ignored-parent' || scenario === 'git-fallback') { f.select('src/api/user.ts'); await r.flush(); f.key('m') } else { f.select('README.md'); await r.flush(); f.key('n') }
  await r.flush(); const input = r.renderer.root.findDescendantById('files-operation-input') as InputRenderable
  input.value = ''; input.focus(); await r.mockInput.typeText(destination); f.key('enter'); await r.flush()
  if (scenario === 'git-fallback') {
    const selected = paneMemory(f.ctx)[0].panes['session-a']!.selected.files!
    expect(selected).not.toContain('.git'); expect(selected).toBeTruthy(); expect(r.captureCharFrame()).toContain(selected.split('/').at(-1)!)
    expect(JSON.stringify(f.notices)).toContain('.git/after.txt')
  } else {
    expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.files).toBe(destination)
    expect(r.captureCharFrame()).toContain(destination.split('/').at(-1)!)
    if (scenario === 'capped') { f.key('h'); await r.flush(); f.key('h'); await r.flush() }
    else { f.select('src'); await r.flush() }
    expect(r.captureCharFrame()).not.toContain(destination.split('/').at(-1)!)
  }
})

function fixture(options: Record<string, unknown> = {}) {
  const layers: (() => Layer)[] = []
  const listeners = new Map<string, Set<(event: { data: unknown }) => void>>()
  let claim!: Claim
  const [width, setWidth] = createSignal(80)
  const memory = new Map<string, unknown>()
  const calls: { method: string; input: unknown }[] = []
  const prompts: { title: string; value: string }[] = []
  const sent: unknown[] = []
  const notices: unknown[] = []
  let edited: string | undefined = '@src/api/user.ts '
  const tree: Record<string, unknown[]> = {
    '': [file('README.md'), dir('src'), file('.env'), dir('.git'), dir('dist'), file('data.csv'), file('data.tsv'), file('photo.png'), file('blob.bin'), file('huge.txt'), file('empty.txt'), file('locked.txt')],
    src: [dir('api'), file('usage.ts')], 'src/api': [file('user.ts')], dist: [file('build.js')],
  }
  const previews: Record<string, unknown> = {
    'src/api/user.ts': { kind: 'code', text: 'export const user = 1\n', language: 'typescript' },
    'src/usage.ts': { kind: 'code', text: 'const usage = 2\n', language: 'typescript' },
    'README.md': { kind: 'markdown', text: '# Guide\n**Hello**\n', language: 'markdown' },
    'data.csv': { kind: 'csv', rows: [['name', 'role'], ['Ana Rivera', 'admin']] },
    'data.tsv': { kind: 'tsv', rows: [['name', 'role'], ['Leo Park', 'dev']] },
    'photo.png': { kind: 'image' }, 'blob.bin': { kind: 'binary' }, 'huge.txt': { kind: 'too-large' },
    'empty.txt': { kind: 'empty' }, 'locked.txt': { kind: 'error' },
  }
  let listing = async (rel: string): Promise<unknown> => ({ entries: tree[rel] ?? [], ignored: ['dist'] })
  let preview = async (rel: string): Promise<unknown> => previews[rel] ?? { kind: 'empty' }
  let opener = async (_input: unknown): Promise<unknown> => ({})
  let allFiles = async (): Promise<unknown> => ({ files: ['src/usage.ts', 'README.md', 'src/api/user.ts', '.env'] })
  let operationSerial = 0
  let pendingOperation: { kind: string; source: string; parent: string } | undefined
  let fsApply: ((input: { value?: string }, options?: { signal?: AbortSignal }) => Promise<unknown>) | undefined
  let prepareReply: Promise<unknown> | undefined
  let directory = '/acme-app'
  let stateReads = 0
  let git: unknown = { root: '/acme-app', status: { entries: [{ path: 'src/api/user.ts', index: null, worktree: 'modified' }] } }
  const api = {
    state: async () => { stateReads++; return { cwd: directory, options: parseOptions(options), git, activity: {} } },
    async listDir(input: { rel: string }) { calls.push({ method: 'listDir', input }); return listing(input.rel) },
    async preview(input: { rel: string }) { calls.push({ method: 'preview', input }); return preview(input.rel) },
    async allFiles() { calls.push({ method: 'allFiles', input: {} }); return allFiles() },
    async quickOpenFiles() { calls.push({ method: 'quickOpenFiles', input: {} }); return { files: Object.entries(tree).flatMap(([parent, entries]) => entries.filter(raw => (raw as { kind: string }).kind === 'file').map(raw => `${parent ? parent + '/' : ''}${(raw as { name: string }).name}`)) } },
    async open(input: unknown) { calls.push({ method: 'open', input }); return opener(input) },
    async fsPrepare(input: { kind: string; source: string }) { calls.push({ method: 'fsPrepare', input }); const sourceKind = tree[input.source] ? 'dir' : 'file', parent = input.kind === 'new' && sourceKind === 'dir' ? input.source : input.source.slice(0, Math.max(0, input.source.lastIndexOf('/'))); pendingOperation = { ...input, parent }; return prepareReply ?? { planId: String(++operationSerial), root: directory, ...input, sourceKind: input.source ? sourceKind : null, parent } },
    async fsApply(input: { value?: string }, options?: { signal?: AbortSignal }) {
      calls.push({ method: 'fsApply', input })
      if (fsApply) return fsApply(input, options)
      const operation = pendingOperation!, source = operation.source, sourceParent = source.slice(0, Math.max(0, source.lastIndexOf('/')))
      const sourceName = source.slice(source.lastIndexOf('/') + 1), sourceEntry = tree[sourceParent]?.find(raw => (raw as { name: string }).name === sourceName) as { name: string; kind: string } | undefined
      const value = input.value ?? '', destination = operation.kind === 'move' ? value : `${operation.parent ? operation.parent + '/' : ''}${value.replace(/\/$/, '')}`
      if (operation.kind !== 'new') tree[sourceParent] = tree[sourceParent]!.filter(raw => (raw as { name: string }).name !== sourceName)
      if (operation.kind !== 'delete') {
        const parent = destination.slice(0, Math.max(0, destination.lastIndexOf('/'))), name = destination.slice(destination.lastIndexOf('/') + 1)
        const isDir = operation.kind === 'new' ? value.endsWith('/') : sourceEntry?.kind === 'dir'
        tree[parent]!.push(isDir ? dir(name) : file(name))
        if (isDir) tree[destination] = tree[source] ?? []
      }
      if (operation.kind !== 'new') { delete tree[source]; delete previews[source] }
      return { ok: true, attempted: true, rel: operation.kind === 'delete' ? sourceParent : destination }
    },
    events: { on(name: string, fn: (event: { data: unknown }) => void) {
      const handlers = listeners.get(name) ?? new Set(); listeners.set(name, handlers); handlers.add(fn)
      return () => { handlers.delete(fn) }
    } },
  }
  const ctx = {
    options, theme: { text: { base: RGBA.fromHex('#ffffff'), muted: RGBA.fromHex('#888888'), action: { primary: { base: RGBA.fromHex('#0000ff') } }, feedback: { error: { base: RGBA.fromHex('#ff0000') }, warning: { base: RGBA.fromHex('#ff8800') }, success: { base: RGBA.fromHex('#00ff00') }, info: { base: RGBA.fromHex('#aa00ff') } } },
      background: { base: RGBA.fromHex('#000000'), action: { primary: { base: RGBA.fromHex('#000088') } } }, syntax: { keyword: RGBA.fromHex('#ff00ff'), string: RGBA.fromHex('#00ff00'), number: RGBA.fromHex('#ffff00') } },
    storage: { memory(key: string, config: { initial: object }) {
      if (!memory.has(key)) { const [s, set] = createStore(config.initial); memory.set(key, [s, (fn: (draft: object) => void) => set(produce(fn))]) }
      return memory.get(key)
    } },
    client: { rpc: () => api, session: { async prompt(input: unknown) { sent.push(input) } } },
    keymap: { layer(factory: () => Layer) { const l = createMemo(factory); layers.push(l); onCleanup(() => layers.splice(layers.indexOf(l), 1)) } },
    ui: { slot(value: Claim) { claim = value; return () => {} }, router: { current: () => ({ type: 'session', sessionID: 'session-a' }) },
      panel: { open: () => true }, dialog: { async prompt(input: { title: string; value: string }) { prompts.push(input); return edited } }, toast: { show(input: unknown) { notices.push(input) } } },
  } as unknown as Context
  async function mount(w = 80, h = 24) {
    setWidth(w)
    const r = await testRender(() => { plugin.setup(ctx); return claim.render({ name: 'jei', sessionID: 'session-a', get width() { return width() }, focused: true, presentation: 'panel', focus() {}, close() {}, toggleFullscreen() {} }) }, { width: w, height: h })
    renderers.push(r); await r.flush(); return r
  }
  function key(bind: string) { return layers.flatMap((l) => l().commands ?? []).findLast((c) => c.bind === bind && (typeof c.enabled === 'function' ? c.enabled() : c.enabled !== false))?.run() }
  function select(rel: string) { layers.flatMap((l) => l().commands ?? []).find((c) => c.id === 'jei.toggle')!.run(rel) }
  return { ctx, mount, key, select, calls, prompts, sent, notices, tree, previews, setWidth,
    setEdited(value: string | undefined) { edited = value }, setListing(fn: typeof listing) { listing = fn }, setPreview(fn: typeof preview) { preview = fn },
    setGit(value: unknown) { git = value },
    setAllFiles(fn: typeof allFiles) { allFiles = fn },
    setOpen(fn: typeof opener) { opener = fn },
    setFsApply(fn: typeof fsApply) { fsApply = fn },
    setPrepareReply(reply?: Promise<unknown>) { prepareReply = reply }, setCwd(value: string) { directory = value }, get stateReads() { return stateReads },
    emit(name: string, data: unknown = {}) { for (const fn of listeners.get(name) ?? []) fn({ data }) },
  }
}

test('Files sorts directories first, expands/collapses and toggles hidden entries', async () => {
  const f = fixture(); const r = await f.mount()
  let frame = r.captureCharFrame()
  expect(frame.indexOf('src')).toBeLessThan(frame.indexOf('README.md'))
  expect(frame).not.toContain('.env'); expect(frame).not.toContain('dist'); expect(frame).not.toContain('.git')
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('api')
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).not.toContain('api')
  f.key('h'); await r.flush(); frame = r.captureCharFrame()
  expect(frame).toContain('.env'); expect(frame).toContain('dist'); expect(frame).not.toContain('.git')
})

test('Files new entry retains already expanded descendant folders', async () => {
  const f = fixture(), r = await f.mount()
  f.select('src/api/user.ts'); await r.flush(); expect(r.captureCharFrame()).toContain('user.ts')
  f.select('src'); await r.flush(); f.key('n'); await r.flush()
  await r.mockInput.typeText('added.txt'); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('added.txt')
  expect(r.captureCharFrame()).toContain('user.ts')
})

test('Files operation inline editor and recursive confirmation own input and cancel in the public pane', async () => {
  const f = fixture(), r = await f.mount(24, 5)
  f.key('n'); await r.flush()
  expect(r.renderer.root.findDescendantById('files-operation-input')).toBeDefined()
  await r.mockInput.typeText('nrmd123.txt'); await r.flush()
  expect(r.captureCharFrame()).toContain('nrmd123.txt')
  expect(f.key('3')).toBeUndefined()
  f.key('esc'); await r.flush()
  expect(r.renderer.root.findDescendantById('files-operation-input')).toBeUndefined()
  f.select('src'); await r.flush(); f.key('d'); await r.flush()
  expect(r.captureCharFrame()).toContain('recursive')
  expect(r.captureCharFrame()).toContain('Delete')
  expect(r.captureCharFrame()).toContain('Cancel')
  f.key('esc'); await r.flush()
  expect(f.calls.filter(call => call.method === 'fsApply')).toEqual([])
})

for (const width of [24, 40, 80, 120]) test(`Files operation editor/confirm stays bounded and retains input through resize at ${width}`, async () => {
  const f = fixture(), r = await f.mount(width, 5)
  f.key('n'); await r.flush(); await r.mockInput.typeText('nrmd123.txt'); await r.flush()
  for (const w of [120, 24, 40, 80, width]) {
    f.setWidth(w); r.resize(w, 5); await r.flush()
    const lines = r.captureCharFrame().split('\n').slice(0, -1); expect(lines.length).toBe(5)
    expect(lines.every(line => cellWidth(line) <= w)).toBe(true)
    expect(r.captureCharFrame()).toContain('nrmd123.txt'); expect(r.captureCharFrame()).toContain('Cancel')
  }
  r.resize(width, 2); await r.flush()
  expect(r.captureCharFrame()).toContain('Enlarge'); expect(r.captureCharFrame()).toContain('Cancel')
  expect(r.renderer.root.findDescendantById('files-operation-input')).toBeUndefined()
  f.key('enter'); await r.flush(); expect(f.calls.some(call => call.method === 'fsApply')).toBe(false)
  r.resize(width, 5); await r.flush(); expect(r.captureCharFrame()).toContain('nrmd123.txt')
  f.key('esc'); await r.flush()
  const longName = 'long-'.repeat(12) + 'file.txt', longPath = `src/api/${longName}`
  f.tree['src/api']!.push(file(longName)); f.emit('changed'); f.select(longPath); await r.flush()
  for (const action of ['r', 'm']) {
    f.key(action); await r.flush()
    const expected = action === 'r' ? longName : longPath
    for (const w of [24, 40, 80, 120, width]) {
      f.setWidth(w); r.resize(w, 5); await r.flush()
      expect((r.renderer.root.findDescendantById('files-operation-input') as InputRenderable).value).toBe(expected)
      expect(r.captureCharFrame().split('\n').every(line => cellWidth(line) <= w)).toBe(true)
      expect(r.captureCharFrame()).toContain('Cancel')
    }
    r.resize(width, 2); await r.flush(); expect(r.captureCharFrame()).toContain('Enlarge'); f.key('esc'); await r.flush(); r.resize(width, 5); await r.flush()
  }
  f.key('d'); await r.flush(); expect(r.captureCharFrame()).toContain('Delete file?'); f.key('esc'); await r.flush()
  f.select('src'); await r.flush(); f.key('d'); await r.flush()
  for (const w of [24, 120, width]) {
    f.setWidth(w); r.resize(w, 5); await r.flush()
    expect(r.captureCharFrame()).toContain('recursive'); expect(r.captureCharFrame()).toContain('Delete'); expect(r.captureCharFrame()).toContain('Cancel')
  }
  expect(f.calls.some(call => call.method === 'fsApply')).toBe(false)
  f.key('enter'); await r.flush()
  expect(f.calls.filter(call => call.method === 'fsApply').at(-1)?.input).toMatchObject({ confirmed: true })
})

test('Files native mutations refresh listing/all-files/state, keep targets and report partial/completed refresh errors without retries', async () => {
  const f = fixture(), r = await f.mount(40, 5)
  f.setAllFiles(async () => ({ files: Object.entries(f.tree).flatMap(([parent, entries]) => entries.filter(raw => (raw as { kind: string }).kind === 'file').map(raw => `${parent ? parent + '/' : ''}${(raw as { name: string }).name}`)) }))
  f.key('f'); await r.flush(); f.key('esc'); await r.flush()
  const beforeFiles = f.calls.filter(call => call.method === 'allFiles').length, beforeState = f.stateReads
  f.select('src'); await r.flush()
  f.key('n'); await r.flush(); await r.mockInput.typeText('created.txt'); f.key('enter'); await r.flush()
  expect(f.calls.filter(call => call.method === 'fsApply').at(-1)?.input).toMatchObject({ value: 'created.txt', confirmed: false })
  expect(r.captureCharFrame()).toContain('created.txt')
  f.key('f'); await r.flush(); await r.mockInput.typeText('created'); await r.flush()
  expect(r.captureCharFrame()).toContain('created.txt')
  expect(f.calls.filter(call => call.method === 'allFiles').length).toBeGreaterThan(beforeFiles)
  expect(f.stateReads).toBeGreaterThan(beforeState)
  f.key('esc'); await r.flush()
  f.key('r'); await r.flush(); const rename = r.renderer.root.findDescendantById('files-operation-input') as InputRenderable
  expect(rename.value).toBe('created.txt'); rename.value = 'renamed.txt'; f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('renamed.txt')
  f.key('m'); await r.flush(); const move = r.renderer.root.findDescendantById('files-operation-input') as InputRenderable
  expect(move.value).toBe('src/renamed.txt'); move.value = 'moved.txt'; f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('moved.txt')
  const before = f.calls.length
  f.setFsApply(async () => ({ ok: false, attempted: true, rel: '', error: 'Access denied after partial delete.' }))
  f.key('d'); await r.flush(); expect(f.calls.slice(before).some(call => call.method === 'fsApply')).toBe(false)
  f.key('enter'); await r.flush()
  expect(f.notices.at(-1)).toMatchObject({ message: 'Access denied after partial delete.', variant: 'error' })
  expect(f.calls.slice(before).some(call => call.method === 'listDir')).toBe(true)
  expect(f.calls.slice(before).filter(call => call.method === 'fsApply')).toHaveLength(1)
  f.setFsApply(async () => ({ ok: true, attempted: true, rel: 'moved.txt', refreshError: 'Status read failed.' }))
  f.key('r'); await r.flush(); f.key('enter'); await r.flush()
  expect(f.notices.at(-1)).toMatchObject({ message: 'Operation completed. Refresh failed: Status read failed.', variant: 'error' })
})

test('Files preparation shows the first refusal line, performs no effect and releases its owner for retry', async () => {
  const f = fixture(), r = await f.mount(40, 5)
  let refuse!: (error: unknown) => void
  f.setPrepareReply(new Promise((_resolve, reject) => { refuse = reject }))
  f.key('d'); await r.flush(); refuse({ type: 'refused', message: 'Select an existing regular file or folder.\nPrivate diagnostic.' }); await r.flush()
  expect(f.notices.at(-1)).toMatchObject({ message: 'Select an existing regular file or folder.', variant: 'error' })
  expect(f.calls.some(call => call.method === 'fsApply')).toBe(false)
  expect(r.renderer.root.findDescendantById('files-operation-confirm')).toBeUndefined()
  f.setPrepareReply(); f.key('n'); await r.flush()
  expect(r.renderer.root.findDescendantById('files-operation-input')).toBeDefined()
})

test('Files preparation busy and stale-root replies cannot open an editor or mutate another project', async () => {
  const f = fixture(), r = await f.mount(24, 5)
  let release!: (reply: unknown) => void
  f.setPrepareReply(new Promise(resolve => { release = resolve }))
  f.key('n'); await r.flush(); f.key('r'); await r.flush()
  expect(f.calls.filter(call => call.method === 'fsPrepare')).toHaveLength(1)
  f.setCwd('/other-app'); f.emit('changed'); await r.flush()
  release({ planId: 'old', root: '/acme-app', kind: 'new', source: 'src', sourceKind: 'dir', parent: 'src' }); await r.flush()
  expect(r.renderer.root.findDescendantById('files-operation-input')).toBeUndefined()
  expect(f.calls.some(call => call.method === 'fsApply')).toBe(false)
})

test('own Files mutations invalidate a retained Quick Open cache while Search is unmounted', async () => {
  const f = fixture()
  for (const key of Object.keys(f.tree)) delete f.tree[key]
  f.tree[''] = [file('old.txt')]
  const r = await f.mount(40, 10)
  const quickOpen = async () => { f.key('2'); await r.flush(); f.key('esc'); await r.flush(); f.key('q'); await r.flush() }
  await quickOpen(); expect(r.captureCharFrame()).toContain('old.txt')
  f.key('esc'); await r.flush(); f.key('1'); await r.flush()
  f.select('old.txt'); await r.flush(); f.key('d'); await r.flush(); f.key('enter'); await r.flush()
  f.key('n'); await r.flush(); await r.mockInput.typeText('fresh.txt'); f.key('enter'); await r.flush()
  await quickOpen()
  expect(r.captureCharFrame()).toContain('fresh.txt'); expect(r.captureCharFrame()).not.toContain('old.txt')
  expect(f.calls.filter(call => call.method === 'quickOpenFiles')).toHaveLength(2)
})

for (const detach of ['cancel', 'unmount'] as const) for (const result of ['error', 'refresh-error'] as const) test(`Files ${detach} retains a signal-aware apply through its actual ${result} reply`, async () => {
  const f = fixture(), r = await f.mount(80, 10)
  let release!: (value: unknown) => void
  let aborted = false
  f.setFsApply((_input, options) => new Promise((resolve, reject) => {
    release = resolve
    options?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('The operation was aborted.', 'AbortError')) }, { once: true })
  }))
  f.select('src'); await r.flush(); f.key('d'); await r.flush(); f.key('enter'); await r.flush()
  expect(f.calls.filter(call => call.method === 'fsApply').at(-1)?.input).toMatchObject({ confirmed: true })
  if (detach === 'cancel') f.key('esc')
  else {
    expect(r.captureCharFrame().split('\n')[0]).toContain('2')
    await r.mockMouse.click(r.captureCharFrame().split('\n')[0]!.indexOf('2') + 1, 0); await r.flush()
    expect(paneMemory(f.ctx)[0].panes['session-a']!.tab).toBe('search')
    await r.mockMouse.click(r.captureCharFrame().split('\n')[0]!.indexOf('1') + 1, 0); await r.flush()
    expect(paneMemory(f.ctx)[0].panes['session-a']!.tab).toBe('files')
  }
  await r.flush(); const before = paneMemory(f.ctx)[0].panes['session-a']!.selected.files
  expect(aborted).toBe(false)
  f.key('n'); await r.flush(); expect(f.calls.filter(call => call.method === 'fsPrepare')).toHaveLength(1)
  expect(f.notices.at(-1)).toMatchObject({ message: 'A Files operation is already running.' })
  release(result === 'error' ? { ok: false, attempted: true, rel: '', error: 'Delete failed: access denied.' } : { ok: true, attempted: true, rel: '', refreshError: 'Status unavailable.' }); await r.flush()
  expect(f.notices.at(-1)).toMatchObject({ message: result === 'error' ? 'Delete failed: access denied.' : 'Operation completed. Refresh failed: Status unavailable.', variant: 'error' })
  expect(paneMemory(f.ctx)[0].panes['session-a']!.selected.files).toBe(before)
  expect(f.calls.filter(call => call.method === 'fsApply')).toHaveLength(1)
  f.key('n'); await r.flush(); expect(f.calls.filter(call => call.method === 'fsPrepare')).toHaveLength(2)
})

test('f filters unexpanded paths, ranks usr first, and Esc returns to the tree', async () => {
  const f = fixture(); const r = await f.mount()
  f.key('f'); await r.flush(); await r.mockInput.typeText('usr'); await r.flush()
  expect(r.captureCharFrame()).toContain('src/api/user.ts')
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('export const user = 1')
  f.key('esc'); await r.flush(); f.key('esc'); await r.flush(); expect(r.captureCharFrame()).not.toContain('Cancel')
})

test('mention sends confirmed edited text, cancellation sends nothing, and open uses a relative path', async () => {
  const f = fixture(); const r = await f.mount()
  f.select('src/api/user.ts'); await r.flush(); f.key('a'); await r.flush()
  expect(f.prompts.at(-1)).toEqual({ title: 'Send to OpenCode', value: '@src/api/user.ts ' })
  expect(f.sent).toEqual([{ sessionID: 'session-a', text: '@src/api/user.ts ' }])
  f.setEdited('Review @src/api/user.ts'); f.key('a'); await r.flush()
  expect(f.sent.at(-1)).toEqual({ sessionID: 'session-a', text: 'Review @src/api/user.ts' })
  f.setEdited(undefined); f.key('a'); await r.flush(); expect(f.sent).toHaveLength(2)
  f.key('o'); await r.flush(); expect(f.calls.at(-1)).toEqual({ method: 'open', input: { rel: 'src/api/user.ts' } })
})

for (const [rel, text] of [
  ['blob.bin', 'Binary file — no preview.'], ['photo.png', 'Image preview is not available in OpenCode.'],
  ['huge.txt', 'Too large to preview.'], ['empty.txt', 'This file is empty.'], ['locked.txt', "Can't read this file."],
] as const) test(`preview notice: ${rel}`, async () => {
  const f = fixture(); const r = await f.mount(); f.select(rel); await r.flush(); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain(text)
  f.key('esc'); await r.flush(); expect(r.captureCharFrame()).not.toContain(text)
})

test('code and Markdown are highlighted source; CSV and TSV use padded tables', async () => {
  const f = fixture(); const r = await f.mount()
  for (const rel of ['src/api/user.ts', 'README.md']) {
    f.select(rel); await r.flush(); f.key('enter'); await r.flush()
    const code = r.renderer.root.findDescendantById('files-code') as CodeRenderable
    expect(code).toBeDefined(); await code.highlightingDone; await r.flush()
    expect(r.captureCharFrame()).toContain(rel.endsWith('.md') ? '# Guide' : 'export const user = 1')
    expect(code.filetype).toBe(rel.endsWith('.md') ? 'markdown' : 'typescript')
    if (rel.endsWith('.ts')) expect(r.captureSpans().lines.flatMap((l) => l.spans).some((s) => s.text.includes('export') && s.fg.r > 0.9 && s.fg.b > 0.9 && s.fg.g < 0.1)).toBe(true)
    f.key('esc'); await r.flush()
  }
  for (const rel of ['data.csv', 'data.tsv']) {
    f.select(rel); await r.flush(); f.key('enter'); await r.flush()
    expect(r.captureCharFrame()).toContain(rel.endsWith('.csv') ? 'Ana Rivera  admin' : 'Leo Park  dev')
    f.key('esc'); await r.flush()
  }
})

test('activity paints the theme accent and followAgent reveals ancestors without replacing a preview', async () => {
  const f = fixture(); const r = await f.mount()
  f.emit('activity', { rel: 'src/api/user.ts', kind: 'write' }); await r.flush()
  expect(r.captureCharFrame()).toContain('user.ts')
  const row = r.captureSpans().lines.find(l => l.spans.map(s => s.text).join('').includes('user.ts'))!
  expect(row.spans.some(s => s.text.trim() && s.fg.toInts()[0]! > s.fg.toInts()[2]!)).toBe(true)
  f.key('enter'); await r.flush(); f.emit('activity', { rel: 'src/usage.ts', kind: 'read' }); await r.flush()
  expect(r.captureCharFrame()).toContain('export const user = 1')
})

test('writing filenames sweep a gradient across their letters without underlining the row', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1000), interval = spyOn(globalThis, 'setInterval')
  try {
    const f = fixture(), r = await f.mount()
    f.emit('activity', { rel: 'src/api/user.ts', kind: 'write', active: true }); await r.flush()
    const row = () => r.captureSpans().lines.find(line => line.spans.map(span => span.text).join('').includes('user.ts'))!
    expect(row().spans.some(span => span.attributes & 8)).toBe(false)
    const tick = interval.mock.calls.find(args => args[1] === ACTIVITY_FRAME_MS)![0] as () => void
    const before = row().spans.map(span => [span.text, span.fg.toInts()])
    clock.mockReturnValue(1680); tick(); await r.flush()
    const during = row().spans.filter(span => span.text.trim() && span.text.trim() !== 'M' && span.text !== '•')
    expect(new Set(during.map(span => span.fg.toInts().join(','))).size).toBeGreaterThan(1)
    expect(row().spans.map(span => [span.text, span.fg.toInts()])).not.toEqual(before)
    f.emit('activity', { rel: 'src/api/user.ts', kind: 'write', active: false }); await r.flush()
    clock.mockReturnValue(4000); tick(); await r.flush()
    expect(row().spans.find(span => span.text.includes('user.ts'))!.fg.toInts()).toEqual([255, 255, 255, 255])
  } finally { clock.mockRestore(); interval.mockRestore() }
})

test('selected activity names and softer ancestors retain status colors across themes and widths', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1200), interval = spyOn(globalThis, 'setInterval')
  try { for (const mode of ['light', 'dark'] as const) for (const kind of ['read', 'write', 'git'] as const) {
    const f = fixture()
    Object.assign(f.ctx, { themeMode: mode })
    const theme = f.ctx.theme as any
    theme.text.base = RGBA.fromHex(mode === 'light' ? '#111111' : '#eeeeee')
    theme.background.base = RGBA.fromHex(mode === 'light' ? '#ffffff' : '#111111')
    const r = await f.mount(80)
    f.emit('activity', { rel: 'src/api/user.ts', kind }); await r.flush()
    const tick = interval.mock.calls.findLast(args => args[1] === ACTIVITY_FRAME_MS)![0] as () => void
    for (const width of [24, 40, 80, 120]) {
      clock.mockReturnValue(1200); tick()
      f.setWidth(width); r.resize(width, 24); await r.flush()
      const lines = r.captureSpans().lines
      const name = lines.flatMap(line => line.spans).find(span => span.text.includes('user.ts'))!
      expect(name.fg.toInts()).toEqual(activityColor(f.ctx, kind).toInts())
      const folder = lines.flatMap(line => line.spans).find(span => span.text.includes('api'))!
      expect(folder.fg.toInts()).not.toEqual(name.fg.toInts())
      expect(folder.fg.toInts()).not.toEqual(theme.text.base.toInts())
      const row = lines.find(line => line.spans.some(span => span.text.includes('user.ts')))!
      expect(row.spans.find(span => span.text.trim() === 'M')!.fg.toInts()).toEqual(theme.text.feedback.warning.base.toInts())
      clock.mockReturnValue(1680); tick(); await r.flush()
      const glowing = r.captureSpans().lines.find(line => line.spans.map(span => span.text).join('').includes('user.ts'))!
      expect(new Set(glowing.spans.filter(span => span.text.trim() && !['M', '•'].includes(span.text.trim())).map(span => span.fg.toInts().join(','))).size).toBeGreaterThan(2)
      expect(glowing.spans.some(span => span.attributes & 8)).toBe(false)
      expect(glowing.spans.find(span => span.text.trim() === 'M')!.fg.toInts()).toEqual(theme.text.feedback.warning.base.toInts())
      for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
    }
    r.renderer.destroy()
    renderers.splice(renderers.indexOf(r), 1)
    clock.mockReturnValue(1200)
  } } finally { clock.mockRestore(); interval.mockRestore() }
})

test('width/height changes keep the selected row reachable and every frame bounded', async () => {
  const f = fixture(); const r = await f.mount(120, 24)
  f.select('src/api/user.ts'); await r.flush()
  for (const h of [2, 5, 10, 24]) for (const w of [24, 40, 80, 120]) {
    f.setWidth(w); r.resize(w, h); await r.flush()
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
    expect(r.captureSpans().rows).toBe(h); expect(r.captureCharFrame()).toContain('user.ts')
  }
})

test('changed events and newer selections win over delayed listings and previews', async () => {
  const f = fixture(); const r = await f.mount()
  const pending: ((value: unknown) => void)[] = []
  f.setListing(() => new Promise((resolve) => pending.push(resolve)))
  f.emit('changed'); f.emit('changed')
  await r.flush()
  expect(pending).toHaveLength(2)
  pending[1]!({ entries: [file('fresh.ts')], ignored: [] }); await r.flush()
  pending[0]!({ entries: [file('stale.ts')], ignored: [] }); await r.flush()
  expect(r.captureCharFrame()).toContain('fresh.ts'); expect(r.captureCharFrame()).not.toContain('stale.ts')
  const previews: ((value: unknown) => void)[] = []
  f.setPreview(() => new Promise((resolve) => previews.push(resolve)))
  f.select('first.ts'); await r.flush(); f.key('enter'); await r.flush()
  f.key('esc'); f.select('second.ts'); await r.flush(); f.key('enter'); await r.flush()
  previews[1]!({ kind: 'binary' }); await r.flush(); previews[0]!({ kind: 'empty' }); await r.flush()
  expect(r.captureCharFrame()).toContain('Binary file — no preview.')
})

test('filter typing keeps letter and digit commands out of the input', async () => {
  const f = fixture(); const r = await f.mount()
  f.key('f'); await r.flush()
  f.key('3'); f.key('a'); f.key('h'); await r.flush()
  expect(f.prompts).toHaveLength(0); expect(r.captureCharFrame()).toContain('Cancel')
  f.key('esc'); await r.flush(); f.key('3'); await r.flush(); expect(r.captureCharFrame()).not.toContain('Cancel')
})

for (const width of [24, 40, 80, 120]) test(`Back preserves the Files filter and q stays typable at ${width} by five rows`, async () => {
  const f = fixture(); const r = await f.mount(width, 5)
  f.key('f'); await r.flush(); await r.mockInput.typeText('usr'); await r.flush()
  expect(r.captureCharFrame()).toContain('Cancel')
  f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('q Back')
  f.key('q'); await r.flush()
  expect(r.captureCharFrame()).toContain('usr')
  f.key('f'); await r.flush(); await r.mockInput.typeText('q'); await r.flush()
  expect(r.captureCharFrame()).toContain('usrq')
  const lines = r.captureCharFrame().split('\n'); const y = lines.findIndex(line => line.includes('Clear'))
  await r.mockMouse.click(lines[y]!.indexOf('Clear') + 1, y); await r.flush()
  expect(r.captureCharFrame()).not.toContain('Cancel')
  expect(r.captureCharFrame()).toContain('src')
  for (const line of r.captureCharFrame().split('\n')) expect(cellWidth(line)).toBeLessThanOrEqual(width)
  expect(r.captureSpans().rows).toBe(5)
})

test('followAgent off preserves selection while names fade and touched markers remain', async () => {
  const f = fixture({ followAgent: false }); const r = await f.mount()
  f.select('src/api/user.ts'); await r.flush(); f.key('up'); await r.flush()
  const clock = spyOn(Date, 'now').mockReturnValue(1200)
  const interval = spyOn(globalThis, 'setInterval')
  try {
    f.emit('activity', { rel: 'src/api/user.ts', kind: 'read' }); await r.flush()
    const row = () => r.captureSpans().lines.find(l => l.spans.map(s => s.text).join('').includes('user.ts'))!
    const initial = row().spans.find((s) => s.text.includes('user.ts'))!.fg.toInts()
    const tick = interval.mock.calls.find((args) => args[1] === ACTIVITY_FRAME_MS)![0] as () => void
    clock.mockReturnValue(2200); tick(); await r.flush()
    expect(row().spans.filter(s => s.text.trim() && !['M', '•'].includes(s.text.trim())).every(s => s.fg.toInts().join(',') === initial.join(','))).toBe(false)
    clock.mockReturnValue(3200); tick(); await r.flush()
    expect(row().spans.find((s) => s.text.includes('user.ts'))!.fg.toInts()).toEqual([255, 255, 255, 255])
    expect(row().spans.some((s) => s.text.includes('•') && (s.attributes & 2))).toBe(true)
    f.key('a'); await r.flush(); expect(f.prompts.at(-1)?.value).toBe('@src/api ')
  } finally { clock.mockRestore(); interval.mockRestore() }
})

test('in-flight activity stays colored beyond two seconds and fades only after completion', async () => {
  const f = fixture(), r = await f.mount()
  const clock = spyOn(Date, 'now').mockReturnValue(1200), interval = spyOn(globalThis, 'setInterval')
  try {
    f.emit('activity', { rel: 'src/api/user.ts', kind: 'read', active: true }); await r.flush()
    const tick = interval.mock.calls.find(args => args[1] === ACTIVITY_FRAME_MS)![0] as () => void
    clock.mockReturnValue(10_800); tick(); await r.flush()
    const name = () => r.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes('user.ts'))!
    expect(name().fg.toInts()).toEqual(activityColor(f.ctx, 'read').toInts())
    f.emit('activity', { rel: 'src/api/user.ts', kind: 'read', active: false }); await r.flush()
    clock.mockReturnValue(12_800); tick(); await r.flush()
    expect(name().fg.toInts()).toEqual([255, 255, 255, 255])
  } finally { clock.mockRestore(); interval.mockRestore() }
})

test('empty, failed and malformed listings are bounded and fail closed', async () => {
  const f = fixture(); f.setListing(async () => { throw new Error('unreadable') }); const r = await f.mount(40, 5)
  expect(r.captureCharFrame()).toContain("Can't read this folder.")
  f.setListing(async () => ({ entries: [], ignored: [] })); f.emit('changed'); await r.flush()
  expect(r.captureCharFrame()).toContain('This folder is empty.')
  f.setListing(async () => ({ entries: [file('../outside.ts')], ignored: [] })); f.emit('changed'); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't read this folder.")
  f.select('/outside.ts'); await r.flush(); f.key('a'); f.key('o'); f.key('enter'); await r.flush()
  expect(f.sent).toHaveLength(0); expect(f.calls.some((c) => c.method === 'open' || c.method === 'preview')).toBe(false)
})

test('all preview kinds fit the width/height matrix, wrap and scroll without losing their path', async () => {
  const f = fixture(); const r = await f.mount()
  f.previews['src/api/user.ts'] = { kind: 'code', text: 'x'.repeat(220) + '\nlast line\n', language: 'typescript' }
  for (const rel of Object.keys(f.previews)) {
    f.select(rel); await r.flush(); f.key('enter'); await r.flush()
    for (const h of [2, 5, 10, 24]) for (const w of [24, 40, 80, 120]) {
      f.setWidth(w); r.resize(w, h); await r.flush()
      expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
      expect(r.captureSpans().rows).toBe(h)
      f.key('down'); f.key('up')
    }
    f.key('esc'); await r.flush()
  }
}, 20000)

test('changed refreshes the current preview and discards its earlier completion', async () => {
  const f = fixture(); const pending: ((value: unknown) => void)[] = []
  f.setPreview(() => new Promise((resolve) => pending.push(resolve)))
  const r = await f.mount(); f.select('blob.bin'); await r.flush(); f.key('enter'); await r.flush()
  f.emit('changed'); await r.flush(); expect(pending).toHaveLength(2)
  pending[1]!({ kind: 'binary' }); await r.flush(); pending[0]!({ kind: 'empty' }); await r.flush()
  expect(r.captureCharFrame()).toContain('Binary file — no preview.')
})

test('file and rolled-up folder statuses use their theme color and letter', async () => {
  const f = fixture(); const r = await f.mount()
  f.select('src/api/user.ts'); await r.flush()
  for (const name of ['src', 'api', 'user.ts']) {
    const row = r.captureSpans().lines.find((l) => l.spans.some((s) => s.text.includes(name)))!
    expect(row.spans.some((s) => s.text.trim() === 'M' && s.fg.r > 0.9 && s.fg.g > 0.4 && s.fg.g < 0.6)).toBe(true)
  }
})

test('a filter with no matches cannot open the previous selection', async () => {
  const f = fixture(); const r = await f.mount()
  f.key('f'); await r.flush(); await r.mockInput.typeText('zzzz'); await r.flush()
  expect(r.captureCharFrame()).toContain('No files match "zzzz".')
  f.key('enter'); await r.flush(); expect(f.calls.some((c) => c.method === 'preview')).toBe(false)
})

test('malformed Git status data cannot crash the Files renderer', async () => {
  const f = fixture(); f.setGit({ root: '/acme-app', status: null }); const r = await f.mount()
  expect(r.captureCharFrame()).toContain('README.md')
  f.setGit({ root: '/acme-app', status: { entries: [null, 42, { path: 42 }, { path: 'README.md', worktree: 'unexpected' }] } })
  f.emit('changed'); await r.flush(); expect(r.captureCharFrame()).toContain('README.md')
})

test('CSV is capped at 200 rows and preview scrolling reaches wrapped content', async () => {
  const f = fixture(); const r = await f.mount(24, 5)
  f.previews['data.csv'] = { kind: 'csv', rows: Array.from({ length: 205 }, (_, i) => [String(i)]) }
  f.select('data.csv'); await r.flush(); f.key('enter'); await r.flush()
  for (let i = 0; i < 220; i++) f.key('down')
  await r.flush(); expect(r.captureCharFrame()).toContain('199'); expect(r.captureCharFrame()).not.toContain('200')
  f.key('esc'); await r.flush()
  f.previews['src/api/user.ts'] = { kind: 'code', text: 'x'.repeat(220) + '\nlast line\n', language: 'typescript' }
  f.select('src/api/user.ts'); await r.flush(); f.key('enter'); await r.flush()
  for (let i = 0; i < 15; i++) f.key('down')
  await r.flush(); expect(r.captureCharFrame()).toContain('last line')
  expect(f.notices).toHaveLength(0)
})

for (const height of [2, 5]) test(`filter remains editable and suppresses shortcuts at height ${height}`, async () => {
  const f = fixture(); const r = await f.mount(24, height)
  f.key('f'); await r.flush(); await r.mockInput.typeText('usr'); await r.flush()
  expect(r.captureCharFrame()).toContain('usr')
  expect(r.captureCharFrame()).toContain('user.ts')
  f.key('3'); f.key('a'); f.key('h'); await r.flush()
  expect(r.captureCharFrame()).toContain('usr'); expect(f.prompts).toHaveLength(0)
  expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= 24)).toBe(true)
  expect(r.captureSpans().rows).toBe(height)
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('export const user = 1')
})

test('literal leading-space filenames stay distinct for preview, mention, open and filter', async () => {
  const f = fixture()
  f.tree[''] = [file(' leading.ts'), file('leading.ts')]
  f.previews[' leading.ts'] = { kind: 'code', text: 'spaced sibling', language: 'typescript' }
  f.previews['leading.ts'] = { kind: 'code', text: 'plain sibling', language: 'typescript' }
  f.setAllFiles(async () => ({ files: [' leading.ts'] }))
  const r = await f.mount()
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('spaced sibling')
  expect(f.calls.filter((c) => c.method === 'preview').at(-1)?.input).toEqual({ rel: ' leading.ts' })
  f.key('a'); f.key('o'); await r.flush()
  expect(f.prompts.at(-1)?.value).toBe('@" leading.ts" ')
  expect(f.calls.filter((c) => c.method === 'open').at(-1)?.input).toEqual({ rel: ' leading.ts' })
  f.key('esc'); await r.flush(); f.key('down'); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('plain sibling')
  f.key('esc'); await r.flush(); f.key('f'); await r.flush(); await r.mockInput.typeText('leading'); await r.flush()
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('spaced sibling')
  f.emit('activity', { rel: ' leading.ts', kind: 'read' }); await r.flush()
  f.key('esc'); await r.flush(); f.key('esc'); await r.flush(); f.key('a'); await r.flush()
  expect(f.prompts.at(-1)?.value).toBe('@leading.ts ')
})

test('filter-list failures show a distinct error and recover on changed events and retry', async () => {
  const f = fixture(); const r = await f.mount()
  f.setAllFiles(async () => { throw new Error('unavailable') })
  f.key('f'); await r.flush(); await r.mockInput.typeText('usr'); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't list project files.")
  expect(r.captureCharFrame()).not.toContain('No files match')
  f.key('enter'); await r.flush(); expect(f.calls.some((c) => c.method === 'preview')).toBe(false)
  f.setAllFiles(async () => ({ files: ['src/api/user.ts'] })); f.emit('changed'); await r.flush()
  expect(r.captureCharFrame()).toContain('src/api/user.ts'); expect(r.captureCharFrame()).not.toContain("Can't list project files.")
  f.setAllFiles(async () => { throw new Error('unavailable') }); f.emit('changed'); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't list project files.")
  f.key('esc'); await r.flush(); f.setAllFiles(async () => ({ files: ['src/api/user.ts'] }))
  f.key('f'); await r.flush(); await r.mockInput.typeText('usr'); await r.flush()
  expect(r.captureCharFrame()).toContain('src/api/user.ts'); expect(r.captureCharFrame()).not.toContain("Can't list project files.")
})

test('o shows the server refusal for a runnable file as a toast', async () => {
  const f = fixture(); const r = await f.mount()
  f.setOpen(async () => ({ refused: 'Set editorCommand to open this file type.' }))
  f.select('src/api/user.ts'); await r.flush(); f.key('o'); await r.flush()
  expect(f.notices.at(-1)).toEqual({ message: 'Set editorCommand to open this file type.', variant: 'warning' })
  f.setOpen(async () => ({}))
  f.key('o'); await r.flush(); expect(f.notices).toHaveLength(1)
})


for (const width of [24, 40, 80, 120]) test(`Files arrows leave query editing on the highlighted result at ${width} columns`, async () => {
  const f = fixture(), paths = ['src/alpha-0.ts', 'src/alpha-1.ts', 'src/alpha-2.ts']
  f.setAllFiles(async () => ({ files: paths }))
  const r = await f.mount(width, 5), selected = () => paneMemory(f.ctx)[0].panes['session-a']!.selected.files
  f.key('s'); await r.flush(); await r.mockInput.typeText('alpha'); await r.flush()
  expect(selected()).toBe(paths[0])
  f.key('down'); await r.flush(); expect(selected()).toBe(paths[0])
  f.key('down'); await r.flush(); expect(selected()).toBe(paths[1])
  const editor = r.renderer.root.findDescendantById('files-query') as InputRenderable
  editor.focus(); await r.flush()
  f.key('up'); await r.flush(); expect(selected()).toBe(paths[1])
  f.key('up'); await r.flush(); expect(selected()).toBe(paths[0])
})

for (const width of [24, 40, 80, 120]) test(`live filename search separates controls and restores the original tree at ${width} columns`, async () => {
  const f = fixture(), paths = Array.from({ length: 35 }, (_, i) => `src/alpha-${String(i).padStart(2, '0')}.ts`)
  f.setAllFiles(async () => ({ files: ['src/data.ts', ...paths] }))
  for (const path of paths) f.previews[path] = { kind: 'code', text: path, language: 'typescript' }
  const r = await f.mount(width, 24)
  f.select('src/usage.ts'); await r.flush()
  f.key('s'); await r.flush(); await r.mockInput.typeText('a'); await r.flush()
  expect(r.captureCharFrame()).toContain('alpha-00.ts')
  expect(r.captureCharFrame()).not.toContain('data.ts')
  expect(r.captureCharFrame()).not.toContain('CancelClear')
  expect(r.captureCharFrame()).toMatch(/Cancel\s*·\s*Clear/)
  r.resize(width, 5); await r.flush()
  f.key('down'); await r.flush()
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('alpha-00.ts')
  f.key('q'); await r.flush()
  for (let i = 0; i < 25; i++) { f.key('down'); await r.flush() }
  expect(r.captureCharFrame()).toContain('alpha-25.ts')
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('alpha-25.ts')
  f.key('q'); await r.flush()
  expect(r.captureCharFrame()).toContain('alpha-25.ts')
  f.key('2'); await r.flush(); f.key('esc'); f.key('1'); await r.flush()
  expect(r.captureCharFrame()).toContain('alpha-25.ts')
  const lines = r.captureCharFrame().split('\n'), y = lines.findIndex(line => line.includes('Clear'))
  await r.mockMouse.click(lines[y]!.indexOf('Clear') + 1, y); await r.flush()
  f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain('const usage = 2')
  expect(f.calls.some(c => c.method === 'searchStart')).toBe(false)
})
