import { expect, test } from 'bun:test'
import { commitSteps, discardArgs, discardPlan, stageArgs, unstageArgs } from './commands.ts'
import type { StatusEntry } from './status.ts'

const e = (path: string, index: StatusEntry['index'], worktree: StatusEntry['worktree']): StatusEntry => ({ path, index, worktree })

test('stage and unstage argv', () => {
  expect(stageArgs(['a', 'b'])).toEqual(['add', '--', 'a', 'b'])
  expect(unstageArgs(['a'])).toEqual(['restore', '--staged', '--', 'a'])
})

test('stage and unstage return no steps for empty input', () => {
  expect(stageArgs([])).toEqual([])
  expect(unstageArgs([])).toEqual([])
})

test('option-like paths and messages stay single argv elements after -- / -m', () => {
  expect(stageArgs(['-f'])).toEqual(['add', '--', '-f'])
  expect(unstageArgs(['-f'])).toEqual(['restore', '--staged', '--', '-f'])
  expect(discardArgs({ restore: ['-f'], clean: ['-f'] })).toEqual([
    ['restore', '--worktree', '--', '-f'],
    ['clean', '-f', '--', '-f'],
  ])
  expect(commitSteps({ message: '-x', mode: 'commit', smartCommit: false, stagedCount: 1 })).toEqual([['commit', '-m', '-x']])
})

test('discardPlan routes by worktree status', () => {
  const plan = discardPlan([
    e('m.ts', null, 'modified'),
    e('d.ts', null, 'deleted'),
    e('u.ts', null, 'untracked'),
    e('staged-only.ts', 'added', null),
    e('both.ts', 'modified', 'modified'),
  ])
  expect(plan).toEqual({ restore: ['m.ts', 'd.ts', 'both.ts'], clean: ['u.ts'] })
})

test('discardArgs skips empty groups', () => {
  expect(discardArgs({ restore: ['a'], clean: ['b'] })).toEqual([
    ['restore', '--worktree', '--', 'a'],
    ['clean', '-f', '--', 'b'],
  ])
  expect(discardArgs({ restore: [], clean: ['b'] })).toEqual([['clean', '-f', '--', 'b']])
  expect(discardArgs({ restore: [], clean: [] })).toEqual([])
})

test('commitSteps', () => {
  const base = { message: 'feat: x', mode: 'commit' as const, smartCommit: true, stagedCount: 0 }
  expect(commitSteps(base)).toEqual([['add', '-A'], ['commit', '-m', 'feat: x']])
  expect(commitSteps({ ...base, stagedCount: 2 })).toEqual([['commit', '-m', 'feat: x']])
  expect(commitSteps({ ...base, smartCommit: false })).toEqual([['commit', '-m', 'feat: x']])
  expect(commitSteps({ ...base, mode: 'commit-push' })).toEqual([['add', '-A'], ['commit', '-m', 'feat: x'], ['push']])
  expect(commitSteps({ ...base, mode: 'commit-push', publish: 'main' })).toEqual([
    ['add', '-A'],
    ['commit', '-m', 'feat: x'],
    ['push', '-u', 'origin', 'main'],
  ])
  expect(commitSteps({ ...base, mode: 'commit', publish: 'main' })).toEqual([['add', '-A'], ['commit', '-m', 'feat: x']])
  expect(commitSteps({ ...base, mode: 'amend' })).toEqual([['commit', '--amend', '-m', 'feat: x']])
})
