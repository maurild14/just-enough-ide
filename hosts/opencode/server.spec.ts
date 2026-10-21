import { afterEach, beforeEach, expect, jest, spyOn, test } from 'bun:test'
import type { Plugin, Rpc } from '@opencode/plugin'
import type { ActivityLog } from '../../core/activity/log.ts'
import type { Options } from '../../core/options.ts'
import type { ReplaceFile, Skipped } from '../../core/search/replace.ts'
import { join } from 'node:path'
import { chmodSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { toPosix } from '../../core/shared/paths.ts'
import { cleanup, makeRepo, makeTemp, writeFiles } from '../../test/fake-host.ts'
import entry from '../../index.ts'
import { JeiRpc, type WireGitSnapshot } from './rpc.ts'
import * as hostModule from './host.ts'

type Handlers = { [K in keyof typeof JeiRpc.methods]: (
  input: unknown, context: { signal: AbortSignal; error: Rpc.ErrorFactory<(typeof JeiRpc.methods)[K]> },
) => Promise<unknown> }
type State = { cwd: string; options: Options; git: WireGitSnapshot; activity: ReturnType<ActivityLog['toJSON']> }
type ToolEvent = { sessionID?: string; id?: string; tool: string; input: unknown; status: 'completed' | 'error' }
const disposers: Plugin.Cleanup[] = []
const query = { text: 'load', caseSensitive: false, regex: false, wholeWord: false, include: [], exclude: [] }
let gitEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase().startsWith('GIT_')))
  for (const key of Object.keys(gitEnv)) delete process.env[key]
  const config = makeTemp('config')
  writeFiles(config, { gitconfig: '' })
  process.env.GIT_CONFIG_GLOBAL = join(config, 'gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})

afterEach(async () => {
  try { for (const dispose of disposers.splice(0)) await dispose() }
  finally {
    jest.useRealTimers()
    try { cleanup() } finally {
      for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('GIT_')) delete process.env[key]
      Object.assign(process.env, gitEnv)
    }
  }
})

async function start(directory: string, options: Record<string, unknown> = {}) {
  let handlers: Handlers | undefined
  let hook: ((event: ToolEvent) => void | Promise<void>) | undefined
  let before: ((event: ToolEvent) => void | Promise<void>) | undefined
  let registered: unknown
  let rpcDisposed = false
  let hookDisposed = false
  let eventSignal: AbortSignal | undefined
  let streamClosed = false
  let wake: (() => void) | undefined
  const queue: { type: string; location?: { directory: string } }[] = []
  const emitted: { name: string; data: unknown }[] = []
  const generated: unknown[] = []
  const ctx = {
    location: { directory }, options,
    rpc: { async register(definition: unknown, implementation: Handlers) {
      registered = definition
      handlers = implementation
      return { events: { async emit(name: string, data: unknown) { emitted.push({ name, data }) } }, async dispose() { rpcDisposed = true } }
    } },
    tool: { async hook(name: string, callback: typeof hook) {
      if (name === 'execute.before') before = callback
      else { expect(name).toBe('execute.after'); hook = callback }
      return { async dispose() { hookDisposed = true } }
    } },
    generate: { async text(input: unknown) { generated.push(input); return { text: '"feat: update file"' } } },
    event: { subscribe({ signal }: { signal: AbortSignal }) {
      eventSignal = signal
      signal.addEventListener('abort', () => wake?.(), { once: true })
      return (async function* () {
        try {
          while (!signal.aborted) {
            const event = queue.shift()
            if (event) yield event
            else await new Promise<void>((resolve) => { wake = resolve })
          }
        } finally { streamClosed = true }
      })()
    } },
  }
  const dispose = await entry.setup(ctx as unknown as Plugin.Context)
  if (dispose) disposers.push(dispose)
  return {
    location: ctx.location,
    registered, emitted, generated,
    async call<K extends keyof Handlers>(name: K, input: unknown = {}, signal = new AbortController().signal) {
      if (!handlers) throw new Error('RPC handlers were not registered')
      const error = ((type: string, message: string, data: unknown) => ({ type, message, data })) as Rpc.ErrorFactory<(typeof JeiRpc.methods)[K]>
      return handlers[name](input, { signal, error })
    },
    async before(event: ToolEvent) { if (!before) throw new Error('Before hook missing'); await before(event) },
    async tool(event: ToolEvent) {
      if (!hook) throw new Error('Tool hook was not registered')
      await hook(event)
    },
    event(type: string, location?: { directory: string }) { queue.push({ type, location }); wake?.() },
    async dispose() {
      if (dispose) { disposers.splice(disposers.indexOf(dispose), 1); await dispose() }
    },
    get resources() { return { rpcDisposed, hookDisposed, aborted: eventSignal?.aborted, streamClosed } },
  }
}

test('Files prepare/apply performs literal disposable mutations and confirmed recursive delete only', async () => {
  const root = makeTemp('acme-app'), server = await start(root)
  expect(Object.hasOwn((server.registered as typeof JeiRpc).methods, 'fsPrepare')).toBe(true)
  const call = (method: string, input: unknown) => server.call(method as keyof Handlers, input) as Promise<any>
  const prepare = (kind: string, source = '') => call('fsPrepare', { sessionID: 'a', kind, source })
  const apply = async (plan: any, value?: string, confirmed = false) => call('fsApply', { sessionID: 'a', planId: plan.planId, confirmed, ...(value === undefined ? {} : { value }) })
  const created = await prepare('new')
  expect(await apply(created, " spaced [x] ' $;é.txt")).toMatchObject({ ok: true, attempted: true })
  expect(readFileSync(join(root, " spaced [x] ' $;é.txt"), 'utf8')).toBe('')
  await apply(await prepare('new'), 'folder/')
  await apply(await prepare('new', 'folder'), 'child.txt')
  await apply(await prepare('rename', 'folder/child.txt'), 'renamed.txt')
  await apply(await prepare('move', 'folder/renamed.txt'), 'moved.txt')
  expect(existsSync(join(root, 'moved.txt'))).toBe(true)
  const deletion = await prepare('delete', 'folder')
  await expect(apply(deletion)).rejects.toThrow()
  expect(existsSync(join(root, 'folder'))).toBe(true)
  expect(await apply(deletion, undefined, true)).toMatchObject({ ok: true })
  await apply(await prepare('delete', 'moved.txt'), undefined, true)
  expect(existsSync(join(root, 'moved.txt'))).toBe(false)
  expect(server.emitted.some(e => e.name === 'changed')).toBe(true)
})

test('Files refuses malformed/extra input, existing entries, stale/replayed/session/root/cancelled evidence without writes', async () => {
  const root = makeTemp('acme-app'), server = await start(root)
  writeFiles(root, { 'source.txt': 'keep source', 'taken.txt': 'keep target', 'folder/child': 'keep child' })
  expect(Object.hasOwn((server.registered as typeof JeiRpc).methods, 'fsPrepare')).toBe(true)
  const call = (method: string, input: unknown, signal?: AbortSignal) => server.call(method as keyof Handlers, input, signal) as Promise<any>
  const input = { sessionID: 'a', kind: 'move', source: 'source.txt' }
  for (const invalid of [{ ...input, extra: true }, { ...input, kind: 'other' }, { ...input, source: 1 }, { kind: 'new', source: '' }]) await expect(call('fsPrepare', invalid)).rejects.toThrow()
  const prepared = await call('fsPrepare', input)
  const apply = { sessionID: 'a', planId: prepared.planId, value: 'taken.txt', confirmed: false }
  for (const invalid of [{ ...apply, extra: true }, { ...apply, value: 1 }, { ...apply, sessionID: 'b' }]) await expect(call('fsApply', invalid)).rejects.toThrow()
  await expect(call('fsApply', apply)).rejects.toThrow()
  const directory = await call('fsPrepare', input)
  await expect(call('fsApply', { ...apply, planId: directory.planId, value: 'folder' })).rejects.toThrow()
  const stale = await call('fsPrepare', input)
  await call('fsPrepare', input)
  await expect(call('fsApply', { ...apply, planId: stale.planId, value: 'new.txt' })).rejects.toThrow()
  const canceled = await call('fsPrepare', input), controller = new AbortController(); controller.abort()
  await expect(call('fsApply', { ...apply, planId: canceled.planId, value: 'new.txt' }, controller.signal)).rejects.toThrow()
  const oldRoot = await call('fsPrepare', input); server.location.directory = makeTemp('other')
  await expect(call('fsApply', { ...apply, planId: oldRoot.planId, value: 'new.txt' })).rejects.toThrow()
  expect(readFileSync(join(root, 'source.txt'), 'utf8')).toBe('keep source')
  expect(readFileSync(join(root, 'taken.txt'), 'utf8')).toBe('keep target')
  expect(existsSync(join(root, 'new.txt'))).toBe(false)
})

test('Files refuses direct/outside/dangling junctions and preserves an outside child during recursive removal', async () => {
  const root = makeTemp('acme-app'), outside = makeTemp('outside'), server = await start(root)
  writeFiles(root, { 'tree/child': 'inside' }); writeFiles(outside, { 'keep.txt': 'outside' })
  expect(Object.hasOwn((server.registered as typeof JeiRpc).methods, 'fsPrepare')).toBe(true)
  symlinkSync(outside, join(root, 'link'), 'junction')
  symlinkSync(join(outside, 'missing'), join(root, 'dangling'), 'junction')
  symlinkSync(outside, join(root, 'tree/link'), 'junction')
  const call = (method: string, input: unknown) => server.call(method as keyof Handlers, input) as Promise<any>
  for (const source of ['link', 'link/keep.txt']) await expect(call('fsPrepare', { sessionID: 'a', kind: 'delete', source })).rejects.toThrow()
  const creation = await call('fsPrepare', { sessionID: 'a', kind: 'new', source: '' })
  await expect(call('fsApply', { sessionID: 'a', planId: creation.planId, value: 'dangling', confirmed: false })).rejects.toThrow()
  const prepared = await call('fsPrepare', { sessionID: 'a', kind: 'delete', source: 'tree' })
  expect(await call('fsApply', { sessionID: 'a', planId: prepared.planId, confirmed: true })).toMatchObject({ ok: true })
  expect(existsSync(join(root, 'tree'))).toBe(false)
  expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('outside')
})

test('Files mutations through a linked opened root remain inside its canonical project', async () => {
  const real = makeTemp('acme-app'), parent = makeTemp('linked-root'), root = join(parent, 'project')
  symlinkSync(real, root, 'junction')
  const server = await start(root), call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
  const plan = await call('fsPrepare', { sessionID: 'a', kind: 'new', source: '' })
  expect(await call('fsApply', { sessionID: 'a', planId: plan.planId, value: 'new.txt', confirmed: false })).toMatchObject({ ok: true })
  expect(readFileSync(join(real, 'new.txt'), 'utf8')).toBe('')
})

test('Files delete revalidates changed source and parent evidence after confirmation', async () => {
  const root = makeTemp('acme-app'), server = await start(root)
  writeFiles(root, { 'src/file': 'before' })
  expect(Object.hasOwn((server.registered as typeof JeiRpc).methods, 'fsPrepare')).toBe(true)
  const call = (method: string, input: unknown) => server.call(method as keyof Handlers, input) as Promise<any>
  const prepared = await call('fsPrepare', { sessionID: 'a', kind: 'delete', source: 'src/file' })
  writeFiles(root, { 'src/file': 'changed and longer' })
  await expect(call('fsApply', { sessionID: 'a', planId: prepared.planId, confirmed: true })).rejects.toThrow()
  expect(readFileSync(join(root, 'src/file'), 'utf8')).toBe('changed and longer')
})

test('Files attempted postcheck failure refreshes, consumes the token and serializes through state refresh', async () => {
  const root = makeTemp('acme-app'), nodeHost = hostModule.nodeHost
  writeFiles(root, { 'source.txt': 'keep' })
  let refreshing = false, release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const mock = spyOn(hostModule, 'nodeHost').mockImplementation(generate => {
    const host = nodeHost(generate)
    return { ...host,
      async stat(path) { if (existsSync(join(root, 'moved.txt')) && toPosix(path) === toPosix(root)) return null; return host.stat(path) },
      async run(argv, options) { if (existsSync(join(root, 'moved.txt')) && argv.includes('--show-toplevel')) { refreshing = true; await wait }; return host.run(argv, options) },
    }
  })
  try {
    const server = await start(root), call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
    const plan = await call('fsPrepare', { sessionID: 'a', kind: 'move', source: 'source.txt' })
    const input = { sessionID: 'a', planId: plan.planId, value: 'moved.txt', confirmed: false }
    const pending = call('fsApply', input)
    for (let i = 0; i < 500 && !refreshing; i++) await Bun.sleep(2)
    expect(refreshing).toBe(true)
    await expect(call('fsPrepare', { sessionID: 'b', kind: 'new', source: '' })).rejects.toThrow('already running')
    release()
    expect(await pending).toMatchObject({ attempted: true, ok: false, error: 'Cannot verify filesystem metadata.' })
    expect(readFileSync(join(root, 'moved.txt'), 'utf8')).toBe('keep')
    expect(server.emitted.some(event => event.name === 'changed')).toBe(true)
    await expect(call('fsApply', input)).rejects.toThrow('expired')
  } finally { release(); mock.mockRestore() }
})

test.skipIf(process.platform !== 'win32')('Windows Files results use real entry casing for aliases including .git', async () => {
  const root = makeTemp('acme-app'); writeFiles(root, { 'src/source.txt': 'keep', '.git/keep': 'keep' })
  const server = await start(root)
  const call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
  const move = async (source: string, value: string) => {
    const plan = await call('fsPrepare', { sessionID: 'a', kind: 'move', source })
    return call('fsApply', { sessionID: 'a', planId: plan.planId, value, confirmed: false })
  }
  expect(await move('SRC/SOURCE.txt', 'SRC/renamed.txt')).toMatchObject({ ok: true, rel: 'src/renamed.txt' })
  expect(await move('src/renamed.txt', '.GIT/after.txt')).toMatchObject({ ok: true, rel: '.git/after.txt' })
  const deletion = await call('fsPrepare', { sessionID: 'a', kind: 'delete', source: '.GIT/after.txt' })
  expect(await call('fsApply', { sessionID: 'a', planId: deletion.planId, confirmed: true })).toMatchObject({ ok: true, rel: '.git' })
  expect(readFileSync(join(root, '.git/keep'), 'utf8')).toBe('keep')
})

test.skipIf(process.platform !== 'win32')('Windows canonical Unicode sibling junction cannot escape Files or preview RPC', async () => {
  const base = makeTemp('acme-app'), root = join(base, 'k'), outside = join(base, 'K')
  writeFiles(root, { 'own.txt': 'inside' }); writeFiles(outside, { 'keep.txt': 'outside sentinel' })
  symlinkSync(outside, join(root, 'link'), 'junction')
  const server = await start(root), call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
  await expect(call('fsPrepare', { sessionID: 'a', kind: 'delete', source: 'link/keep.txt' })).rejects.toThrow()
  expect(await call('preview', { rel: 'link/keep.txt' })).toMatchObject({ kind: 'empty' })
  const plan = await call('fsPrepare', { sessionID: 'a', kind: 'move', source: 'own.txt' })
  await expect(call('fsApply', { sessionID: 'a', planId: plan.planId, value: 'link/new.txt', confirmed: false })).rejects.toThrow()
  expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('outside sentinel'); expect(readFileSync(join(root, 'own.txt'), 'utf8')).toBe('inside')
})

test('Files tokens from an old server instance cannot authorize a different restarted plan', async () => {
  const root = makeTemp('acme-app'), oldServer = await start(root)
  const call = (server: Awaited<ReturnType<typeof start>>, name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
  const old = await call(oldServer, 'fsPrepare', { sessionID: 'a', kind: 'new', source: '' })
  await oldServer.dispose()
  const restarted = await start(root)
  await call(restarted, 'fsPrepare', { sessionID: 'a', kind: 'new', source: '' })
  await expect(call(restarted, 'fsApply', { sessionID: 'a', planId: old.planId, value: 'wrong.txt', confirmed: false })).rejects.toThrow()
  expect(existsSync(join(root, 'wrong.txt'))).toBe(false)
})

test('exact replacement RPC retains eligible mixed files for sequential selected/all applications', async () => {
  const repo = await makeRepo({ 'a.ts': 'user User USER\n', 'b.ts': 'User\nuser\n', 'omitted.ts': 'USER\n' })
  const server = await start(repo.dir)
  const plan = await server.call('replacePlan', { sessionID: 'a', query: { ...query, text: 'user' }, replacement: 'account' }) as { planId: string; files: ReplaceFile[]; skipped: Skipped[] }
  expect(plan.files.sort((a, b) => a.rel.localeCompare(b.rel)).map(f => [f.rel, f.count])).toEqual([['a.ts', 1], ['b.ts', 1]])
  expect(plan.skipped.sort((a, b) => a.rel.localeCompare(b.rel))).toEqual(['a.ts', 'b.ts', 'omitted.ts'].map(rel => ({ rel, reason: 'case-differs' })))
  expect(await server.call('replaceApply', { sessionID: 'a', planId: plan.planId, rels: ['a.ts'] })).toEqual({ written: ['a.ts'], skipped: [] })
  expect(await server.call('replaceApply', { sessionID: 'a', planId: plan.planId, rels: ['b.ts'] })).toEqual({ written: ['b.ts'], skipped: [] })
  expect(readFileSync(join(repo.dir, 'a.ts'), 'utf8')).toBe('account User USER\n')
  expect(readFileSync(join(repo.dir, 'b.ts'), 'utf8')).toBe('User\naccount\n')
  expect(readFileSync(join(repo.dir, 'omitted.ts'), 'utf8')).toBe('USER\n')
})

test('public Search and replacement RPC normalize removed flags while validating their types', async () => {
  const repo = await makeRepo({ 'a.ts': 'user.name USER.NAME userXname superuser.name\n' }), server = await start(repo.dir)
  const request = { ...query, text: 'user.name', caseSensitive: true, regex: true, wholeWord: true }
  await server.call('searchStart', { sessionID: 'a', id: 'fixed', query: request })
  const deadline = Date.now() + 5000
  while (!server.emitted.some(e => e.name === 'searchDone') && Date.now() < deadline) await Bun.sleep(10)
  expect(server.emitted.some(e => e.name === 'searchDone')).toBe(true)
  const batches = server.emitted.filter(e => e.name === 'searchMatches').flatMap(e => (e.data as { matches: { ranges: number[][] }[] }).matches)
  expect(batches.flatMap(m => m.ranges)).toEqual([[0, 9], [10, 19], [35, 44]])
  expect(await server.call('replacePlan', { sessionID: 'a', query: request, replacement: 'account' })).toMatchObject({
    files: [{ rel: 'a.ts', after: 'account USER.NAME userXname superaccount\n', count: 2 }],
    skipped: [{ rel: 'a.ts', reason: 'case-differs' }],
  })
  for (const name of ['caseSensitive', 'regex', 'wholeWord']) {
    await expect(server.call('replacePlan', { sessionID: 'a', query: { ...request, [name]: 'yes' }, replacement: 'account' })).rejects.toThrow('Invalid RPC input')
  }
})

test('replacement ownership and the complete subset are checked before writing; changed files are skipped', async () => {
  const repo = await makeRepo({ 'a.ts': 'export const load = 1\n', 'b.ts': 'load()\n' })
  const server = await start(repo.dir)
  const call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
  const plan = await call('replacePlan', { sessionID: 'session-a', query, replacement: 'save' })
  expect(plan.files.map((f: any) => f.rel).sort()).toEqual(['a.ts', 'b.ts'])
  await expect(call('replaceApply', { sessionID: 'session-a', planId: plan.planId, rels: ['a.ts', 'other.ts'] })).rejects.toThrow()
  await expect(call('replaceApply', { sessionID: 'session-b', planId: plan.planId, rels: ['a.ts'] })).rejects.toThrow()
  expect(readFileSync(join(repo.dir, 'a.ts'), 'utf8')).toContain('load')
  repo.write('b.ts', 'changed\n')
  expect(await call('replaceApply', { sessionID: 'session-a', planId: plan.planId, rels: ['a.ts', 'b.ts'] })).toEqual({ written: ['a.ts'], skipped: [{ rel: 'b.ts', reason: 'changed' }] })
  expect(readFileSync(join(repo.dir, 'a.ts'), 'utf8')).toContain('save')
  expect(readFileSync(join(repo.dir, 'b.ts'), 'utf8')).toBe('changed\n')
})

test('Search RPC rejects extra nested fields', async () => {
  const repo = await makeRepo({ 'a.ts': 'export function load() {}\n' }); const server = await start(repo.dir)
  const call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
  await expect(call('searchStart', { sessionID: 'a', id: '1', query: { ...query, surprise: true } })).rejects.toThrow('Invalid RPC input')

})

test('search batches stream before completion, cancel per session and stop on cleanup', async () => {
  const repo = await makeRepo({ 'a.ts': 'load\n' })
  const sources: { push(line: string): void; end(): void; canceled: boolean }[] = []
  const nodeHost = hostModule.nodeHost
  const mock = spyOn(hostModule, 'nodeHost').mockImplementation(generate => ({ ...nodeHost(generate), stream() {
    const queue: string[] = []; let ended = false, wake: (() => void) | undefined, finish!: (v: { exitCode: number; stderr: string }) => void
    const done = new Promise<{ exitCode: number; stderr: string }>(resolve => { finish = resolve })
    const source = { canceled: false, push(line: string) { queue.push(line); wake?.() }, end() { ended = true; wake?.(); finish({ exitCode: 0, stderr: '' }) } }; sources.push(source)
    return { done, cancel() { source.canceled = true; source.end() }, lines: (async function* () { while (!ended || queue.length) { const line = queue.shift(); if (line !== undefined) yield line; else await new Promise<void>(resolve => { wake = resolve }) } })() }
  } }))
  const wait = async (predicate: () => boolean) => { for (let i = 0; i < 400 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)); expect(predicate()).toBe(true) }
  const row = (line: number) => JSON.stringify({ type: 'match', data: { path: { text: 'a.ts' }, lines: { text: 'load\n' }, line_number: line, submatches: [{ start: 0, end: 4, match: { text: 'load' } }] } })
  try {
    const server = await start(repo.dir), call = (name: string, input: unknown) => server.call(name as keyof Handlers, input)
    await call('searchStart', { sessionID: 'a', id: 'first', query }); await wait(() => sources.length === 1)
    for (let i = 1; i <= 201; i++) sources[0]!.push(row(i))
    await wait(() => server.emitted.filter(e => e.name === 'searchMatches').length === 2)
    expect(server.emitted.filter(e => e.name === 'searchMatches').map(e => (e.data as any).matches.length)).toEqual([200, 1])
    expect(server.emitted.some(e => e.name === 'searchDone')).toBe(false)
    await call('searchStart', { sessionID: 'b', id: 'other', query }); await wait(() => sources.length === 2)
    await call('searchStart', { sessionID: 'a', id: 'second', query }); await wait(() => sources.length === 3)
    expect(sources[0]!.canceled).toBe(true); expect(sources[1]!.canceled).toBe(false)
    await call('searchCancel', { sessionID: 'a', id: 'first' }); expect(sources[2]!.canceled).toBe(false)
    await call('searchCancel', { sessionID: 'a', id: 'second' }); sources[2]!.push(row(1)); sources[2]!.end()
    sources[1]!.push(row(1)); sources[1]!.end()
    await wait(() => server.emitted.some(e => e.name === 'searchDone' && (e.data as any).sessionID === 'b'))
    expect(server.emitted.filter(e => (e.data as any).id === 'second')).toEqual([])
    await call('searchStart', { sessionID: 'a', id: 'cleanup', query }); await wait(() => sources.length === 4)
    await server.dispose(); expect(sources[3]!.canceled).toBe(true)
  } finally { mock.mockRestore() }
})

test('later write errors return known partial results, retain remaining plans and refresh', async () => {
  const repo = await makeRepo({ 'a.ts': 'load\n', 'b.ts': 'load\n' }), nodeHost = hostModule.nodeHost
  const mock = spyOn(hostModule, 'nodeHost').mockImplementation(generate => {
    const host = nodeHost(generate)
    return { ...host, async writeText(path, text) { if (path.endsWith('/b.ts')) { await host.writeText(path, 'partial'); throw new Error('Disk write failed.\nDetails') }; await host.writeText(path, text) } }
  })
  try {
    const server = await start(repo.dir), call = (name: string, input: unknown) => server.call(name as keyof Handlers, input) as Promise<any>
    const plan = await call('replacePlan', { sessionID: 'a', query, replacement: 'save' })
    expect(await call('replaceApply', { sessionID: 'a', planId: plan.planId, rels: ['a.ts', 'b.ts'] })).toEqual({ written: ['a.ts'], skipped: [], error: 'Disk write failed.' })
    expect(readFileSync(join(repo.dir, 'b.ts'), 'utf8')).toBe('partial')
    expect(server.emitted.some(e => e.name === 'changed')).toBe(true)
    expect(await call('replaceApply', { sessionID: 'a', planId: plan.planId, rels: ['b.ts'] })).toEqual({ written: [], skipped: [{ rel: 'b.ts', reason: 'changed' }] })
  } finally { mock.mockRestore() }
})

test('reused preview/open boundaries preserve native colon names and reject unsupported aliases', async () => {
  const nodeHost = hostModule.nodeHost, opened: readonly string[][] = []; let reads = 0
  const mock = spyOn(hostModule, 'nodeHost').mockImplementation(generate => ({ ...nodeHost(generate), platform: 'linux', async stat(path) { return path === '/acme-app' ? { kind: 'dir', size: 0, realPath: path } : path === '/acme-app/a:b.ts' ? { kind: 'file', size: 5, realPath: path } : null }, async readHead() { reads++; return new TextEncoder().encode('load\n') }, async run(argv) { (opened as string[][]).push([...argv]); return { exitCode: 0, stdout: '', stderr: '' } } }))
  try {
    const server = await start('/acme-app', { editorCommand: 'fixture-editor {path}:{line}' })
    expect(await server.call('preview', { rel: 'a:b.ts' })).toMatchObject({ kind: 'code', text: 'load\n' })
    expect(await server.call('open', { rel: 'a:b.ts', line: 2 })).toEqual({})
    expect(opened.at(-1)).toEqual(['fixture-editor', '/acme-app/a:b.ts:2'])
    expect(await server.call('preview', { rel: 'a\\b.ts' })).toMatchObject({ type: 'outside_root' })
    expect(await server.call('open', { rel: '../outside.ts' })).toMatchObject({ type: 'outside_root' })
    expect(reads).toBe(1); expect(opened).toHaveLength(1)
  } finally { mock.mockRestore() }
})

test('web opener ignores returned nonzero exits and surfaces spawn errors without opening a browser', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  await repo.git('remote', 'add', 'origin', 'https://github.com/acme/acme-app.git')
  const hash = await repo.git('rev-parse', 'HEAD')
  const nodeHost = hostModule.nodeHost; const opened: string[][] = []; let fail = false
  const mock = spyOn(hostModule, 'nodeHost').mockImplementation(generate => {
    const host = nodeHost(generate)
    return { ...host, async run(argv, options) {
      if (argv[0] === 'git') return host.run(argv, options)
      opened.push([...argv])
      if (fail) throw new Error('Opener unavailable.')
      return { exitCode: 1, stdout: '', stderr: '' }
    } }
  })
  try {
    const server = await start(repo.dir)
    expect(await server.call('openWeb', { hash })).toEqual({})
    expect(opened).toHaveLength(1)
    expect(opened[0]!.at(-1)).toBe(`https://github.com/acme/acme-app/commit/${hash}`)
    fail = true
    await expect(server.call('openWeb', { hash })).rejects.toThrow('Opener unavailable.')
  } finally { mock.mockRestore() }
})

test('the package entry registers the contract and stages a file visible in a fresh state', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  repo.write('a.txt', 'after\n')
  const server = await start(repo.dir, { startOpen: 'off' })
  expect(server.registered).toBe(JeiRpc)
  const before = await server.call('state') as State
  expect(before.options.startOpen).toBe(false)
  expect(toPosix(before.git.root!)).toBe(toPosix(repo.dir))
  expect(await server.call('stage', { paths: ['a.txt'] })).toEqual({})
  const after = await server.call('state') as State
  expect(after.git.root !== null && after.git.status.entries).toEqual([{ path: 'a.txt', index: 'modified', worktree: null }])
  expect(after.git.root !== null && after.git.staged).toEqual({ 'a.txt': { added: 1, removed: 1 } })
})

test('file RPCs return their contract envelopes and open an argv-only editor with a native path', async () => {
  const repo = await makeRepo({ 'src/a.ts': 'export const a = 1\n' })
  const editor = makeTemp('editor')
  const output = join(editor, 'args.json')
  writeFiles(editor, { 'open.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))" })
  const server = await start(repo.dir, { editorCommand: `"${process.execPath}" "${join(editor, 'open.mjs')}" "${output}" {path} {line}` })
  expect(await server.call('listDir', { rel: 'src' })).toEqual({ entries: [{ name: 'a.ts', kind: 'file', size: 19 }], ignored: [] })
  expect(await server.call('preview', { rel: join(repo.dir, 'src/a.ts') })).toEqual({ kind: 'code', text: 'export const a = 1\n', language: 'typescript' })
  expect(await server.call('allFiles')).toEqual({ files: ['src/a.ts'] })
  expect(await server.call('open', { rel: 'src/a.ts', line: 3 })).toEqual({})
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([join(repo.dir, 'src', 'a.ts'), '3'])
  expect(await server.call('open', { rel: 'src/a.ts' })).toEqual({})
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([join(repo.dir, 'src', 'a.ts')])
})

test('every path RPC rejects escapes before touching any member of a batch', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  repo.write('a.txt', 'after\n')
  const server = await start(repo.dir)
  for (const path of ['../x', '..\\x', join(makeTemp('outside'), 'x'), 'C:/outside/x', '//outside/share/x']) {
    for (const name of ['listDir', 'preview', 'open'] as const) {
      expect(await server.call(name, { rel: path })).toMatchObject({ type: 'outside_root', data: {} })
    }
    expect(await server.call('diff', { path, source: { kind: 'working', staged: false, untracked: false } })).toMatchObject({ type: 'outside_root' })
    for (const name of ['stage', 'unstage', 'discard'] as const) {
      expect(await server.call(name, { paths: ['a.txt', path] })).toMatchObject({ type: 'outside_root' })
    }
  }
  const state = await server.call('state') as State
  expect(state.git.root !== null && state.git.status.entries).toEqual([{ path: 'a.txt', index: null, worktree: 'modified' }])
  for (const [name, input] of [
    ['stage', { paths: ['a.txt', 3] }], ['preview', { rel: null }],
    ['diff', { path: 'a.txt', source: { kind: 'working', staged: 'false', untracked: false } }], ['open', { rel: 'a.txt', line: 0 }],
    ['commit', { message: 'feat: change', mode: 'commit', approvedSensitive: 'false' }],
    ['commit', { message: 'feat: change', mode: 'commit', approvedSensitive: ['.env', 3] }],
    ['commitPlan', { message: 'feat: change', mode: 'other' }], ['sync', { choice: 'other' }],
  ] as const) await expect(server.call(name, input)).rejects.toThrow('Invalid RPC input')
})

test('literal leading-space paths survive preview and activity classification', async () => {
  const repo = await makeRepo({ ' leading.ts': 'spaced\n', 'leading.ts': 'plain\n' })
  const server = await start(repo.dir)
  expect(await server.call('preview', { rel: ' leading.ts' })).toMatchObject({ text: 'spaced\n' })
  await server.tool({ tool: 'read', input: { filePath: ' leading.ts' }, status: 'completed' })
  expect(server.emitted).toContainEqual({ name: 'activity', data: { rel: ' leading.ts', kind: 'read' } })
})

test('preview preserves the real-path guard for a symlink outside the project', async () => {
  const root = makeTemp()
  const outside = makeTemp('outside')
  writeFiles(outside, { 'a.txt': 'outside\n' })
  symlinkSync(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  const server = await start(root)
  expect(await server.call('preview', { rel: 'link/a.txt' })).toEqual({ kind: 'empty' })
})

test('git RPCs keep literal paths, fresh discard entries and working/staged diffs', async () => {
  const repo = await makeRepo({ '[a].txt': 'before\n', 'a.txt': 'untouched\n' })
  const server = await start(repo.dir)
  await server.call('state')
  repo.write('[a].txt', 'after\n')
  repo.write('new.txt', 'new\n')
  const diff = await server.call('diff', { path: '[a].txt', source: { kind: 'working', staged: false, untracked: false } })
  expect(diff).toMatchObject({ file: { path: '[a].txt', added: 1, removed: 1 }, truncated: false })
  expect(await server.call('stage', { paths: [join(repo.dir, '[a].txt')] })).toEqual({})
  expect(await server.call('diff', { path: '[a].txt', source: { kind: 'working', staged: true, untracked: false } })).toMatchObject({ file: { added: 1, removed: 1 } })
  expect(await server.call('unstage', { paths: ['[a].txt'] })).toEqual({})
  expect(await server.call('diff', { path: 'new.txt', source: { kind: 'working', staged: false, untracked: true } })).toMatchObject({ file: { path: 'new.txt', added: 1 } })
  expect(await server.call('discard', { paths: ['./[a].txt', 'new.txt', 'missing.txt'] })).toEqual({})
  expect(existsSync(join(repo.dir, 'new.txt'))).toBe(false)
  expect(await server.call('preview', { rel: '[a].txt' })).toMatchObject({ text: 'before\n' })
  expect((await server.call('state') as State).git).toMatchObject({ status: { entries: [] } })
})

test('commit replans from fresh state and requires explicit approval for sensitive paths', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  repo.write('a.txt', 'after\n')
  const server = await start(repo.dir)
  expect(await server.call('commitPlan', { message: 'feat: update', mode: 'commit' })).toEqual({
    steps: [['add', '-A'], ['commit', '-m', 'feat: update']], sensitive: [], viaAgentShell: false,
  })
  repo.write('.env', 'sample fixture\n')
  await expect(server.call('commit', { message: 'feat: update', mode: 'commit', approvedSensitive: [] })).rejects.toThrow('Sensitive files require confirmation')
  expect(await repo.git('log', '-1', '--format=%s')).toBe('chore: initial commit')
  expect((await server.call('state') as State).git).toMatchObject({ staged: {} })
  expect(await server.call('commit', { message: 'feat: update', mode: 'commit', approvedSensitive: ['.env'] })).toEqual({})
  expect(await repo.git('log', '-1', '--format=%s')).toBe('feat: update')
  expect((await server.call('state') as State).git).toMatchObject({ status: { entries: [] } })
})

test('a fresh server commit plan rejects a sensitive path missing from the exact approved list before staging', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  const server = await start(repo.dir)
  repo.write('.env', 'fictional environment fixture\n')
  const initial = await server.call('commitPlan', { message: 'feat: add fixtures', mode: 'commit' }) as { sensitive: string[] }
  expect(initial.sensitive).toEqual(['.env'])
  repo.write('id_rsa', 'fictional key fixture\n')
  const before = await repo.git('rev-parse', 'HEAD')
  await expect(server.call('commit', { message: 'feat: add fixtures', mode: 'commit', approvedSensitive: initial.sensitive })).rejects.toThrow('Sensitive files require confirmation')
  for (const approvedSensitive of [[' .env', 'id_rsa'], ['.ENV', 'id_rsa']]) {
    await expect(server.call('commit', { message: 'feat: add fixtures', mode: 'commit', approvedSensitive })).rejects.toThrow('Sensitive files require confirmation')
  }
  expect(await repo.git('rev-parse', 'HEAD')).toBe(before)
  expect((await server.call('state') as State).git).toMatchObject({ staged: {} })
  const current = await server.call('commitPlan', { message: 'feat: add fixtures', mode: 'commit' }) as { sensitive: string[] }
  expect(current.sensitive).toEqual(['.env', 'id_rsa'])
  expect(await server.call('commit', { message: 'feat: add fixtures', mode: 'commit', approvedSensitive: current.sensitive })).toEqual({})
  expect(await repo.git('log', '-1', '--format=%s')).toBe('feat: add fixtures')
  expect((await server.call('state') as State).git).toMatchObject({ status: { entries: [] } })
})

test('generate uses a flat prompt and a parsed provider/model or the host default', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  repo.write('a.txt', 'after\n')
  for (const model of ['', 'acme/small/model']) {
    const server = await start(repo.dir, { commitModel: model })
    expect(await server.call('generate')).toEqual({ message: 'feat: update file' })
    expect(server.generated).toEqual([expect.objectContaining({ prompt: expect.stringContaining('-before\n+after') })])
    expect(server.generated[0]).toEqual(model ? { prompt: expect.any(String), model: { providerID: 'acme', id: 'small/model' } } : { prompt: expect.any(String) })
  }
  const invalid = await start(repo.dir, { commitModel: 'small' })
  await expect(invalid.call('generate')).rejects.toThrow('Use provider/model')
})

test('non-repository state, init and sync use core result objects', async () => {
  const root = makeTemp()
  const server = await start(root)
  expect((await server.call('state') as State).git).toEqual({ root: null })
  await expect(server.call('commitPlan', { message: 'feat: update', mode: 'commit' })).rejects.toThrow('Not a git repository')
  expect(await server.call('init')).toEqual({})
  expect(toPosix((await server.call('state') as State).git.root!)).toBe(toPosix(root))
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  await repo.git('checkout', '--detach')
  const detached = await start(repo.dir)
  expect(await detached.call('sync')).toEqual({ ok: false, error: 'Detached HEAD: check out a branch to sync.' })
})

test('completed tools emit project-relative activity and state keeps the touch', async () => {
  const root = makeTemp()
  const server = await start(root)
  await server.tool({ tool: 'edit', input: { filePath: join(root, 'src/a.ts') }, status: 'completed' })
  expect(server.emitted).toEqual([{ name: 'activity', data: { rel: 'src/a.ts', kind: 'write' } }])
  expect((await server.call('state') as State).activity).toEqual({ 'src/a.ts': { kind: 'write', at: expect.any(Number) } })
  await server.tool({ tool: 'read', input: { path: 'src/b.ts' }, status: 'completed' })
  await server.tool({ tool: 'custom', input: { filePath: 'src/c.ts' }, status: 'completed' })
  expect(server.emitted.slice(1)).toEqual([
    { name: 'activity', data: { rel: 'src/b.ts', kind: 'read' } },
    { name: 'activity', data: { rel: 'src/c.ts', kind: 'read' } },
  ])
})

test('activity options filter touches and failed or outside-root tools emit nothing', async () => {
  jest.useFakeTimers()
  for (const [setting, kinds] of [
    ['none', []], ['reads', ['read']], ['writes', ['write']], ['reads and writes', ['read', 'write']],
  ] as const) {
    const server = await start(makeTemp(), { activity: setting })
    await server.tool({ tool: 'read', input: { path: 'a.txt' }, status: 'completed' })
    await server.tool({ tool: 'edit', input: { filePath: 'b.txt' }, status: 'completed' })
    await server.tool({ tool: 'shell', input: { command: 'git checkout a.txt' }, status: 'completed' })
    expect(server.emitted.map((e) => (e.data as { kind: string }).kind)).toEqual([...kinds])
    expect(Object.values((await server.call('state') as State).activity).map((row) => row.kind)).toEqual([...kinds])
  }
  const server = await start(makeTemp())
  await server.tool({ tool: 'edit', input: { filePath: 'a.txt' }, status: 'error' })
  await server.tool({ tool: 'edit', input: { filePath: '../outside' }, status: 'completed' })
  jest.advanceTimersByTime(1000)
  expect(server.emitted).toEqual([])
  expect((await server.call('state') as State).activity).toEqual({})
})

test('tool writes and git actions debounce changed by 300 ms even with activity disabled', async () => {
  jest.useFakeTimers()
  const server = await start(makeTemp(), { activity: 'none' })
  await server.tool({ tool: 'read', input: { path: 'a.txt' }, status: 'completed' })
  jest.advanceTimersByTime(500)
  expect(server.emitted).toEqual([])
  await server.tool({ tool: 'edit', input: { path: 'a.txt' }, status: 'completed' })
  jest.advanceTimersByTime(299)
  expect(server.emitted).toEqual([])
  await server.tool({ tool: 'shell', input: { command: 'git commit -m update' }, status: 'completed' })
  jest.advanceTimersByTime(299)
  expect(server.emitted).toEqual([])
  jest.advanceTimersByTime(1)
  expect(server.emitted).toEqual([{ name: 'changed', data: {} }])
})

test('filesystem and branch events share the debounce and cleanup stops all resources', async () => {
  jest.useFakeTimers()
  const root = makeTemp()
  const server = await start(root)
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
  server.event('filesystem.changed', { directory: root })
  await flush()
  jest.advanceTimersByTime(299)
  expect(server.emitted).toEqual([])
  server.event('vcs.branch.updated', { directory: root })
  await flush()
  jest.advanceTimersByTime(299)
  expect(server.emitted).toEqual([])
  jest.advanceTimersByTime(1)
  expect(server.emitted).toEqual([{ name: 'changed', data: {} }])
  server.event('session.updated')
  server.event('filesystem.changed', { directory: makeTemp('outside') })
  await flush()
  jest.advanceTimersByTime(1000)
  expect(server.emitted).toHaveLength(1)
  server.event('filesystem.changed')
  await flush()
  await server.dispose()
  expect(server.resources).toEqual({ rpcDisposed: true, hookDisposed: true, aborted: true, streamClosed: true })
  jest.advanceTimersByTime(1000)
  await server.tool({ tool: 'edit', input: { path: 'a.txt' }, status: 'completed' })
  expect(server.emitted).toHaveLength(1)
})

test('unclassified shell writes refresh like Claude Code while root reads never create a file marker', async () => {
  jest.useFakeTimers()
  const server = await start(makeTemp())
  await server.tool({ tool: 'list', input: { path: '.' }, status: 'completed' })
  await server.tool({ tool: 'shell', input: { command: 'npm run format' }, status: 'completed' })
  jest.advanceTimersByTime(300)
  expect(server.emitted).toEqual([{ name: 'changed', data: {} }])
  expect((await server.call('state') as State).activity).toEqual({})
})

test('OpenCode commits run repository hooks directly and preserve hook failure', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  repo.write('a.txt', 'after\n')
  const hook = join(repo.dir, '.git/hooks/pre-commit')
  writeFiles(repo.dir, { '.git/hooks/pre-commit': '#!/bin/sh\necho "Fixture hook refused commit" >&2\nexit 1\n' })
  chmodSync(hook, 0o755)
  const server = await start(repo.dir)
  expect(await server.call('commitPlan', { message: 'feat: update', mode: 'commit' })).toMatchObject({ viaAgentShell: true })
  await expect(server.call('commit', { message: 'feat: update', mode: 'commit', approvedSensitive: [] })).rejects.toThrow('Fixture hook refused commit')
  expect(await repo.git('log', '-1', '--format=%s')).toBe('chore: initial commit')
})

test('setup rolls back the RPC registration when hook registration fails', async () => {
  let disposed = false
  const ctx = {
    options: {},
    rpc: { async register() { return { async dispose() { disposed = true } } } },
    tool: { async hook() { throw new Error('Hook registration failed') } },
  }
  await expect(entry.setup(ctx as unknown as Plugin.Context)).rejects.toThrow('Hook registration failed')
  expect(disposed).toBe(true)
})

test('cleanup disposes RPC even if the hook disposal fails', async () => {
  let disposed = false
  let signal: AbortSignal | undefined
  const ctx = {
    options: {},
    rpc: { async register() { return { async dispose() { disposed = true } } } },
    tool: { async hook() { return { async dispose() { throw new Error('Hook disposal failed') } } } },
    event: { subscribe(input: { signal: AbortSignal }) { signal = input.signal; return (async function* () {})() } },
  }
  const dispose = await entry.setup(ctx as unknown as Plugin.Context)
  if (!dispose) throw new Error('Missing cleanup')
  await expect(dispose()).rejects.toThrow('Hook disposal failed')
  expect(disposed).toBe(true)
  expect(signal?.aborted).toBe(true)
  await dispose()
})

test('open refuses a runnable file when no editor command is set, and runs nothing', async () => {
  const repo = await makeRepo({ 'setup.bat': 'echo fictional\n', 'run.SH': 'echo fictional\n' })
  const server = await start(repo.dir)
  for (const rel of ['setup.bat', 'run.SH']) expect(await server.call('open', { rel })).toEqual({ refused: 'Set editorCommand to open this file type.' })
})

test('commit refuses while a merge conflict is unresolved, and commits nothing', async () => {
  const repo = await makeRepo({ 'a.txt': 'base\n' })
  await repo.git('checkout', '-b', 'other')
  repo.write('a.txt', 'theirs\n')
  await repo.git('commit', '-am', 'feat: theirs')
  await repo.git('checkout', 'main')
  repo.write('a.txt', 'ours\n')
  await repo.git('commit', '-am', 'feat: ours')
  expect((await repo.host.run(['git', '-C', repo.dir, 'merge', 'other'])).exitCode).not.toBe(0)
  const server = await start(repo.dir)
  expect(await server.call('commitPlan', { message: 'm', mode: 'commit' })).toEqual({ steps: [], sensitive: [], viaAgentShell: false, refusal: 'Resolve conflicts first.' })
  await expect(server.call('commit', { message: 'm', mode: 'commit', approvedSensitive: [] })).rejects.toThrow('Resolve conflicts first.')
  expect(await repo.git('log', '-1', '--format=%s')).toBe('feat: ours')
  expect(await repo.git('diff', '--name-only', '--diff-filter=U')).toBe('a.txt')
})


test('history RPC validates exact hashes, refs, confirmations and extra properties at the server boundary', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  await repo.git('branch', 'feature')
  const server = await start(repo.dir)
  const hash = await repo.git('rev-parse', 'HEAD')
  for (const method of ['commitFiles', 'checkout', 'revert', 'webUrl', 'openWeb'] as const) {
    await expect(server.call(method, { hash: '-x', confirmed: true })).rejects.toThrow()
    const input = ['checkout', 'revert'].includes(method) ? { hash: 'g'.repeat(40), confirmed: true } : { hash: 'g'.repeat(40) }
    await expect(server.call(method, input)).rejects.toThrow('Invalid commit hash')
  }
  await expect(server.call('graph', { filter: '', count: 5, sessionID: 'session-a', extra: true })).rejects.toThrow('Invalid RPC input')
  await expect(server.call('createBranch', { name: '-x', confirmed: true })).rejects.toThrow()
  await expect(server.call('compare', { base: hash, head: hash })).rejects.toThrow('Invalid branch')
  repo.write('a.txt', 'dirty\n')
  expect(await server.call('switchBranch', { name: 'feature', remote: false, confirmed: false })).toMatchObject({ ok: false, confirm: expect.stringContaining('uncommitted') })
  expect(await repo.git('branch', '--show-current')).toBe('main')
  expect(await server.call('createBranch', { name: 'from-commit', start: hash, confirmed: false })).toMatchObject({ ok: false })
  expect(await server.call('checkout', { hash, confirmed: false })).toMatchObject({ ok: false, confirm: expect.stringContaining('detached HEAD') })
  expect(await server.call('revert', { hash, confirmed: false })).toMatchObject({ ok: false })
  expect(await server.call('switchBranch', { name: 'feature', remote: false, confirmed: true })).toEqual({ ok: true })
  expect(await repo.git('branch', '--show-current')).toBe('feature')
  expect(readFileSync(join(repo.dir, 'a.txt'), 'utf8')).toBe('dirty\n')
}, 60_000)

test('tool identity and session attribution mark agent commits and suppress overlapping JEI commits', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  const server = await start(repo.dir)
  const event = { tool: 'shell', input: { command: 'git commit' }, status: 'completed' as const, sessionID: 'session-a', id: 'call-a' }
  await server.before(event)
  repo.write('a.txt', 'agent\n'); await repo.git('commit', '-am', 'feat: agent')
  const agent = await repo.git('rev-parse', 'HEAD')
  await server.tool(event)
  const graph = (sessionID: string) => server.call('graph', { filter: '', count: 10, sessionID }) as Promise<{ commits: { hash: string; agent: boolean }[] }>
  expect((await graph('session-a')).commits.find(c => c.hash === agent)?.agent).toBe(true)
  expect((await graph('session-b')).commits.some(c => c.agent)).toBe(false)
  await server.before({ ...event, id: 'call-b' })
  repo.write('a.txt', 'jei\n')
  await server.call('commit', { message: 'feat: jei', mode: 'commit', approvedSensitive: [] })
  const jei = await repo.git('rev-parse', 'HEAD')
  await server.tool({ ...event, id: 'call-b' })
  expect((await graph('session-a')).commits.find(c => c.hash === jei)?.agent).toBe(false)
  await server.before({ ...event, id: 'call-c' }); await server.before({ ...event, id: 'call-d' })
  repo.write('a.txt', 'overlap\n'); await repo.git('commit', '-am', 'feat: overlapping')
  const overlap = await repo.git('rev-parse', 'HEAD')
  await server.tool({ ...event, id: 'call-c' }); await server.tool({ ...event, id: 'call-d' })
  expect((await graph('session-a')).commits.find(c => c.hash === overlap)?.agent).toBe(false)
}, 60_000)

test('a pending before-hook cannot attribute a JEI commit, and missing reflog evidence leaves the tool successful', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' }); const server = await start(repo.dir)
  const event = { tool: 'shell', input: { command: 'git commit' }, status: 'completed' as const, sessionID: 'session-a', id: 'pending' }
  const pending = server.before(event)
  repo.write('a.txt', 'jei\n')
  await server.call('commit', { message: 'feat: jei', mode: 'commit', approvedSensitive: [] })
  await pending; await server.tool(event)
  expect(await server.call('graph', { filter: '', count: 10, sessionID: 'session-a' })).toMatchObject({ commits: expect.arrayContaining([expect.objectContaining({ subject: 'feat: jei', agent: false })]) })
  await server.before({ ...event, id: 'missing-evidence' })
  await repo.git('reflog', 'expire', '--expire=all', '--all')
  repo.write('a.txt', 'agent\n'); await repo.git('commit', '-am', 'feat: no evidence')
  await server.tool({ ...event, id: 'missing-evidence' })
  expect(await server.call('graph', { filter: '', count: 10, sessionID: 'session-a' })).toMatchObject({ commits: expect.arrayContaining([expect.objectContaining({ subject: 'feat: no evidence', agent: false })]) })
})

test('agent windows starting during a held JEI hook stay suppressed for the whole mutation', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' }); const server = await start(repo.dir)
  repo.write('a.txt', 'jei\n')
  writeFiles(repo.dir, { '.git/hooks/pre-commit': '#!/bin/sh\ntouch .git/ready-jei\nwhile [ ! -f .git/allow-jei ]; do sleep 0.1; done\n' })
  chmodSync(join(repo.dir, '.git/hooks/pre-commit'), 0o755)
  const committing = server.call('commit', { message: 'feat: held jei', mode: 'commit', approvedSensitive: [] })
  try {
    const deadline = Date.now() + 10000
    while (!existsSync(join(repo.dir, '.git/ready-jei')) && Date.now() < deadline) await Bun.sleep(10)
    expect(existsSync(join(repo.dir, '.git/ready-jei'))).toBe(true)
    const event = { tool: 'shell', input: { command: 'git commit' }, status: 'completed' as const, sessionID: 'session-a', id: 'inside-jei' }
    await server.before(event)
    writeFiles(repo.dir, { '.git/allow-jei': '' })
    await committing; await server.tool(event)
    expect(await server.call('graph', { filter: '', count: 10, sessionID: 'session-a' })).toMatchObject({ commits: expect.arrayContaining([expect.objectContaining({ subject: 'feat: held jei', agent: false })]) })
  } finally { writeFiles(repo.dir, { '.git/allow-jei': '' }); await committing }
})

test('comparison RPC pins branch hashes before later movement and diff keeps its original source', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' }); const server = await start(repo.dir)
  await repo.git('switch', '-c', 'feature')
  repo.write('a.txt', 'feature\n'); await repo.git('commit', '-am', 'feat: feature')
  const before = await server.call('compare', { base: 'refs/heads/main', head: 'refs/heads/feature' }) as { source: { kind: string; base: string; head: string }; files: unknown[] }
  expect(before.files).toMatchObject([{ path: 'a.txt', added: 1, removed: 1 }])
  repo.write('a.txt', 'later\n'); await repo.git('commit', '-am', 'feat: later')
  expect(await server.call('diff', { path: 'a.txt', source: before.source })).toMatchObject({ file: { hunks: [{ lines: expect.arrayContaining([expect.objectContaining({ text: 'feature' })]) }] } })
  const hash = before.source.head
  expect(await server.call('diff', { path: 'a.txt', source: { kind: 'commit', hash } })).toMatchObject({ label: `${hash.slice(0, 7)} feat: feature` })
  for (const source of [{ kind: 'compare', base: 'HEAD', head: hash }, { kind: 'commit', hash, extra: true }, { kind: 'working', staged: false, untracked: false, hash }]) await expect(server.call('diff', { path: 'a.txt', source })).rejects.toThrow()
})

test('branches RPC retains full default-base provenance for custom remote targets and local fallback', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' }); const server = await start(repo.dir)
  const hash = await repo.git('rev-parse', 'HEAD')
  await repo.git('update-ref', 'refs/remotes/main', hash)
  await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/main')
  expect(await server.call('branches')).toMatchObject({ base: 'refs/remotes/main' })
  await repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
  expect(await server.call('branches')).toMatchObject({ base: 'refs/heads/main' })
})
