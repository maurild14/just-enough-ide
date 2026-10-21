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

type Context = Plugin.Context
type Layer = ReturnType<Parameters<Context['keymap']['layer']>[0]>
type Claim = Extract<Parameters<Context['ui']['slot']>[0], { append: 'session.panel' }>
const renderers: Awaited<ReturnType<typeof testRender>>[] = []
afterEach(() => { for (const r of renderers.splice(0)) r.renderer.destroy() })
const file = (name: string) => ({ name, kind: 'file', size: 10 })
const dir = (name: string) => ({ name, kind: 'dir', size: 0 })

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
  let git: unknown = { root: '/acme-app', status: { entries: [{ path: 'src/api/user.ts', index: null, worktree: 'modified' }] } }
  const api = {
    state: async () => ({ cwd: '/acme-app', options: parseOptions(options), git, activity: {} }),
    async listDir(input: { rel: string }) { calls.push({ method: 'listDir', input }); return listing(input.rel) },
    async preview(input: { rel: string }) { calls.push({ method: 'preview', input }); return preview(input.rel) },
    async allFiles() { calls.push({ method: 'allFiles', input: {} }); return allFiles() },
    async open(input: unknown) { calls.push({ method: 'open', input }); return opener(input) },
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
  const row = r.captureSpans().lines.find((l) => l.spans.some((s) => s.text.includes('user.ts')))!
  expect(row.spans.some((s) => s.fg.r > 0.9 && s.fg.g > 0.4 && s.fg.g < 0.6 && s.fg.b < 0.1)).toBe(true)
  f.key('enter'); await r.flush(); f.emit('activity', { rel: 'src/usage.ts', kind: 'read' }); await r.flush()
  expect(r.captureCharFrame()).toContain('export const user = 1')
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
  const clock = spyOn(Date, 'now').mockReturnValue(1000)
  const interval = spyOn(globalThis, 'setInterval')
  try {
    f.emit('activity', { rel: 'src/api/user.ts', kind: 'read' }); await r.flush()
    const row = () => r.captureSpans().lines.find((l) => l.spans.some((s) => s.text.includes('user.ts')))!
    const initial = row().spans.find((s) => s.text.includes('user.ts'))!.fg.toInts()
    const tick = interval.mock.calls.find((args) => args[1] === 250)![0] as () => void
    clock.mockReturnValue(2000); tick(); await r.flush()
    expect(row().spans.find((s) => s.text.includes('user.ts'))!.fg.toInts()).not.toEqual(initial)
    clock.mockReturnValue(3000); tick(); await r.flush()
    expect(row().spans.find((s) => s.text.includes('user.ts'))!.fg.toInts()).toEqual([255, 255, 255, 255])
    expect(row().spans.some((s) => s.text.includes('•') && (s.attributes & 2))).toBe(true)
    f.key('a'); await r.flush(); expect(f.prompts.at(-1)?.value).toBe('@src/api ')
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
