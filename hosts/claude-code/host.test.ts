import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { claudeHost } from './host.ts'

/** Just the nouns claudeHost touches, answering from the test. */
function fakeEngine(parts: { run?: unknown; stat?: unknown; read?: unknown; complete?: unknown }): EngineInterface {
  return {
    process: { run: parts.run },
    fs: { stat: parts.stat, read: parts.read, list: async () => [] },
    model: { complete: parts.complete },
  } as unknown as EngineInterface
}

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
    'Output too large: git --no-optional-locks -C',
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
