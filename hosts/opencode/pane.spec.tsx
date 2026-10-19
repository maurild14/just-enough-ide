import { afterEach, expect, spyOn, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import type { Plugin } from '@opencode/plugin/tui'
import { createMemo, createSignal, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { parseOptions } from '../../core/options.ts'
import { initialPane, reducePane } from '../../core/pane.ts'
import { cellWidth } from '../../core/shared/fit.ts'
import plugin from '../../tui.ts'
import { paneMemory } from './pane.tsx'

type Context = Plugin.Context
type Layer = ReturnType<Parameters<Context['keymap']['layer']>[0]>
type Claim = Extract<Parameters<Context['ui']['slot']>[0], { append: 'session.panel' }>
const renderers: Awaited<ReturnType<typeof testRender>>[] = []
afterEach(() => { for (const r of renderers.splice(0)) r.renderer.destroy() })

function fixture(options: Record<string, unknown> = {}) {
  let claim: Claim | undefined
  const layers: (() => Layer)[] = []
  const listeners = new Map<string, Set<(event: { data: unknown }) => void>>()
  const memory = new Map<string, unknown>()
  const [route, setRoute] = createSignal({ type: 'session', sessionID: 'session-a' })
  const [panel, setPanel] = createSignal<{ name: string; sessionID: string }>()
  const [width, setWidth] = createSignal(80)
  const [focused, setFocused] = createSignal(true)
  let opens = 0
  let reply: () => Promise<unknown> = async () => ({ cwd: '/acme-app', options: parseOptions(options), git: { root: null }, activity: {} })
  const ctx = {
    options, theme: { text: { base: 'white', muted: 'gray', action: { primary: { base: 'blue' } }, feedback: { error: { base: 'red' } } } },
    renderer: undefined,
    storage: { memory(key: string, config: { initial: object }) {
      if (!memory.has(key)) {
        const [store, setStore] = createStore(config.initial)
        memory.set(key, [store, (mutation: (draft: object) => void) => setStore(produce(mutation))])
      }
      return memory.get(key)
    } },
    client: { rpc: () => ({ state: () => reply(), events: { on(name: string, fn: (event: { data: unknown }) => void) {
      const handlers = listeners.get(name) ?? new Set()
      listeners.set(name, handlers)
      handlers.add(fn)
      return () => { handlers.delete(fn) }
    } } }) },
    keymap: { layer(factory: () => Layer) {
      const layer = createMemo(factory)
      layers.push(layer)
      onCleanup(() => { layers.splice(layers.indexOf(layer), 1) })
    } },
    ui: {
      slot(value: Claim) { claim = value; return () => { claim = undefined } },
      router: { current: route },
      panel: {
        current: panel,
        open(name: string, input: { presentation: string }) {
          expect(input).toEqual({ presentation: 'panel' })
          if (route().type !== 'session') return false
          opens++
          setPanel({ name, sessionID: route().sessionID })
          return true
        },
        close() { setPanel(undefined) },
      },
    },
  } as unknown as Context
  const input = {
    name: 'jei', get sessionID() { return route().sessionID },
    get width() { return width() }, get focused() { return focused() },
    presentation: 'panel' as const, focus() { setFocused(true) }, close() { setPanel(undefined) }, toggleFullscreen() {},
  }
  async function mount(w = 80, h = 10) {
    setWidth(w)
    const r = await testRender(() => {
      const cleanup = plugin.setup(ctx)
      if (typeof cleanup === 'function') onCleanup(cleanup)
      return claim?.render(input)
    }, { width: w, height: h })
    renderers.push(r)
    await r.flush()
    return r
  }
  function command(id: string, arg?: string) {
    const command = layers.flatMap((l) => l().commands ?? []).find((c) => c.id === id)
    expect(command).toBeDefined()
    return command!.run(arg)
  }
  function key(bind: string) {
    for (const layer of layers.map((l) => l()).reverse()) {
      const enabled = typeof layer.enabled === 'function' ? layer.enabled() : layer.enabled !== false
      if (!enabled) continue
      const command = layer.commands?.find((c) => c.bind === bind)
      if (command) return command.run()
    }
  }
  return { ctx, input, mount, command, key, layers, listeners, memory, panel, route, setRoute, setWidth, setFocused,
    get opens() { return opens }, setReply(fn: typeof reply) { reply = fn },
    emit(name: string, data: unknown = {}) { for (const fn of listeners.get(name) ?? []) fn({ data }) },
  }
}

test('the panel renders shared tabs and focused digit bindings switch views', async () => {
  const f = fixture()
  const r = await f.mount()
  expect(r.captureCharFrame()).toContain('1 Files  2 Search  3 Symbols  4 Git')
  f.key('4')
  await r.flush()
  expect(r.captureCharFrame()).toContain('Git')
  const active = r.captureSpans().lines[0]!.spans.find((s) => s.text.includes('4 Git'))
  expect(active?.attributes! & 1).toBe(1)
  f.key('2')
  await r.flush()
  expect(r.captureCharFrame()).toContain('Coming in a later version.')
  f.key('3')
  await r.flush()
  expect(r.captureCharFrame()).toContain('Coming in a later version.')
})

test('/jei opens the requested tab or path and toggles without losing selection', async () => {
  const f = fixture({ startOpen: false })
  const r = await f.mount()
  expect(f.opens).toBe(0)
  await f.command('jei.toggle', 'git')
  await r.flush()
  expect(f.panel()).toEqual({ name: 'jei', sessionID: 'session-a' })
  expect(r.captureSpans().lines[0]!.spans.some((s) => s.text.includes('4 Git') && (s.attributes & 1))).toBe(true)
  await f.command('jei.toggle', './src/long-component.ts')
  await r.flush()
  expect(r.captureCharFrame()).toContain('src/long-component.ts')
  await f.command('jei.toggle')
  expect(f.panel()).toBeUndefined()
  await f.command('jei.toggle')
  await r.flush()
  expect(r.captureCharFrame()).toContain('src/long-component.ts')
})

test('bindings follow focus and the current view, including Esc at short heights', async () => {
  const f = fixture()
  const r = await f.mount(40, 5)
  f.setFocused(false)
  f.key('4')
  await r.flush()
  expect(r.captureCharFrame()).toContain('1 Files')
  f.setFocused(true)
  f.key('4')
  f.key('2')
  await r.flush()
  const layer = f.layers.map((l) => l()).find((l) => l.commands?.some((c) => c.bind === 'esc'))!
  expect(layer.commands?.map((c) => c.bind)).toEqual(['1', '2', '3', '4', 'up', 'down', 'enter', 'esc'])
  expect(f.layers.flatMap((l) => l().commands ?? []).some((c) => c.bind === 'ctrl+n' || c.bind === 'ctrl+p')).toBe(false)
  expect(r.captureCharFrame()).not.toContain('esc')
})

test('Esc dispatches core back from a nested view and keeps the selected path', async () => {
  const f = fixture()
  const [, update] = paneMemory(f.ctx)
  update((draft) => { draft.panes['session-a'] = reducePane(initialPane('files'), { type: 'preview', rel: 'src/app.ts' }) })
  const r = await f.mount()
  expect(f.layers.flatMap((l) => l().commands ?? []).some((c) => c.bind === 'm')).toBe(true)
  f.key('esc')
  await r.flush()
  const commands = f.layers.flatMap((l) => l().commands ?? [])
  expect(commands.some((c) => c.bind === 'm')).toBe(false)
  expect(commands.some((c) => c.bind === 'f')).toBe(true)
  expect(r.captureCharFrame()).toContain('src/app.ts')
})

test('the width/height matrix and live resize preserve the requested Files selection', async () => {
  const f = fixture()
  const r = await f.mount(120, 24)
  await f.command('jei.toggle', 'src/界界界界界界界界界界界界界界界界.ts')
  for (const h of [5, 10, 24]) for (const w of [24, 40, 80, 120]) {
    f.setWidth(w)
    r.resize(w, h)
    await r.flush()
    const frame = r.captureCharFrame()
    expect(frame.trimEnd().split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
    expect(r.captureSpans().rows).toBe(h)
    expect(frame).toContain('.ts')
    if (h < 8) expect(frame).not.toContain('─')
    if (h < 10) expect(frame).not.toContain('esc')
  }
  const final = r.captureCharFrame()
  r.resize(24, 5)
  f.setWidth(24)
  await r.flush()
  r.resize(120, 24)
  f.setWidth(120)
  await r.flush()
  expect(r.captureCharFrame()).toBe(final)
})

test('startOpen opens once per session, survives remount and respects the option', async () => {
  const f = fixture()
  const first = await f.mount()
  expect(f.opens).toBe(1)
  await f.command('jei.toggle')
  expect(f.panel()).toBeUndefined()
  first.renderer.destroy()
  await f.mount()
  expect(f.opens).toBe(1)
  f.setRoute({ type: 'session', sessionID: 'session-b' })
  await Promise.resolve()
  expect(f.opens).toBe(2)
  f.setRoute({ type: 'session', sessionID: 'session-a' })
  await Promise.resolve()
  expect(f.opens).toBe(2)
})

test('changed refetches discard stale replies and malformed replies show an error', async () => {
  const f = fixture()
  const r = await f.mount()
  const replies: ((value: unknown) => void)[] = []
  f.setReply(() => new Promise((resolve) => { replies.push(resolve) }))
  f.emit('changed')
  f.emit('changed')
  replies[1]!({ cwd: '/acme-app/fresh', options: {}, git: { root: null }, activity: {} })
  await r.flush()
  replies[0]!({ cwd: '/acme-app/stale', options: {}, git: { root: null }, activity: {} })
  await r.flush()
  expect(r.captureCharFrame()).toContain('/acme-app/fresh')
  f.setReply(async () => ({ cwd: 42 }))
  f.emit('changed')
  await r.flush()
  expect(r.captureCharFrame()).toContain('Invalid JEI state.')
})

test('activity arms one 250 ms timer only while glowing and disposes listeners', async () => {
  const f = fixture()
  const r = await f.mount()
  const interval = spyOn(globalThis, 'setInterval')
  const clear = spyOn(globalThis, 'clearInterval')
  const clock = spyOn(Date, 'now').mockReturnValue(10000)
  try {
    f.emit('activity', { rel: 'src/app.ts', kind: 'write' })
    await r.flush()
    expect(interval.mock.calls.filter((args) => args[1] === 250)).toHaveLength(1)
    const tick = interval.mock.calls.find((args) => args[1] === 250)![0] as () => void
    clock.mockReturnValue(10250)
    tick()
    await r.flush()
    expect(interval.mock.calls.filter((args) => args[1] === 250)).toHaveLength(1)
    clock.mockReturnValue(12000)
    tick()
    await r.flush()
    expect(clear).toHaveBeenCalled()
    r.renderer.destroy()
    expect([...f.listeners.values()].every((s) => s.size === 0)).toBe(true)
    expect(f.layers).toHaveLength(0)
  } finally { clock.mockRestore(); interval.mockRestore(); clear.mockRestore() }
})

test('disabled activity stays idle and malformed events display a bounded error', async () => {
  const f = fixture({ activity: 'none' })
  const r = await f.mount(24, 5)
  const interval = spyOn(globalThis, 'setInterval')
  try {
    f.emit('activity', { rel: 'src/app.ts', kind: 'write' })
    await r.flush()
    expect(interval.mock.calls.filter((args) => args[1] === 250)).toHaveLength(0)
    f.emit('activity', { rel: 42, kind: 'write' })
    await r.flush()
    expect(r.captureCharFrame()).toContain('Invalid JEI activity.')
  } finally { interval.mockRestore() }
})

test('unmount clears a glowing timer and ignores a pending refresh completion', async () => {
  const f = fixture()
  const r = await f.mount()
  let complete!: (value: unknown) => void
  f.setReply(() => new Promise((resolve) => { complete = resolve }))
  f.emit('changed')
  const clear = spyOn(globalThis, 'clearInterval')
  try {
    f.emit('activity', { rel: 'src/app.ts', kind: 'read' })
    await r.flush()
    r.renderer.destroy()
    expect(clear).toHaveBeenCalled()
    complete({ cwd: '/acme-app/late', options: {}, git: { root: null }, activity: {} })
    await Promise.resolve()
    expect([...f.listeners.values()].every((s) => s.size === 0)).toBe(true)
  } finally { clear.mockRestore() }
})

test('a delayed state reply cannot erase newer live activity', async () => {
  const f = fixture()
  const r = await f.mount()
  let complete!: (value: unknown) => void
  f.setReply(() => new Promise((resolve) => { complete = resolve }))
  f.emit('changed')
  const interval = spyOn(globalThis, 'setInterval')
  const clear = spyOn(globalThis, 'clearInterval')
  try {
    f.emit('activity', { rel: 'src/app.ts', kind: 'write' })
    await r.flush()
    const index = interval.mock.calls.findIndex((args) => args[1] === 250)
    const timer = interval.mock.results[index]!.value
    complete({ cwd: '/acme-app', options: {}, git: { root: null }, activity: {} })
    await r.flush()
    expect(clear.mock.calls.some(([handle]) => handle === timer)).toBe(false)
  } finally { interval.mockRestore(); clear.mockRestore() }
})
