import { afterEach, expect, test } from 'bun:test'
import { InputRenderable, RGBA } from '@opentui/core'
import { testRender } from '@opentui/solid'
import type { Plugin } from '@opencode/plugin/tui'
import { createMemo, createSignal, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { parseOptions } from '../../core/options.ts'
import { cellWidth } from '../../core/shared/fit.ts'
import plugin from '../../tui.ts'

type Context = Plugin.Context
type Layer = ReturnType<Parameters<Context['keymap']['layer']>[0]>
type Claim = Extract<Parameters<Context['ui']['slot']>[0], { append: 'session.panel' }>
const renderers: Awaited<ReturnType<typeof testRender>>[] = []
afterEach(() => { for (const r of renderers.splice(0)) r.renderer.destroy() })
const entry = (path: string, index: string | null = null, worktree: string | null = 'modified') => ({ path, index, worktree })
const repo = (entries = [entry('src/app.ts'), entry('staged.ts', 'added', null), entry('new.ts', null, 'untracked')]) => ({
  root: '/acme-app', status: { branch: { head: 'main', oid: 'abc1234', upstream: 'origin/main', ahead: 1, behind: 2 }, entries },
  numstat: { 'src/app.ts': { added: 12, removed: 3 } }, staged: { 'staged.ts': { added: 1, removed: 0 } }, hooks: false,
})
const diff = (path = 'src/app.ts') => ({ file: { path, binary: false, added: 2, removed: 1, hunks: [
  { header: '@@ -1,2 +1,2 @@', lines: [{ kind: 'ctx', text: 'context', oldNo: 1, newNo: 1 }, { kind: 'del', text: 'before', oldNo: 2 }, { kind: 'add', text: 'after', newNo: 2 }] },
  { header: '@@ -20,0 +20,1 @@', lines: [{ kind: 'add', text: 'later', newNo: 20 }] },
] }, truncated: false })

function fixture(options: Record<string, unknown> = {}) {
  const layers: (() => Layer)[] = []
  const listeners = new Set<() => void>()
  const memory = new Map<string, unknown>()
  const [width, setWidth] = createSignal(80)
  const calls: { method: string; input: any }[] = []
  const confirms: any[] = []; const selects: any[] = []; const prompts: any[] = []; const sent: any[] = []; const notices: any[] = []
  let claim!: Claim
  let git: unknown = repo()
  let confirmation: boolean | undefined = false
  let selection: unknown = undefined
  let edited: string | undefined = undefined
  const handlers: Record<string, (input: any) => Promise<unknown>> = {
    state: async () => ({ cwd: '/acme-app', options: parseOptions({ ...options, defaultTab: 'git' }), git, activity: {} }),
    generate: async () => ({ message: 'feat: update app' }), commitPlan: async () => ({ steps: [], sensitive: [], viaAgentShell: false }),
    diff: async (input) => diff(input.path), sync: async () => ({ ok: true }),
  }
  const api = Object.fromEntries(['state', 'stage', 'unstage', 'discard', 'diff', 'generate', 'commitPlan', 'commit', 'init', 'sync', 'open'].map((method) => [method, async (input: any) => { calls.push({ method, input }); return handlers[method]?.(input) ?? {} }]))
  api.events = { on(name: string, fn: () => void) { if (name === 'changed') listeners.add(fn); return () => listeners.delete(fn) } } as any
  const ctx = {
    options: { ...options, defaultTab: 'git' }, theme: { text: { base: 'white', muted: 'gray', action: { primary: { base: 'blue' } }, feedback: { error: { base: 'red' }, warning: { base: 'yellow' }, success: { base: 'green' }, info: { base: 'magenta' } } },
      background: { action: { primary: { base: 'blue' } } }, diff: { text: { added: RGBA.fromHex('#12ef34'), removed: 'red', context: 'white', hunkHeader: 'cyan' }, lineNumber: { text: 'gray' } } },
    storage: { memory(key: string, config: { initial: object }) { if (!memory.has(key)) { const [s, set] = createStore(config.initial); memory.set(key, [s, (fn: (draft: object) => void) => set(produce(fn))]) } return memory.get(key) } },
    client: { rpc: () => api, session: { async prompt(input: unknown) { sent.push(input) } } },
    keymap: { layer(factory: () => Layer) { const l = createMemo(factory); layers.push(l); onCleanup(() => layers.splice(layers.indexOf(l), 1)) } },
    ui: { slot(value: Claim) { claim = value; return () => {} }, router: { current: () => ({ type: 'session', sessionID: 'session-a' }) }, panel: { open: () => true },
      dialog: { async confirm(input: unknown) { confirms.push(input); return handlers.confirm ? handlers.confirm(input) : confirmation }, async select(input: unknown) { selects.push(input); return selection }, async prompt(input: unknown) { prompts.push(input); return edited } },
      toast: { show(input: unknown) { notices.push(input) } } },
  } as unknown as Context
  async function mount(w = 80, h = 24) {
    setWidth(w)
    const r = await testRender(() => { plugin.setup(ctx); return claim.render({ name: 'jei', sessionID: 'session-a', get width() { return width() }, focused: true, presentation: 'panel', focus() {}, close() {}, toggleFullscreen() {} }) }, { width: w, height: h })
    renderers.push(r); await r.flush(); return r
  }
  function key(bind: string) { return layers.flatMap((l) => l().commands ?? []).findLast((c) => c.bind === bind && (typeof c.enabled === 'function' ? c.enabled() : c.enabled !== false))?.run() }
  return { mount, key, calls, confirms, selects, prompts, sent, notices, handlers, setWidth, layers,
    setGit(value: unknown) { git = value }, confirm(value: boolean | undefined) { confirmation = value }, choose(value: unknown) { selection = value }, edit(value: string | undefined) { edited = value },
    changed() { for (const fn of listeners) fn() },
  }
}

test('Git offers initialization outside a repository and immediately reloads after init', async () => {
  const f = fixture(); f.setGit({ root: null }); const r = await f.mount()
  expect(r.captureCharFrame()).toContain('This folder is not a git repository.')
  expect(r.captureCharFrame()).toContain('Initialize repository')
  f.handlers.init = async () => { f.setGit(repo()); return {} }
  f.key('enter'); await r.flush()
  expect(f.calls.some((c) => c.method === 'init')).toBe(true)
  expect(r.captureCharFrame()).toContain('main*')
})

test('repository metadata, group counts, stage/unstage and confirmed discard use literal relative paths and refresh', async () => {
  const f = fixture(); const r = await f.mount(120)
  expect(r.captureCharFrame()).toContain('acme-app'); expect(r.captureCharFrame()).toContain('↓2 ↑1')
  expect(r.captureCharFrame()).toContain('Staged'); expect(r.captureCharFrame()).toContain('Changes')
  expect(r.captureCharFrame()).toContain('+12 −3')
  expect(r.captureCharFrame()).toContain('Stage all'); expect(r.captureCharFrame()).toContain('Unstage all'); expect(r.captureCharFrame()).toContain('Discard all')
  // The first selection is the Staged group; unstage applies to the group.
  f.key('u'); await r.flush()
  expect(f.calls.find((c) => c.method === 'unstage')?.input).toEqual({ paths: ['staged.ts'] })
  f.key('down'); f.key('down'); await r.flush() // Changes group
  f.key('s'); await r.flush()
  expect(f.calls.find((c) => c.method === 'stage')?.input).toEqual({ paths: ['new.ts', 'src/app.ts'] })
  f.key('d'); await r.flush(); expect(f.calls.some((c) => c.method === 'discard')).toBe(false)
  expect(f.confirms.at(-1).message).toContain('1 untracked will be deleted')
  f.confirm(undefined); f.key('d'); await r.flush(); expect(f.calls.some((c) => c.method === 'discard')).toBe(false)
  f.confirm(true); f.key('d'); await r.flush()
  expect(f.calls.find((c) => c.method === 'discard')?.input).toEqual({ paths: ['new.ts', 'src/app.ts'] })
  expect(f.calls.filter((c) => c.method === 'state')).toHaveLength(4)
  f.setGit(repo([entry(' -f.ts'), entry('-f.ts'), entry('app/[id].tsx')]))
  f.changed(); await r.flush(); f.key('down'); await r.flush(); f.key('s'); await r.flush()
  expect(f.calls.filter((c) => c.method === 'stage').at(-1)?.input).toEqual({ paths: [' -f.ts'] })
  f.key('d'); await r.flush(); expect(f.confirms.at(-1).message).toContain(' -f.ts')
})

test('generation fills the native message input, c picks the commit mode, input typing suppresses shortcuts and Enter commits', async () => {
  const f = fixture(); const r = await f.mount()
  f.key('g'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  expect(input?.value).toBe('feat: update app')
  f.choose('commit-push'); f.key('c'); await r.flush()
  expect(f.selects.at(-1).options.map((o: any) => o.title)).toEqual(['Commit', 'Commit & Push', 'Commit (amend)'])
  for (const key of ['1', '4', 's', 'u', 'd', 'c', 'g', 'e']) f.key(key)
  await r.mockInput.typeText(' safely'); await r.flush()
  expect(f.calls.filter((c) => c.method === 'generate')).toHaveLength(1)
  expect(f.selects).toHaveLength(1)
  input.submit(); await r.flush()
  expect(f.calls.find((c) => c.method === 'commit')?.input).toEqual({ message: 'feat: update app safely', mode: 'commit-push', approvedSensitive: [] })
  expect(f.calls.at(-1)?.method).toBe('state')
})

test('sensitive paths require approval, cancel preserves the message, and duplicate submits cannot commit twice', async () => {
  const f = fixture(); const r = await f.mount()
  f.handlers.commitPlan = async () => ({ steps: [], sensitive: ['.env', 'keys/id_rsa'], viaAgentShell: true })
  f.key('g'); await r.flush(); f.choose('amend'); f.key('c'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.submit(); await r.flush()
  expect(f.confirms.at(-1).message).toContain('.env'); expect(f.confirms.at(-1).message).toContain('keys/id_rsa')
  expect(f.calls.some((c) => c.method === 'commit')).toBe(false)
  f.confirm(true)
  let finish!: (value: unknown) => void
  f.handlers.commit = () => new Promise((resolve) => { finish = resolve })
  input.submit(); input.submit(); await r.flush()
  expect(f.calls.filter((c) => c.method === 'commit')).toHaveLength(1)
  expect(f.calls.find((c) => c.method === 'commit')?.input).toMatchObject({ mode: 'amend', approvedSensitive: ['.env', 'keys/id_rsa'] })
  finish({}); await r.flush(); expect(input.value).toBe('')
})

test('sync divergence offers Merge/Rebase/Ask, supports cancel, and sends editable context', async () => {
  const f = fixture(); const r = await f.mount()
  f.handlers.sync = async (input) => input.choice ? { ok: true } : { ok: false, divergence: true }
  f.key('e'); await r.flush()
  expect(f.selects.at(-1).options.map((o: any) => o.title)).toEqual(['Merge', 'Rebase', 'Ask OpenCode'])
  expect(f.calls.filter((c) => c.method === 'sync')).toHaveLength(1)
  for (const choice of ['merge', 'rebase']) {
    f.choose(choice); f.key('e'); await r.flush()
    expect(f.calls.filter((c) => c.method === 'sync').at(-1)?.input).toEqual({ choice })
    expect(f.calls.at(-1)?.method).toBe('state')
  }
  f.choose('ask'); f.edit('Please explain my divergence.'); f.key('e'); await r.flush()
  expect(f.prompts.at(-1).value).toContain('main and origin/main have diverged')
  expect(f.sent.at(-1)).toEqual({ sessionID: 'session-a', text: 'Please explain my divergence.' })
})

test('Enter opens a themed numbered diff; n/p navigate hunks, j/k files, a reviews, o opens and Esc restores selection', async () => {
  const f = fixture(); f.setGit(repo([entry('a.ts'), entry('b.ts')]))
  const r = await f.mount(120, 10)
  f.key('down'); f.key('enter'); await r.flush()
  expect(f.calls.find((c) => c.method === 'diff')?.input).toEqual({ path: 'a.ts', staged: false, untracked: false })
  expect(r.captureCharFrame()).toContain('+after')
  expect(r.captureSpans().lines.flatMap((l) => l.spans).some((s) => s.text.includes('+after') && s.fg.g > 0.9 && s.fg.r < 0.1)).toBe(true)
  expect(r.captureCharFrame()).toMatch(/2\s+\+after/)
  f.key('n'); await r.flush(); expect(r.captureCharFrame()).toContain('+later'); expect(r.captureCharFrame()).not.toContain('+after')
  f.key('p'); await r.flush(); expect(r.captureCharFrame()).toContain('+after')
  f.key('j'); await r.flush(); expect(f.calls.filter((c) => c.method === 'diff').at(-1)?.input.path).toBe('b.ts')
  f.key('k'); await r.flush(); expect(f.calls.filter((c) => c.method === 'diff').at(-1)?.input.path).toBe('a.ts')
  f.edit('Review this change.'); f.key('a'); await r.flush()
  expect(f.prompts.at(-1).value).toStartWith('Review this diff of a.ts:')
  expect(f.sent.at(-1).text).toBe('Review this change.')
  f.key('o'); await r.flush(); expect(f.calls.at(-1)).toEqual({ method: 'open', input: { rel: 'a.ts' } })
  f.key('esc'); await r.flush(); f.key('s'); await r.flush()
  expect(f.calls.filter((c) => c.method === 'stage').at(-1)?.input).toEqual({ paths: ['a.ts'] })
})

test('Git and diff preserve selection, wrapped content and message editing at every required size', async () => {
  const f = fixture(); f.setGit(repo(Array.from({ length: 30 }, (_, i) => entry(`file-${String(i).padStart(2, '0')}.ts`))))
  const r = await f.mount(120, 24)
  for (let i = 0; i < 24; i++) f.key('down')
  await r.flush()
  for (const h of [2, 5, 10, 24]) for (const w of [24, 40, 80, 120]) {
    f.setWidth(w); r.resize(w, h); await r.flush()
    const frame = r.captureCharFrame()
    expect(frame.split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
    expect(frame).toContain('file-23.ts'); expect(r.captureSpans().rows).toBe(h)
    f.key('enter'); await r.flush()
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
    f.key('esc'); await r.flush()
    f.choose('commit'); f.key('c'); await r.flush()
    await r.mockInput.typeText('x'); await r.flush()
    const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
    expect(input.value.length).toBeGreaterThan(0)
    f.key('g'); f.key('4'); await r.flush(); expect(f.calls.some((c) => c.method === 'generate')).toBe(false)
    f.key('esc'); await r.flush()
  }
  f.setWidth(120); r.resize(120, 24); await r.flush(); f.key('s'); await r.flush()
  expect(f.calls.filter((c) => c.method === 'stage').at(-1)?.input).toEqual({ paths: ['file-23.ts'] })
}, 20000)

for (const [label, response, notice] of [
  ['empty', { file: null, truncated: false }, 'No changes.'],
  ['binary', { file: { ...diff().file, binary: true, hunks: [] }, truncated: false }, 'Binary file. Press o'],
  ['malformed', { file: { hunks: 'bad' }, truncated: false }, "Can't show this diff"],
  ['truncated', { ...diff(), truncated: true }, 'Diff truncated at 5,000'],
] as const) test(`diff ${label} state is bounded across sizes`, async () => {
  const f = fixture(); f.handlers.diff = async () => response; const r = await f.mount()
  f.key('down'); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain(notice)
  for (const h of [2, 5, 10, 24]) for (const w of [24, 40, 80, 120]) {
    f.setWidth(w); r.resize(w, h); await r.flush()
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
    f.key('o'); await r.flush(); expect(f.calls.at(-1)?.method).toBe('open')
  }
})

test('newer files and changed events beat delayed diff replies, including failures and disposal', async () => {
  const f = fixture(); f.setGit(repo([entry('a.ts'), entry('b.ts')]))
  const pending: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
  f.handlers.diff = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  const r = await f.mount(); f.key('down'); f.key('enter'); await r.flush()
  f.key('j'); await r.flush()
  pending[1]!.resolve({ file: null, truncated: false }); await r.flush()
  pending[0]!.resolve(diff('a.ts')); await r.flush()
  expect(r.captureCharFrame()).toContain('No changes.'); expect(r.captureCharFrame()).not.toContain('+after')
  f.changed(); await r.flush(); f.changed(); await r.flush()
  pending[3]!.resolve(diff('b.ts')); await r.flush(); pending[2]!.reject(new Error('old failure')); await r.flush()
  expect(r.captureCharFrame()).toContain('+after'); expect(r.captureCharFrame()).not.toContain('old failure')
  f.changed(); await r.flush(); r.renderer.destroy(); pending.at(-1)!.resolve(diff()); await Promise.resolve()
})

test('malformed Git state stays inert, mode cancel stays out of input, blank messages never commit and RPC failures stay bounded', async () => {
  const f = fixture(); const r = await f.mount()
  f.key('c'); await r.flush(); f.key('s'); await r.flush()
  expect(f.calls.some((c) => c.method === 'unstage')).toBe(false)
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.focus(); await r.mockInput.typeText('   '); input.submit(); await r.flush(); expect(f.calls.some((c) => c.method === 'commitPlan')).toBe(false)
  f.key('esc'); await r.flush()
  f.handlers.unstage = async () => { throw new Error('fatal: unavailable\n' + 'details'.repeat(80)) }
  f.key('u'); await r.flush()
  expect(f.notices.at(-1).message).toContain('fatal: unavailable')
  expect(f.notices.at(-1).message).not.toContain('details')
  expect(cellWidth(f.notices.at(-1).message)).toBeLessThanOrEqual(80)
  f.setGit({ root: '/acme-app', status: { branch: { ahead: -1 }, entries: [] } }); f.changed(); await r.flush()
  expect(r.captureCharFrame()).toContain('Invalid Git reply.')
  const before = f.calls.length; for (const key of ['s', 'u', 'd', 'c', 'g', 'e', 'enter']) f.key(key)
  await r.flush(); expect(f.calls).toHaveLength(before)
})

test('clean, detached, no upstream, hooks and narrow status letters remain explicit', async () => {
  const f = fixture(); const clean = repo([]); clean.status.branch.head = null as any; clean.status.branch.upstream = null as any; clean.hooks = true
  f.setGit(clean); const r = await f.mount(120)
  expect(r.captureCharFrame()).toContain('No changes.'); expect(r.captureCharFrame()).toContain('Detached at abc1234')
  expect(r.captureCharFrame()).toContain('No upstream branch.'); expect(r.captureCharFrame()).toContain('hooks')
  f.setGit(repo([entry('src/deep/'.repeat(8) + 'long-name.ts')])); f.changed(); await r.flush(); f.key('down'); await r.flush()
  f.setWidth(24); r.resize(24, 5); await r.flush()
  expect(r.captureCharFrame()).toMatch(/ M .*\.ts/)
})

test('group mouse actions are functional and duplicate clicks stay busy until the immediate refresh ends', async () => {
  const f = fixture(); const r = await f.mount(120)
  let finish!: (v: unknown) => void
  f.handlers.stage = () => new Promise((resolve) => { finish = resolve })
  const lines = r.captureCharFrame().split('\n'); const y = lines.findIndex((l) => l.includes('Stage all')); const x = lines[y]!.indexOf('Stage all')
  await r.mockMouse.click(x + 1, y); await r.mockMouse.click(x + 1, y); await r.flush()
  expect(f.calls.filter((c) => c.method === 'stage')).toHaveLength(1)
  finish({}); await r.flush(); expect(f.calls.at(-1)?.method).toBe('state')
  const bindings = f.layers.flatMap((l) => l().commands ?? []).map((c) => c.bind)
  expect(bindings).not.toContain('ctrl+n'); expect(bindings).not.toContain('ctrl+p')
  const before = f.calls.length; f.key('S'); f.key('ctrl+s'); await r.flush(); expect(f.calls).toHaveLength(before)
})

test('a sensitive file arriving between plan and commit is confirmed before retry', async () => {
  const f = fixture(); const r = await f.mount()
  let planned = 0
  f.handlers.commitPlan = async () => ({ steps: [], sensitive: planned++ ? ['.env.local'] : [], viaAgentShell: false })
  f.handlers.commit = async (input) => { if (!input.approvedSensitive.includes('.env.local')) throw new Error('Sensitive files require confirmation.'); return {} }
  f.key('g'); await r.flush(); f.choose('commit'); f.key('c'); await r.flush(); f.confirm(true)
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.submit(); await r.flush()
  expect(f.confirms.at(-1)?.message).toContain('.env.local')
  expect(f.calls.filter((c) => c.method === 'commit').map((c) => c.input.approvedSensitive)).toEqual([[], ['.env.local']])
})

test('hunk position survives width changes that rewrap earlier diff lines', async () => {
  const f = fixture(); const value = diff()
  value.file.hunks[0]!.lines[0]!.text = '界'.repeat(180) + 'tail'
  f.handlers.diff = async () => value
  const r = await f.mount(120, 10); f.key('down'); f.key('enter'); await r.flush(); f.key('n'); await r.flush()
  expect(r.captureCharFrame()).toContain('+later')
  for (const width of [24, 40, 80, 120]) {
    f.setWidth(width); r.resize(width, 10); await r.flush()
    expect(r.captureCharFrame()).toContain('+later')
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= width)).toBe(true)
  }
  f.key('p'); await r.flush(); expect(r.captureCharFrame()).toContain('界')
})

test('stale state after a mutation cannot replace a later changed-event snapshot', async () => {
  const f = fixture(); const r = await f.mount()
  const pending: ((v: unknown) => void)[] = []
  f.handlers.state = () => new Promise((resolve) => pending.push(resolve))
  f.key('u'); await r.flush(); f.changed(); await r.flush()
  pending[1]!({ cwd: '/acme-app', options: parseOptions({}), git: repo([entry('fresh.ts')]), activity: {} }); await r.flush()
  pending[0]!({ cwd: '/acme-app', options: parseOptions({}), git: repo([entry('stale.ts')]), activity: {} }); await r.flush()
  expect(r.captureCharFrame()).toContain('fresh.ts'); expect(r.captureCharFrame()).not.toContain('stale.ts')
})

test('diff RPC errors, generate errors, sync errors and cancelled review never report success', async () => {
  const f = fixture(); const r = await f.mount()
  f.handlers.generate = async () => { throw new Error('model unavailable\nprivate detail') }
  f.key('g'); await r.flush(); expect(f.notices.at(-1).message).toContain('model unavailable')
  f.handlers.sync = async () => ({ ok: false, error: 'remote unavailable' })
  f.key('e'); await r.flush(); expect(f.notices.at(-1).message).toContain('remote unavailable')
  f.handlers.diff = async () => { throw new Error('fatal: unavailable\nprivate detail') }
  f.key('down'); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't show this diff: fatal: unavailable")
  expect(r.captureCharFrame()).not.toContain('private detail')
  f.key('esc'); await r.flush(); f.handlers.diff = async () => diff(); f.key('enter'); await r.flush(); f.key('a'); await r.flush()
  expect(f.prompts.at(-1).value).toContain('Review this diff of staged.ts:')
  expect(f.sent).toHaveLength(0)
})

test('native input focus suppresses JEI shortcuts even when focus arrives outside the mode picker', async () => {
  const f = fixture(); const r = await f.mount()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.focus(); await r.flush()
  const before = f.calls.length; for (const key of ['1', 's', 'u', 'g', 'c', 'e']) f.key(key)
  await r.mockInput.typeText('feat: native focus'); await r.flush()
  expect(f.calls).toHaveLength(before); expect(input.value).toBe('feat: native focus')
  f.key('esc'); await r.flush(); f.key('u'); await r.flush()
  expect(f.calls.some((c) => c.method === 'unstage')).toBe(true)
})

test('the drafted message and current commit mode survive switching tabs', async () => {
  const f = fixture(); const r = await f.mount()
  f.choose('amend'); f.key('c'); await r.flush(); await r.mockInput.typeText('fix: keep draft'); f.key('esc'); await r.flush()
  f.key('2'); await r.flush(); f.key('4'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  expect(input.value).toBe('fix: keep draft')
  f.choose(undefined); f.key('c'); await r.flush(); expect(f.selects.at(-1).current).toBe('amend')
})

test('a pending commit stays busy across a tab remount and preserves a newer draft', async () => {
  const f = fixture(); const r = await f.mount()
  let finish!: (v: unknown) => void
  f.handlers.commit = () => new Promise((resolve) => { finish = resolve })
  f.key('g'); await r.flush(); f.choose('commit'); f.key('c'); await r.flush()
  ;(r.renderer.root.findDescendantById('git-message') as InputRenderable).submit(); await r.flush()
  f.key('esc'); f.key('2'); await r.flush(); f.key('4'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.focus(); await r.mockInput.typeText(' next'); input.submit(); await r.flush()
  expect(f.calls.filter((c) => c.method === 'commit')).toHaveLength(1)
  finish({}); await r.flush(); expect(input.value).toContain('next')
})

for (const separator of ['\n\n', '\r\n\r\n']) test(`generated body survives native subject editing (${JSON.stringify(separator)})`, async () => {
  const f = fixture(); const subject = 'feat: preserve generated draft'; const body = 'Body detail. '.repeat(110)
  f.handlers.generate = async () => ({ message: subject + separator + body })
  const r = await f.mount(); f.key('g'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  expect(input.value).toBe(subject)
  expect(r.captureCharFrame()).toContain('Edit subject (body kept)')
  input.value = ''; input.submit(); await r.flush()
  expect(f.calls.some((c) => c.method === 'commit')).toBe(false)
  input.value = subject
  f.choose('commit'); f.key('c'); await r.flush(); await r.mockInput.typeText(' safely'); input.submit(); await r.flush()
  expect(f.calls.find((c) => c.method === 'commit')?.input.message).toBe(subject + ' safely' + separator + body.trimEnd())
})

test('a generated subject longer than the native default limit survives editing, resize and tab remount', async () => {
  const f = fixture(); const subject = 'feat: ' + 'x'.repeat(1100)
  f.handlers.generate = async () => ({ message: subject })
  const r = await f.mount(); f.key('g'); await r.flush(); f.key('2'); await r.flush(); f.key('4'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  expect(input.value).toBe(subject)
  for (const h of [2, 5, 10, 24]) for (const w of [24, 40, 80, 120]) {
    f.setWidth(w); r.resize(w, h); await r.flush(); expect(input.value).toBe(subject)
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= w)).toBe(true)
  }
  input.focus(); await r.mockInput.typeText(' edited'); input.submit(); await r.flush()
  expect(f.calls.find((c) => c.method === 'commit')?.input.message).toBe(subject + ' edited')
})

test('sensitive approval is rechecked after each dialog and newly arriving paths require another approval', async () => {
  const f = fixture(); const r = await f.mount(); let plans = 0
  f.handlers.commitPlan = async () => ({ steps: [], sensitive: plans++ === 0 ? ['.env'] : ['.env', 'id_rsa'], viaAgentShell: false })
  f.handlers.confirm = async () => f.confirms.length === 1
  f.key('g'); await r.flush(); f.choose('commit'); f.key('c'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.submit(); input.submit(); await r.flush()
  expect(f.confirms).toHaveLength(2)
  expect(f.confirms[0].message).toContain('.env'); expect(f.confirms[0].message).not.toContain('id_rsa')
  expect(f.confirms[1].message).toContain('.env'); expect(f.confirms[1].message).toContain('id_rsa')
  expect(f.calls.some((c) => c.method === 'commit')).toBe(false)
  delete f.handlers.confirm; f.confirm(true); input.submit(); await r.flush()
  expect(f.calls.filter((c) => c.method === 'commit')).toHaveLength(1)
  expect(f.calls.find((c) => c.method === 'commit')?.input.approvedSensitive).toEqual(['.env', 'id_rsa'])
  expect(plans).toBe(4)
})

test('the commit waits for approval of newly arriving sensitive files and then replans once more', async () => {
  const f = fixture(); const r = await f.mount(); let plans = 0; let approveNew!: (value: boolean) => void
  f.handlers.commitPlan = async () => ({ steps: [], sensitive: plans++ === 0 ? ['.env'] : ['.env', 'id_rsa'], viaAgentShell: false })
  f.handlers.confirm = async () => f.confirms.length === 1 ? true : new Promise((resolve) => { approveNew = resolve })
  f.key('g'); await r.flush(); f.choose('commit'); f.key('c'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.submit(); await r.flush(); input.submit(); await r.flush()
  expect(f.confirms).toHaveLength(2); expect(f.calls.some((c) => c.method === 'commit')).toBe(false)
  approveNew(true); await r.flush()
  expect(plans).toBe(3)
  expect(f.calls.filter((c) => c.method === 'commit').map((c) => c.input.approvedSensitive)).toEqual([['.env', 'id_rsa']])
})

test('the message placeholder follows branch and width, and smart-commit guidance follows options and mode', async () => {
  const f = fixture(); f.setGit(repo([entry('app.ts')]))
  const r = await f.mount(80)
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  expect(input.placeholder).toBe('Message (enter to commit on "main")')
  expect(r.captureCharFrame()).toContain('Nothing staged. Commit stages all changes.')
  for (const width of [24, 40, 80, 120]) {
    f.setWidth(width); r.resize(width, 24); await r.flush()
    expect(input.placeholder).toBe(width >= 60 ? 'Message (enter to commit on "main")' : 'Message')
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= width)).toBe(true)
  }
  f.choose('amend'); f.key('c'); await r.flush()
  expect(r.captureCharFrame()).not.toContain('Nothing staged. Commit stages all changes.')
  const disabled = fixture({ smartCommit: false }); disabled.setGit(repo([entry('app.ts')]))
  const off = await disabled.mount(120); expect(off.captureCharFrame()).not.toContain('Nothing staged. Commit stages all changes.')
  const staged = fixture(); const stagedView = await staged.mount(120)
  expect(stagedView.captureCharFrame()).not.toContain('Nothing staged. Commit stages all changes.')
  f.key('esc'); const long = repo([entry('app.ts')]); long.status.branch.head = 'feature/' + 'x'.repeat(120)
  f.setGit(long); f.changed(); await r.flush(); expect(input.placeholder).toBe('Message')
})

for (const kind of [['add'], { toString: 'add' }]) test(`diff rejects non-string line kind ${JSON.stringify(kind)}`, async () => {
  const f = fixture(); const value = diff()
  value.file.hunks[0]!.lines[0]!.kind = kind as unknown as string
  f.handlers.diff = async () => value
  const r = await f.mount(120); f.key('down'); f.key('enter'); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't show this diff: Invalid diff reply.")
  for (const height of [2, 5, 10, 24]) for (const width of [24, 40, 80, 120]) {
    f.setWidth(width); r.resize(width, height); await r.flush()
    expect(r.captureCharFrame()).not.toContain('+after')
    expect(r.captureCharFrame().split('\n').every((line) => cellWidth(line) <= width)).toBe(true)
  }
})

for (const retry of [false, true]) test(`a server refusal after the last TUI plan requires complete-list reapproval (retry ${retry})`, async () => {
  const f = fixture(); const r = await f.mount(); let plans = 0
  f.handlers.commitPlan = async () => ({ steps: [], sensitive: plans++ < 2 ? ['.env'] : ['.env', 'id_rsa'], viaAgentShell: false })
  f.handlers.confirm = async () => f.confirms.length === 1 || retry
  f.handlers.commit = async (input) => {
    if (!['.env', 'id_rsa'].every((path) => input.approvedSensitive.includes(path))) throw new Error('Sensitive files require confirmation.')
    return {}
  }
  f.key('g'); await r.flush(); f.choose('commit'); f.key('c'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.submit(); input.submit(); await r.flush()
  expect(f.confirms).toHaveLength(2)
  expect(f.confirms[1].message).toBe('These files look sensitive:\n.env\nid_rsa')
  expect(f.calls.filter((c) => c.method === 'commit').map((c) => c.input.approvedSensitive)).toEqual(retry ? [['.env'], ['.env', 'id_rsa']] : [['.env']])
  expect(input.value).toBe(retry ? '' : 'feat: update app')
})

test('a merge conflict refuses the commit with a toast, asks nothing and keeps the message', async () => {
  const f = fixture(); const r = await f.mount()
  f.handlers.commitPlan = async () => ({ steps: [], sensitive: [], viaAgentShell: false, refusal: 'Resolve conflicts first.' })
  f.key('g'); await r.flush()
  const input = r.renderer.root.findDescendantById('git-message') as InputRenderable
  input.submit(); await r.flush()
  expect(f.notices.at(-1)).toEqual({ message: 'Resolve conflicts first.', variant: 'warning' })
  expect(f.confirms).toHaveLength(0)
  expect(f.calls.some((c) => c.method === 'commit')).toBe(false)
  expect(input.value).toBe('feat: update app')
})

test('discarding one untracked file says it will be deleted', async () => {
  const f = fixture(); const r = await f.mount()
  for (let i = 0; i < 3; i++) f.key('down')
  await r.flush()
  f.key('d'); await r.flush()
  expect(f.confirms.at(-1).message).toBe('Delete the untracked file new.ts?')
  f.key('down'); await r.flush(); f.key('d'); await r.flush()
  expect(f.confirms.at(-1).message).toBe('Discard changes to src/app.ts?')
})

test('o in a diff shows the server refusal for a runnable file as a toast', async () => {
  const f = fixture(); f.setGit(repo([entry('setup.bat')]))
  f.handlers.open = async () => ({ refused: 'Set editorCommand to open this file type.' })
  const r = await f.mount(120, 10)
  f.key('down'); f.key('enter'); await r.flush()
  f.key('o'); await r.flush()
  expect(f.calls.at(-1)).toEqual({ method: 'open', input: { rel: 'setup.bat' } })
  expect(f.notices.at(-1)).toEqual({ message: 'Set editorCommand to open this file type.', variant: 'warning' })
})
