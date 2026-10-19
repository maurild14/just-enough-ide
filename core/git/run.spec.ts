import { expect, test } from 'bun:test'
import type { Host, RunOptions, RunResult } from '../host.ts'
import { GIT_ENV, GitError, git, gitArgv } from './run.ts'
import { isRepo } from './status.ts'

function fakeHost(result: RunResult) {
  const calls: { argv: readonly string[]; options?: RunOptions }[] = []
  const host = {
    platform: 'linux',
    run: async (argv: readonly string[], options?: RunOptions) => {
      calls.push({ argv, options })
      return result
    },
  } as unknown as Host
  return { host, calls }
}

test('gitArgv', () => {
  expect(gitArgv('/r', ['status'])).toEqual(['git', '--no-optional-locks', '-C', '/r', 'status'])
})

test('GIT_ENV disables optional locks', () => expect(GIT_ENV).toEqual({ GIT_OPTIONAL_LOCKS: '0' }))

test('git passes argv and merges env', async () => {
  const { host, calls } = fakeHost({ exitCode: 0, stdout: 'ok', stderr: '' })
  const res = await git(host, '/r', ['log'], { env: { LANG: 'C' }, timeoutMs: 5 })
  expect(res.stdout).toBe('ok')
  expect(calls[0]?.argv).toEqual(['git', '--no-optional-locks', '-C', '/r', 'log'])
  expect(calls[0]?.options).toEqual({ env: { GIT_OPTIONAL_LOCKS: '0', LANG: 'C' }, timeoutMs: 5 })
})

test('git throws GitError with the first stderr line', async () => {
  const { host } = fakeHost({ exitCode: 128, stdout: '', stderr: '\nfatal: not a git repository\nhint: more\n' })
  const err = await git(host, '/r', ['status']).catch((e) => e)
  expect(err).toBeInstanceOf(GitError)
  expect(err.exitCode).toBe(128)
  expect(err.firstLine).toBe('fatal: not a git repository')
  expect(err.message).toBe('fatal: not a git repository')
  expect(err.argv).toEqual(['git', '--no-optional-locks', '-C', '/r', 'status'])
})

test('GitError.firstLine falls back to stdout then the exit code', async () => {
  const a = await git(fakeHost({ exitCode: 1, stdout: 'CONFLICT in x\nmore', stderr: '  \n' }).host, '/r', ['merge']).catch((e) => e)
  expect(a.firstLine).toBe('CONFLICT in x')
  const b = await git(fakeHost({ exitCode: 3, stdout: '', stderr: '' }).host, '/r', ['merge']).catch((e) => e)
  expect(b.firstLine).toBe('git exited with 3')
})

test('isRepo returns the trimmed root, or null on failure', async () => {
  const ok = fakeHost({ exitCode: 0, stdout: '/home/x/acme-app\n', stderr: '' })
  expect(await isRepo(ok.host, '/home/x/acme-app/src')).toBe('/home/x/acme-app')
  expect(ok.calls[0]?.argv).toEqual(['git', '--no-optional-locks', '-C', '/home/x/acme-app/src', 'rev-parse', '--show-toplevel'])
  const win = fakeHost({ exitCode: 0, stdout: 'C:/work/acme-app\r\n', stderr: '' })
  expect(await isRepo(win.host, 'C:\\work')).toBe('C:/work/acme-app')
  const no = fakeHost({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })
  expect(await isRepo(no.host, '/tmp')).toBeNull()
})
