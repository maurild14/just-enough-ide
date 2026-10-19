import { afterEach, beforeEach, expect, jest, test } from 'bun:test'
import type { Plugin, Rpc } from '@opencode/plugin'
import type { ActivityLog } from '../../core/activity/log.ts'
import type { Options } from '../../core/options.ts'
import { join } from 'node:path'
import { chmodSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { toPosix } from '../../core/shared/paths.ts'
import { cleanup, makeRepo, makeTemp, writeFiles } from '../../test/fake-host.ts'
import entry from '../../index.ts'
import { JeiRpc, type WireGitSnapshot } from './rpc.ts'

type Handlers = { [K in keyof typeof JeiRpc.methods]: (
  input: unknown, context: { signal: AbortSignal; error: Rpc.ErrorFactory<(typeof JeiRpc.methods)[K]> },
) => Promise<unknown> }
type State = { cwd: string; options: Options; git: WireGitSnapshot; activity: ReturnType<ActivityLog['toJSON']> }
type ToolEvent = { tool: string; input: unknown; status: 'completed' | 'error' }
const disposers: Plugin.Cleanup[] = []
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
      expect(name).toBe('execute.after')
      hook = callback
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
    registered, emitted, generated,
    async call<K extends keyof Handlers>(name: K, input: unknown = {}) {
      if (!handlers) throw new Error('RPC handlers were not registered')
      const error = ((type: string, message: string, data: unknown) => ({ type, message, data })) as Rpc.ErrorFactory<(typeof JeiRpc.methods)[K]>
      return handlers[name](input, { signal: new AbortController().signal, error })
    },
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

test('file RPCs return their contract envelopes and open an argv-only editor', async () => {
  const repo = await makeRepo({ 'src/a.ts': 'export const a = 1\n' })
  const editor = makeTemp('editor')
  const output = join(editor, 'args.json')
  writeFiles(editor, { 'open.mjs': "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))" })
  const server = await start(repo.dir, { editorCommand: `"${process.execPath}" "${join(editor, 'open.mjs')}" "${output}" {path} {line}` })
  expect(await server.call('listDir', { rel: 'src' })).toEqual({ entries: [{ name: 'a.ts', kind: 'file', size: 19 }], ignored: [] })
  expect(await server.call('preview', { rel: join(repo.dir, 'src/a.ts') })).toEqual({ kind: 'code', text: 'export const a = 1\n', language: 'typescript' })
  expect(await server.call('allFiles')).toEqual({ files: ['src/a.ts'] })
  expect(await server.call('open', { rel: 'src/a.ts', line: 3 })).toEqual({})
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([toPosix(join(repo.dir, 'src/a.ts')), '3'])
  expect(await server.call('open', { rel: 'src/a.ts' })).toEqual({})
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([toPosix(join(repo.dir, 'src/a.ts'))])
})

test('every path RPC rejects escapes before touching any member of a batch', async () => {
  const repo = await makeRepo({ 'a.txt': 'before\n' })
  repo.write('a.txt', 'after\n')
  const server = await start(repo.dir)
  for (const path of ['../x', '..\\x', join(makeTemp('outside'), 'x'), 'C:/outside/x', '//outside/share/x']) {
    for (const name of ['listDir', 'preview', 'open'] as const) {
      expect(await server.call(name, { rel: path })).toMatchObject({ type: 'outside_root', data: {} })
    }
    expect(await server.call('diff', { path, staged: false, untracked: false })).toMatchObject({ type: 'outside_root' })
    for (const name of ['stage', 'unstage', 'discard'] as const) {
      expect(await server.call(name, { paths: ['a.txt', path] })).toMatchObject({ type: 'outside_root' })
    }
  }
  const state = await server.call('state') as State
  expect(state.git.root !== null && state.git.status.entries).toEqual([{ path: 'a.txt', index: null, worktree: 'modified' }])
  for (const [name, input] of [
    ['stage', { paths: ['a.txt', 3] }], ['preview', { rel: null }],
    ['diff', { path: 'a.txt', staged: 'false', untracked: false }], ['open', { rel: 'a.txt', line: 0 }],
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
  const diff = await server.call('diff', { path: '[a].txt', staged: false, untracked: false })
  expect(diff).toMatchObject({ file: { path: '[a].txt', added: 1, removed: 1 }, truncated: false })
  expect(await server.call('stage', { paths: [join(repo.dir, '[a].txt')] })).toEqual({})
  expect(await server.call('diff', { path: '[a].txt', staged: true, untracked: false })).toMatchObject({ file: { added: 1, removed: 1 } })
  expect(await server.call('unstage', { paths: ['[a].txt'] })).toEqual({})
  expect(await server.call('diff', { path: 'new.txt', staged: false, untracked: true })).toMatchObject({ file: { path: 'new.txt', added: 1 } })
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
