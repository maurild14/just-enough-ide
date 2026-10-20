import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { branchesArgs, compareArgs, compareDiffArgs, createPlan, defaultBase, parseBranches, switchPlan } from './branches.ts'

const hash = 'a'.repeat(40)
const fixture = () => parseBranches(readFileSync(new URL('../../test/fixtures/git/refs-basic.txt', import.meta.url), 'utf8'))

test('branch records sort current/local/remote and retain gone upstream metadata', () => {
  const rows = fixture()
  expect(rows.map((branch) => branch.name)).toEqual(['feature', 'main', 'old', 'origin/feature', 'origin/main'])
  expect(rows[0]).toEqual({ name: 'feature', remote: false, current: true, upstream: 'origin/feature', gone: false, ahead: 2, behind: 1, hash })
  expect(rows[2]).toMatchObject({ upstream: null, gone: true })
  expect(branchesArgs()).toEqual(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)', 'refs/heads', 'refs/remotes'])
})

test('default base prefers the actual origin HEAD target, main, then master', () => {
  const rows = fixture()
  expect(defaultBase(rows, 'refs/remotes/origin/feature')).toBe('refs/remotes/origin/feature')
  expect(defaultBase(rows, 'origin/missing')).toBe('refs/heads/main')
  expect(defaultBase(rows.filter((branch) => branch.name !== 'main'), null)).toBeNull()
  expect(defaultBase([{ ...rows[0]!, name: 'master' }], null)).toBe('refs/heads/master')
})

test('default base retains remote provenance when a custom target collides with local main', () => {
  const local = { ...fixture()[0]!, name: 'main', remote: false }
  const remote = { ...local, remote: true, hash: 'b'.repeat(40) }
  expect(defaultBase([local, remote], 'refs/remotes/main')).toBe('refs/remotes/main')
  expect(defaultBase([remote, local], null)).toBe('refs/heads/main')
})

test('safe switch plans track remote branches or use an existing local branch', () => {
  const remote = fixture().find((branch) => branch.name === 'origin/feature')!
  expect(switchPlan(remote, false, [])).toEqual({ steps: [['switch', '--track', 'origin/feature']], confirm: null })
  expect(switchPlan(remote, false, fixture())).toEqual({ steps: [['switch', 'feature']], confirm: null })
  const dirty = switchPlan(remote, true, [])
  expect(dirty.confirm).toBe('You have uncommitted changes. Switch and carry them over?')
  expect(dirty.steps.flat().some((word) => ['--force', '--discard-changes', 'stash'].includes(word))).toBe(false)
  expect(switchPlan({ ...remote, name: '-x' }, true, [])).toEqual({ steps: [], confirm: null })
  expect(switchPlan({ ...remote, name: 'origin/@' }, true, [])).toEqual({ steps: [], confirm: null })
})

test('create validates full commit hashes and compare separates revisions from paths', () => {
  expect(() => createPlan('feat/x', 'zz', false)).toThrow('Invalid commit hash.')
  expect(createPlan('feat/x', hash, false)).toEqual({ steps: [['switch', '-c', 'feat/x', hash]], confirm: null })
  expect(createPlan('feat/x', null, true).confirm).not.toBeNull()
  expect(compareArgs('main', 'feature')).toEqual(['diff', '--name-status', '-z', '-M', '--end-of-options', 'main...feature'])
  expect(compareDiffArgs('main', 'feature', '-file')).toEqual(['diff', '--no-color', '--no-ext-diff', '-M', '--end-of-options', 'main...feature', '--', '-file'])
})
