import { expect, test } from 'bun:test'
import { GitError } from './run.ts'
import type { BranchInfo } from './status.ts'
import { isDivergence, resolveDivergence, syncSteps } from './sync.ts'

const b = (o: Partial<BranchInfo>): BranchInfo => ({ head: 'main', oid: 'abc', upstream: 'origin/main', ahead: 0, behind: 0, ...o })
const none = { rebase: null, ff: null }

test('default config pulls ff-only then pushes when ahead', () => {
  expect(syncSteps(none, b({ ahead: 1, behind: 2 }))).toEqual([['pull', '--ff-only'], ['push']])
  expect(syncSteps(none, b({ behind: 2 }))).toEqual([['pull', '--ff-only']])
})

test('no upstream publishes the branch', () => {
  expect(syncSteps(none, b({ upstream: null }))).toEqual([['push', '-u', 'origin', 'main']])
})

test('behind 0 only pushes', () => {
  expect(syncSteps(none, b({ ahead: 3 }))).toEqual([['push']])
})

test('user config is respected', () => {
  expect(syncSteps({ rebase: 'true', ff: null }, b({ ahead: 1, behind: 1 }))).toEqual([['pull'], ['push']])
  expect(syncSteps({ rebase: null, ff: 'only' }, b({ behind: 1 }))).toEqual([['pull']])
})

test('detached head has nothing to sync', () => {
  expect(syncSteps(none, b({ head: null, upstream: null }))).toEqual([])
})

const err = (stderr: string) => new GitError(['git', 'pull'], { exitCode: 128, stdout: '', stderr })

test('isDivergence', () => {
  expect(isDivergence(err('fatal: Not possible to fast-forward, aborting.'))).toBe(true)
  expect(isDivergence(err('hint: diverging branches cannot be fast-forwarded'))).toBe(true)
  expect(isDivergence(err('fatal: Need to specify how to reconcile divergent branches.'))).toBe(true)
  expect(isDivergence(err("hint: Diverging branches can't be fast-forwarded, you need to either:"))).toBe(true)
  expect(isDivergence(err('FATAL: NOT POSSIBLE TO FAST-FORWARD, ABORTING.'))).toBe(true)
  expect(isDivergence(err('fatal: unable to access remote'))).toBe(false)
})

test('resolveDivergence', () => {
  expect(resolveDivergence('merge')).toEqual([['pull', '--no-rebase', '--ff'], ['push']])
  expect(resolveDivergence('rebase')).toEqual([['pull', '--rebase'], ['push']])
})
