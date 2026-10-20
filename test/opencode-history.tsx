export const hash = '1'.repeat(40)
export const other = '2'.repeat(40)
export const commit = { hash, parents: [other], author: 'Ana Rivera', time: 1, refs: [{ kind: 'local', name: 'main' }], subject: 'feat: update app', agent: true }
import { afterEach } from 'bun:test'
import { RGBA } from '@opentui/core'
import { testRender } from '@opentui/solid'
import type { Plugin } from '@opencode/plugin/tui'
import { createMemo, createSignal, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { parseOptions } from '../core/options.ts'
import { paneMemory } from '../hosts/opencode/pane.tsx'
import { JeiRpc } from '../hosts/opencode/rpc.ts'
import plugin from '../tui.ts'

type Context = Plugin.Context
type Layer = ReturnType<Parameters<Context['keymap']['layer']>[0]>
type Claim = Extract<Parameters<Context['ui']['slot']>[0], { append: 'session.panel' }>
const renderers: Awaited<ReturnType<typeof testRender>>[] = []
afterEach(() => { for (const r of renderers.splice(0)) r.renderer.destroy() })
const entry = (path: string, index: string | null = null, worktree: string | null = 'modified') => ({ path, index, worktree })
export const repo = (entries = [entry('src/app.ts'), entry('staged.ts', 'added', null), entry('new.ts', null, 'untracked')]) => ({
  root: '/acme-app', status: { branch: { head: 'main', oid: 'abc1234', upstream: 'origin/main', ahead: 1, behind: 2 }, entries },
  numstat: { 'src/app.ts': { added: 12, removed: 3 } }, staged: { 'staged.ts': { added: 1, removed: 0 } }, hooks: false,
})
const diff = (path = 'src/app.ts') => ({ file: { path, binary: false, added: 2, removed: 1, hunks: [
  { header: '@@ -1,2 +1,2 @@', lines: [{ kind: 'ctx', text: 'context', oldNo: 1, newNo: 1 }, { kind: 'del', text: 'before', oldNo: 2 }, { kind: 'add', text: 'after', newNo: 2 }] },
  { header: '@@ -20,0 +20,1 @@', lines: [{ kind: 'add', text: 'later', newNo: 20 }] },
] }, truncated: false })

export function historyFixture(options: Record<string, unknown> = {}) {
  const layers: (() => Layer)[] = []
  const listeners = new Map<string, Set<(event: { data: unknown; location: { directory: string } }) => void>>()
  const memory = new Map<string, unknown>()
  const [width, setWidth] = createSignal(80)
  const calls: { method: string; input: any }[] = []
  const confirms: any[] = []; const selects: any[] = []; const prompts: any[] = []; const sent: any[] = []; const notices: any[] = []
  let claim!: Claim
  let git: unknown = repo()
  let cwd = '/acme-app'
  let confirmation: boolean | undefined = false
  let selection: unknown = undefined
  let edited: string | undefined = undefined
  const handlers: Record<string, (input: any) => Promise<unknown>> = {
    state: async () => ({ cwd, options: parseOptions({ ...options, defaultTab: 'git' }), git, activity: {} }),
    generate: async () => ({ message: 'feat: update app' }), commitPlan: async () => ({ steps: [], sensitive: [], viaAgentShell: false }),
    diff: async (input) => diff(input.path), sync: async () => ({ ok: true }),
    graph: async () => ({ commits: [commit], more: false }), commitFiles: async () => ({ files: [{ path: 'a.ts', status: 'M', added: 2, removed: 1 }, { path: 'b.ts', status: 'A', added: 1, removed: 0 }] }), webUrl: async () => ({ url: 'https://github.com/acme/acme-app/commit/' + hash }),
    branches: async () => ({ branches: [{ name: 'main', remote: false, current: true, upstream: null, gone: false, ahead: 0, behind: 0, hash }, { name: 'feature', remote: false, current: false, upstream: null, gone: false, ahead: 1, behind: 0, hash: other }, { name: 'origin/feature', remote: true, current: false, upstream: null, gone: true, ahead: 0, behind: 0, hash: other }], base: 'refs/heads/main' }),
    compare: async () => ({ files: [{ path: 'a.ts', status: 'M', added: 2, removed: 1 }, { path: 'b.ts', status: 'A', added: 1, removed: 0 }], source: { kind: 'compare', base: hash, head: other } }),
    switchBranch: async () => ({ ok: true }), createBranch: async () => ({ ok: true }), checkout: async (i) => i.confirmed ? { ok: true } : { ok: false, confirm: 'Check out 1111111 (detached HEAD)?' }, revert: async (i) => i.confirmed ? { ok: true } : { ok: false, confirm: 'Revert 1111111?' },
  }
  const api = Object.fromEntries(Object.keys(JeiRpc.methods).map((method) => [method, async (input: any) => { calls.push({ method, input }); return handlers[method]?.(input) ?? {} }]))
  api.events = { on(name: string, fn: (event: { data: unknown; location: { directory: string } }) => void) { const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(fn); return () => set.delete(fn) } } as any
  const copied: string[] = []; let copyResult = true
  const ctx = { renderer: { copyToClipboardOSC52(text: string) { copied.push(text); return copyResult } },
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
  return { ctx, mount, copied, copy(value: boolean) { copyResult = value }, key, calls, confirms, selects, prompts, sent, notices, handlers, setWidth, layers,
    setGit(value: unknown) { git = value }, setCwd(value: string) { cwd = value }, confirm(value: boolean | undefined) { confirmation = value }, choose(value: unknown) { selection = value }, edit(value: string | undefined) { edited = value },
    emit(name: string, data: unknown, directory = cwd) { for (const fn of listeners.get(name) ?? []) fn({ data, location: { directory } }) },
    changed() { for (const fn of listeners.get('changed') ?? []) fn({ data: {}, location: { directory: cwd } }) },
  }
}
