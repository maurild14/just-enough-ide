import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { claudeHost } from './host.ts'
import { projectHost } from './files.tsx'

/** Just the nouns claudeHost touches, answering from the test. */
function fakeEngine(parts: { run?: unknown; stat?: unknown; read?: unknown; complete?: unknown; spawn?: unknown; write?: unknown; after?: unknown }): EngineInterface {
  return {
    process: { run: parts.run, spawn: parts.spawn },
    fs: { stat: parts.stat, read: parts.read, list: async () => [], write: parts.write },
    model: { complete: parts.complete },
    clock: { after: parts.after },
  } as unknown as EngineInterface
}

test('new project boundaries distinguish native UNC proof from POSIX backslash components and refuse ambiguous metadata', async () => {
  const resolve = (realPath: string | undefined) => projectHost(fakeEngine({ stat: async () => ({ realPath }) }), '//work/acme-app')
  expect((await resolve('/work/acme-app')).platform).toBe('linux')
  expect((await resolve('/work/a\\b')).platform).toBe('linux')
  expect((await resolve('\\\\server\\share\\acme-app')).platform).toBe('win32')
  expect((await resolve('C:\\work\\acme-app')).platform).toBe('win32')
  for (const value of [undefined, '//work/acme-app', 'work/acme-app', 'C:relative']) await expect(resolve(value)).rejects.toThrow('Cannot determine')
})

test('stream maps the verified spawn request, frames chunks, captures stderr and closes on cancel', async () => {
  const seen: unknown[] = []
  let closed = 0
  const host = claudeHost(fakeEngine({
    spawn: (request: unknown) => {
      seen.push(request)
      return (async function* () {
        try {
          yield { stream: 'stdout', text: 'ñ😀\npar' }
          yield { stream: 'stderr', text: 'notice' }
          yield { stream: 'stdout', text: 'tial\nlast' }
          return { code: 0, signal: null }
        } finally { closed++ }
      })()
    },
    write: async (path: string, text: string) => { seen.push([path, text]) },
  }), 'linux')
  const stream = host.stream(['rg', '-e', '-rf'], { cwd: '/work/acme-app', stdin: 'input', env: { A: 'b' } })
  const lines: string[] = []
  for await (const line of stream.lines) lines.push(line)
  expect(lines).toEqual(['ñ😀', 'partial', 'last'])
  expect(await stream.done).toEqual({ exitCode: 0, stderr: 'notice' })
  expect(seen[0]).toEqual({ argv: ['rg', '-e', '-rf'], cwd: '/work/acme-app', input: 'input', env: { A: 'b' } })
  await host.writeText('a.txt', 'ñ\r\n')
  expect(seen[1]).toEqual(['a.txt', 'ñ\r\n'])
  expect(closed).toBe(1)
  const cancelled = host.stream(['rg'])
  for await (const _line of cancelled.lines) { cancelled.cancel(); break }
  await cancelled.done
  expect(closed).toBe(2)
})

test('a stalled stream keeps backpressure and a host timer cancels its producer', async () => {
  let produced = 0
  let closed = false
  let timeout!: () => void
  let timerCancelled = false
  const host = claudeHost(fakeEngine({
    spawn: () => (async function* () {
      try {
        for (let i = 0; i < 2000; i++) { produced++; yield { stream: 'stdout', text: 'line\n' } }
        return { code: 0, signal: null }
      } finally { closed = true }
    })(),
    after: (ms: number, run: () => void) => { expect(ms).toBe(10); timeout = run; return { cancel() { timerCancelled = true } } },
  }), 'linux')
  const stream = host.stream(['rg'], { timeoutMs: 10 })
  for (let i = 0; i < 300; i++) await Promise.resolve()
  expect(produced).toBeLessThan(2000)
  timeout()
  expect((await stream.done).exitCode).not.toBe(0)
  expect(closed).toBe(true)
  expect(timerCancelled).toBe(true)
})

test('cancel before a pending pull delivers 64 lines never creates a new backpressure wait', async () => {
  let deliver!: () => void
  let closed = false
  const host = claudeHost(fakeEngine({ spawn: () => (async function* () {
    try {
      yield { stream: 'stdout', text: 'early\n'.repeat(63) }
      await new Promise<void>(resolve => { deliver = resolve })
      yield { stream: 'stdout', text: 'late\n'.repeat(64) }
      return { code: 0, signal: null }
    } finally { closed = true }
  })() }), 'linux')
  const stream = host.stream(['rg'])
  for (let i = 0; i < 100; i++) await Promise.resolve()
  stream.cancel()
  deliver()
  let settled = false
  void stream.done.then(() => { settled = true })
  for (let i = 0; i < 100; i++) await Promise.resolve()
  expect(settled).toBe(true)
  expect(closed).toBe(true)
  const lines: string[] = []
  if (settled) for await (const line of stream.lines) lines.push(line)
  expect(lines).toEqual(Array(63).fill('early'))
})

test('oversized stdout lines and stderr reject and close the spawned source', async () => {
  for (const pipe of ['stdout', 'stderr']) {
    let closed = false
    const host = claudeHost(fakeEngine({ spawn: () => (async function* () {
      try {
        yield { stream: pipe, text: 'x'.repeat(8 * 1024 * 1024 + 1) }
        return { code: 0, signal: null }
      } finally { closed = true }
    })() }), 'linux')
    const stream = host.stream(['rg'])
    const consume = async () => { for await (const _line of stream.lines) {} }
    await expect(consume()).rejects.toThrow('8 MiB')
    await expect(stream.done).rejects.toThrow('8 MiB')
    expect(closed).toBe(true)
  }
})

const result = (over: Record<string, unknown> = {}) => ({
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
  ...over,
})

test('run passes argv and init through and keeps the result', async () => {
  const seen: unknown[] = []
  const host = claudeHost(fakeEngine({ run: async (argv: string[], init: unknown) => (seen.push(argv, init), result()) }), 'linux')
  expect(await host.run(['git', 'status'], { cwd: '/work/acme-app', timeoutMs: 5 })).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
  expect(seen).toEqual([['git', 'status'], { cwd: '/work/acme-app', timeoutMs: 5 }])
})

test('a truncated stdout fails instead of parsing a partial list', async () => {
  const host = claudeHost(fakeEngine({ run: async () => result({ isStdoutTruncated: true }) }), 'linux')
  await expect(host.run(['git', '--no-optional-locks', '-C', '/work/acme-app', 'ls-files'])).rejects.toThrow(
    'File list too large',
  )
})

test('an aborted run never starts', async () => {
  let started = false
  const host = claudeHost(fakeEngine({ run: async () => ((started = true), result()) }), 'linux')
  const ctl = new AbortController()
  ctl.abort()
  await expect(host.run(['git'], { signal: ctl.signal })).rejects.toThrow('aborted')
  expect(started).toBe(false)
})

test('stat fails closed without a realPath', async () => {
  const resolved = claudeHost(
    fakeEngine({ stat: async () => ({ kind: 'file', size: 3, mtimeMs: 0, isLink: false, realPath: '/work/acme-app/a.ts' }) }),
    'linux',
  )
  expect(await resolved.stat('a.ts')).toEqual({ kind: 'file', size: 3, realPath: '/work/acme-app/a.ts' })
  const unresolved = claudeHost(fakeEngine({ stat: async () => ({ kind: 'file', size: 3, mtimeMs: 0, isLink: false }) }), 'linux')
  expect(await unresolved.stat('a.ts')).toBeNull()
  const missing = claudeHost(fakeEngine({ stat: async () => Promise.reject(new Error('ENOENT')) }), 'linux')
  expect(await missing.stat('a.ts')).toBeNull()
})

test('readHead decodes the bytes and cuts at maxBytes', async () => {
  const host = claudeHost(fakeEngine({ read: async () => ({ base64: btoa('hello') }) }), 'linux')
  expect([...(await host.readHead('a.txt', 3))!]).toEqual([104, 101, 108])
})

test('complete uses haiku by default, a 30 s timeout, and throws on no answer', async () => {
  const asked: unknown[] = []
  const host = claudeHost(
    fakeEngine({ complete: async (req: unknown) => (asked.push(req), { isAnswered: true, text: 'feat: x', usage: {} }) }),
    'linux',
  )
  expect(await host.complete('diff', '')).toBe('feat: x')
  expect(asked).toEqual([{ model: 'haiku', prompt: 'diff', timeoutMs: 30_000 }])
  const silent = claudeHost(fakeEngine({ complete: async () => ({ isAnswered: false, reason: 'empty-reply', usage: {} }) }), 'linux')
  await expect(silent.complete('diff', 'sonnet')).rejects.toThrow('empty-reply')
})
