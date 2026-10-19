import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeHost, cleanup, configure, gitIn, makeRepo, makeTemp } from '../../test/fake-host.ts'
import { git } from './run.ts'
import { commitPlan, discard, fileDiff, generateMessage, initRepo, runSteps, snapshot, stage, sync, unstage } from './service.ts'
import type { GitSnapshot } from './service.ts'

afterEach(cleanup)

type RepoSnap = Extract<GitSnapshot, { root: string }>
async function snap(r: Awaited<ReturnType<typeof makeRepo>>): Promise<RepoSnap> {
  const s = await snapshot(r.host, r.dir)
  if (s.root === null) throw new Error('not a repo')
  return s
}

test('snapshot of a non-repo is { root: null }', async () => {
  const host = new FakeHost()
  expect(await snapshot(host, makeTemp('plain'))).toEqual({ root: null })
})

test('snapshot reports entries, numstat, staged counts and branch', async () => {
  const r = await makeRepo({ 'a.txt': 'one\ntwo\n', 'b.txt': 'x\n' })
  r.write('a.txt', 'one\ntwo\nthree\n')
  r.write('b.txt', 'y\n')
  r.write('new.txt', 'n\n')
  await r.git('add', 'b.txt')
  const s = await snap(r)
  expect(s.status.branch.head).toBe('main')
  const by = Object.fromEntries(s.status.entries.map((e) => [e.path, e]))
  expect(by['a.txt']).toMatchObject({ index: null, worktree: 'modified' })
  expect(by['b.txt']).toMatchObject({ index: 'modified', worktree: null })
  expect(by['new.txt']).toMatchObject({ worktree: 'untracked' })
  expect(s.numstat.get('a.txt')).toEqual({ added: 1, removed: 0 })
  expect(s.staged.get('b.txt')).toEqual({ added: 1, removed: 1 })
  expect(s.hooks).toBe(false)
})

test('a real pre-commit hook sets hooks: true', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n')
  expect((await snap(r)).hooks).toBe(true)
})

test('stage and unstage round-trip; empty input runs no git', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('a.txt', 'y\n')
  await stage(r.host, r.dir, ['a.txt'])
  expect((await snap(r)).status.entries[0]).toMatchObject({ index: 'modified', worktree: null })
  await unstage(r.host, r.dir, ['a.txt'])
  expect((await snap(r)).status.entries[0]).toMatchObject({ index: null, worktree: 'modified' })
  const before = r.host.calls.length
  await stage(r.host, r.dir, [])
  await unstage(r.host, r.dir, [])
  expect(r.host.calls.length).toBe(before)
})

test('discard removes untracked files and restores modified ones', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('a.txt', 'changed\n')
  r.write('u.txt', 'u\n')
  await discard(r.host, r.dir, (await snap(r)).status.entries)
  expect(readFileSync(join(r.dir, 'a.txt'), 'utf8')).toBe('x\n')
  expect(existsSync(join(r.dir, 'u.txt'))).toBe(false)
  expect((await snap(r)).status.entries).toEqual([])
})

test('fileDiff: untracked is all additions (exit 1 is success)', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('u.txt', 'l1\nl2\n')
  const { file, truncated } = await fileDiff(r.host, r.dir, 'u.txt', { staged: false, untracked: true })
  expect(truncated).toBe(false)
  expect(file?.path).toBe('u.txt')
  const lines = file?.hunks.flatMap((h) => h.lines) ?? []
  expect(lines.map((l) => l.kind)).toEqual(['add', 'add'])
})

test('fileDiff: working and staged, and a cap at 5000 lines', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('a.txt', 'y\n')
  const work = await fileDiff(r.host, r.dir, 'a.txt', { staged: false, untracked: false })
  expect(work.file?.added).toBe(1)
  expect((await fileDiff(r.host, r.dir, 'a.txt', { staged: true, untracked: false })).file).toBeNull()
  await r.git('add', 'a.txt')
  expect((await fileDiff(r.host, r.dir, 'a.txt', { staged: true, untracked: false })).file?.removed).toBe(1)
  r.write('big.txt', Array.from({ length: 6000 }, (_, i) => `line ${i}`).join('\n') + '\n')
  const big = await fileDiff(r.host, r.dir, 'big.txt', { staged: false, untracked: true })
  expect(big.truncated).toBe(true)
  expect(big.file?.hunks.reduce((n, h) => n + h.lines.length, 0)).toBe(5000)
})

test('commitPlan flags .env under smart commit, and runSteps commits as Ana', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('.env', 'TOKEN=1\n')
  r.write('a.txt', 'y\n')
  const s = await snap(r)
  const plan = commitPlan(s, { message: 'feat: x', mode: 'commit', smartCommit: true })
  expect(plan.sensitive).toEqual(['.env'])
  expect(plan.steps).toEqual([['add', '-A'], ['commit', '-m', 'feat: x']])
  expect(plan.viaAgentShell).toBe(false)
  await runSteps(r.host, r.dir, plan.steps)
  expect(await r.git('log', '-1', '--format=%an <%ae>|%s')).toBe('Ana Rivera <ana@example.com>|feat: x')
})

test('commitPlan: staged files skip add -A and only staged sensitive paths count', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('.env', 'T=1\n')
  r.write('a.txt', 'y\n')
  await r.git('add', 'a.txt')
  const plan = commitPlan(await snap(r), { message: 'm', mode: 'commit', smartCommit: true })
  expect(plan.sensitive).toEqual([])
  expect(plan.steps).toEqual([['commit', '-m', 'm']])
})

test('commitPlan publishes the branch when there is no upstream', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  const plan = commitPlan(await snap(r), { message: 'm', mode: 'commit-push', smartCommit: false })
  expect(plan.steps.at(-1)).toEqual(['push', '-u', 'origin', 'main'])
})

test('runSteps stops at the first GitError', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  const err = await runSteps(r.host, r.dir, [['commit', '-m', 'nothing'], ['tag', 'never']]).catch((e) => e)
  expect(err.name).toBe('GitError')
  expect(r.host.calls.some((c) => c.includes('tag'))).toBe(false)
})

test('initRepo creates a repository', async () => {
  const host = new FakeHost()
  const dir = makeTemp('fresh')
  await initRepo(host, dir)
  expect((await snapshot(host, dir)).root).not.toBeNull()
})

test('generateMessage cleans the model reply and prefers the staged diff', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n', 'b.txt': 'b\n' })
  r.write('a.txt', 'STAGEDCHANGE\n')
  r.write('b.txt', 'WORKTREECHANGE\n')
  await r.git('add', 'a.txt')
  r.host.completeReply = '```feat: x```'
  expect(await generateMessage(r.host, r.dir, 'model-1', 1)).toBe('feat: x')
  expect(r.host.prompts[0]?.model).toBe('model-1')
  expect(r.host.prompts[0]?.prompt).toContain('STAGEDCHANGE')
  expect(r.host.prompts[0]?.prompt).not.toContain('WORKTREECHANGE')
  r.host.completeReply = 'fix: y'
  await generateMessage(r.host, r.dir, '', 0)
  expect(r.host.prompts[1]?.prompt).toContain('WORKTREECHANGE')
})

async function remotePair() {
  const r = await makeRepo({ 'a.txt': 'base\n' })
  const bare = makeTemp('origin.git')
  await gitIn(r.host, bare, 'init', '--bare', '-b', 'main')
  await r.git('remote', 'add', 'origin', bare)
  await r.git('push', '-u', 'origin', 'main')
  const leo = makeTemp('leo-app')
  await gitIn(r.host, leo, 'clone', bare, '.')
  await configure(r.host, leo, { name: 'Leo Park', email: 'leo@example.com' })
  return { r, bare, leo }
}

test('sync pushes when ahead; reports detached HEAD', async () => {
  const { r } = await remotePair()
  r.write('b.txt', 'b\n')
  await r.git('add', '-A')
  await r.git('commit', '-m', 'feat: b')
  const s = await snap(r)
  expect(await sync(r.host, r.dir, s.status.branch)).toEqual({ ok: true })
  expect((await snap(r)).status.branch.ahead).toBe(0)
  const detached = { ...s.status.branch, head: null }
  expect(await sync(r.host, r.dir, detached)).toEqual({ ok: false, error: 'Detached HEAD: check out a branch to sync.' })
})

async function diverged() {
  const { r, leo } = await remotePair()
  await gitIn(r.host, leo, 'commit', '--allow-empty', '-m', 'feat: leo')
  await gitIn(r.host, leo, 'push')
  r.write('mine.txt', 'm\n')
  await r.git('add', '-A')
  await r.git('commit', '-m', 'feat: mine')
  await r.git('fetch')
  const s = await snap(r)
  expect([s.status.branch.ahead, s.status.branch.behind]).toEqual([1, 1])
  return { r, branch: s.status.branch }
}

test('sync reports divergence, then resolves it with merge', async () => {
  const { r, branch } = await diverged()
  expect(await sync(r.host, r.dir, branch)).toEqual({ ok: false, divergence: true })
  expect(await sync(r.host, r.dir, branch, 'merge')).toEqual({ ok: true })
  expect(await r.git('rev-list', '--count', '@{u}..HEAD')).toBe('0')
})

test('sync resolves divergence with rebase; other failures give the first line', async () => {
  const { r, branch } = await diverged()
  expect(await sync(r.host, r.dir, branch, 'rebase')).toEqual({ ok: true })
  await r.git('remote', 'set-url', 'origin', join(r.dir, 'nowhere'))
  const bad = await sync(r.host, r.dir, { ...branch, behind: 0, ahead: 1 })
  expect(bad.ok).toBe(false)
  const first = (await r.host.run(['git', '-C', r.dir, 'push'])).stderr.split('\n').find((l) => l.trim() !== '')?.trim()
  expect(bad).toEqual({ ok: false, error: first as string })
})

test('git helper is usable on the fake host', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  expect((await git(r.host, r.dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()).toBe('main')
})

test('discard treats names with glob characters literally', async () => {
  const r = await makeRepo({ 'keep.txt': 'k\n' })
  r.write('app/[id]/page.tsx', 'a\n')
  r.write('app/d/page.tsx', 'd\n')
  r.write('app/i/page.tsx', 'i\n')
  const entries = (await snap(r)).status.entries.filter((e) => e.path === 'app/[id]/page.tsx')
  expect(entries.length).toBe(1)
  await discard(r.host, r.dir, entries)
  expect(existsSync(join(r.dir, 'app/[id]/page.tsx'))).toBe(false)
  expect(existsSync(join(r.dir, 'app/d/page.tsx'))).toBe(true)
  expect(existsSync(join(r.dir, 'app/i/page.tsx'))).toBe(true)
})

test('stage treats glob characters in a file name literally', async () => {
  const r = await makeRepo({ 'keep.txt': 'k\n' })
  r.write('a[bc].txt', '1\n')
  r.write('ab.txt', '2\n')
  await stage(r.host, r.dir, ['a[bc].txt'])
  const by = Object.fromEntries((await snap(r)).status.entries.map((e) => [e.path, e]))
  expect(by['a[bc].txt']?.index).toBe('added')
  expect(by['ab.txt']?.index).toBeNull()
})

test('numstat follows a staged rename', async () => {
  const r = await makeRepo({ 'old.txt': 'one\ntwo\nthree\nfour\n' })
  await r.git('mv', 'old.txt', 'new.txt')
  r.write('new.txt', 'one\ntwo\nthree\nfour\nfive\n')
  await r.git('add', 'new.txt')
  const s = await snap(r)
  expect(s.status.entries[0]).toMatchObject({ path: 'new.txt', origPath: 'old.txt' })
  expect(s.staged.get('new.txt')).toEqual({ added: 1, removed: 0 })
})

test('generateMessage lists new files when nothing is staged', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  r.write('brand-new.ts', 'x\n')
  r.host.completeReply = 'feat: add file'
  await generateMessage(r.host, r.dir, '', 0)
  expect(r.host.prompts[0]?.prompt).toContain('New files: brand-new.ts')
})

test('a non-git failure while reading config is rethrown', async () => {
  const r = await makeRepo({ 'a.txt': 'x\n' })
  const branch = (await snap(r)).status.branch
  const host = Object.assign(Object.create(r.host), {
    run: async () => {
      throw new Error('spawn failed')
    },
  })
  await expect(sync(host, r.dir, branch)).rejects.toThrow('spawn failed')
})

test('sync runs its steps through a caller runner when given one', async () => {
  const { r } = await remotePair()
  const s = await snap(r)
  const seen: string[][] = []
  const res = await sync(r.host, r.dir, { ...s.status.branch, behind: 0, ahead: 1 }, undefined, async (steps) => {
    seen.push(...steps)
  })
  expect(res).toEqual({ ok: true })
  expect(seen).toEqual([['push']])
})
