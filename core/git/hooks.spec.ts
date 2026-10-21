import { afterEach, expect, test } from 'bun:test'
import { cleanup, makeRepo } from '../../test/fake-host.ts'
import type { DirEntry, FileStat, Host, RunResult } from '../host.ts'
import { type HookSignals, readHookSignals, usesHooks } from './hooks.ts'

const none: HookSignals = { hooksPath: null, hookFiles: [], hasHusky: false, hasLefthook: false, hasPreCommit: false, gitattributes: null }

test('usesHooks', () => {
  expect(usesHooks(none)).toBe(false)
  expect(usesHooks({ ...none, hookFiles: ['pre-commit.sample'] })).toBe(false)
  expect(usesHooks({ ...none, hookFiles: ['pre-commit'] })).toBe(true)
  expect(usesHooks({ ...none, hooksPath: '.husky' })).toBe(true)
  expect(usesHooks({ ...none, hasHusky: true })).toBe(true)
  expect(usesHooks({ ...none, hasLefthook: true })).toBe(true)
  expect(usesHooks({ ...none, hasPreCommit: true })).toBe(true)
  expect(usesHooks({ ...none, gitattributes: '*.bin filter=lfs diff=lfs' })).toBe(true)
  expect(usesHooks({ ...none, gitattributes: '* text=auto' })).toBe(false)
})

type Fake = { hooksPath?: string; hooksDir?: string; files?: Record<string, string>; dirs?: string[]; listing?: Record<string, DirEntry[]> }

function fake(o: Fake): Host {
  const files = o.files ?? {}
  const dirs = new Set(o.dirs ?? [])
  return {
    platform: 'linux',
    run: async (argv: readonly string[]): Promise<RunResult> => {
      const args = argv.slice(4).join(' ')
      if (args === 'config --show-scope --get-all core.hooksPath') {
        return o.hooksPath === undefined ? { exitCode: 1, stdout: '', stderr: '' } : { exitCode: 0, stdout: `local\t${o.hooksPath}\n`, stderr: '' }
      }
      if (args === 'rev-parse --git-common-dir') return { exitCode: 0, stdout: `${o.hooksDir?.replace(/\/hooks$/, '') ?? '.git'}\n`, stderr: '' }
      return { exitCode: 1, stdout: '', stderr: 'unexpected' }
    },
    stat: async (p: string): Promise<FileStat | null> => {
      if (p in files) return { kind: 'file', size: 1, realPath: p }
      if (dirs.has(p)) return { kind: 'dir', size: 0, realPath: p }
      return null
    },
    list: async (d: string) => {
      const l = o.listing?.[d]
      if (!l) throw new Error('ENOENT')
      return l
    },
    readText: async (p: string) => files[p] ?? null,
  } as unknown as Host
}

const f = (name: string): DirEntry => ({ name, kind: 'file', size: 1 })

afterEach(cleanup)

test('host-injected disabled hooks do not hide real repository hooks or invent hooks', async () => {
  const repo = await makeRepo()
  const run = repo.host.run.bind(repo.host)
  repo.host.run = (argv, options) => run([argv[0]!, '-c', 'core.hooksPath=\\\\.\\NUL', ...argv.slice(1)], options)
  expect(usesHooks(await readHookSignals(repo.host, repo.dir))).toBe(false)
  repo.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n')
  expect(usesHooks(await readHookSignals(repo.host, repo.dir))).toBe(true)
  await repo.git('config', 'core.hooksPath', '.custom-hooks')
  expect((await readHookSignals(repo.host, repo.dir)).hooksPath).toBe('.custom-hooks')
})

test('older Git without show-scope retains a configured hooksPath beneath a null-device override', async () => {
  const repo = await makeRepo()
  await repo.git('config', 'core.hooksPath', '.custom-hooks')
  const run = repo.host.run.bind(repo.host)
  repo.host.run = (argv, options) => argv.includes('--show-scope')
    ? Promise.resolve({ exitCode: 129, stdout: '', stderr: 'unknown option: show-scope' })
    : run([argv[0]!, '-c', 'core.hooksPath=\\\\.\\NUL', ...argv.slice(1)], options)
  expect((await readHookSignals(repo.host, repo.dir)).hooksPath).toBe('.custom-hooks')
})

test('readHookSignals on a plain repo', async () => {
  const s = await readHookSignals(fake({}), '/r')
  expect(s).toEqual(none)
  expect(usesHooks(s)).toBe(false)
})

test('readHookSignals finds hook files, worktree git dirs, configs and attributes', async () => {
  const host = fake({
    hooksPath: '.husky/_',
    hooksDir: '/main/.git/hooks',
    listing: { '/main/.git/hooks': [f('pre-commit'), f('commit-msg.sample'), { name: 'sub', kind: 'dir', size: 0 }] },
    dirs: ['/r/.husky'],
    files: { '/r/lefthook.yml': 'x', '/r/.pre-commit-config.yaml': 'x', '/r/.gitattributes': '*.psd filter=lfs' },
  })
  expect(await readHookSignals(host, '/r')).toEqual({
    hooksPath: '.husky/_',
    hookFiles: ['pre-commit', 'commit-msg.sample'],
    hasHusky: true,
    hasLefthook: true,
    hasPreCommit: true,
    gitattributes: '*.psd filter=lfs',
  })
})

test('relative hooks dir resolves against the root', async () => {
  const host = fake({ listing: { '/r/.git/hooks': [f('pre-push')] } })
  expect((await readHookSignals(host, '/r')).hookFiles).toEqual(['pre-push'])
})
