import { afterEach, expect, test } from 'bun:test'
import { cleanup, makeRepo } from '../../test/fake-host.ts'
import { AgentCommits, parseReflog, creationAction } from './agent.ts'
import { agentCandidates, captureReflog, newlyReachable } from './service.ts'

afterEach(cleanup)
const hash = (n: number) => n.toString(16).padStart(40, '0')

test('tool marks recent evidenced commits, observes outside commits and explicit final HEAD', () => {
  const a = new AgentCommits()
  const token = a.toolStart(hash(1), 100)
  a.observe(hash(9))
  a.toolEnd(token, hash(3), [{ hash: hash(2), time: 98 }, { hash: hash(3), time: 99 }, { hash: hash(4), time: 97 }])
  expect(a.toJSON()).toEqual([hash(2), hash(3)])
  expect(a.lastHead()).toBe(hash(3))
  a.observe(hash(5)); expect(a.has(hash(5))).toBe(false)
  const switchToken = a.toolStart(hash(5), 100)
  a.toolEnd(switchToken, hash(1), [{ hash: hash(1), time: 90 }])
  expect(a.has(hash(1))).toBe(false)
  expect(a.lastHead()).toBe(hash(1))
})

test('overlaps, JEI invalidation and duplicate ends never attribute commits', () => {
  const a = new AgentCommits()
  const t1 = a.toolStart(hash(1), 100), t2 = a.toolStart(hash(1), 100)
  a.toolEnd(t1, hash(2), [{ hash: hash(2), time: 100 }])
  const t3 = a.toolStart(hash(2), 100)
  a.toolEnd(t2, hash(3), [{ hash: hash(3), time: 100 }])
  a.toolEnd(t3, hash(4), [{ hash: hash(4), time: 100 }])
  const t4 = a.toolStart(hash(4), 100)
  a.invalidate(); a.toolEnd(t4, hash(5), [{ hash: hash(5), time: 100 }])
  a.toolEnd(t4, hash(6), [{ hash: hash(6), time: 100 }])
  expect(a.toJSON()).toEqual([])
})

test('persistence validates hashes, retains insertion order and caps at 1000', () => {
  const a = AgentCommits.from(['invalid', ...Array.from({ length: 1002 }, (_, n) => hash(n))])
  expect(a.toJSON()).toHaveLength(1000)
  expect(a.has(hash(0))).toBe(false)
  expect(AgentCommits.from(a.toJSON()).toJSON()).toEqual(a.toJSON())
})

test('reflog grammar recognizes only known commit-producing actions', () => {
  const raw = `${hash(1)}\0HEAD@{1700000000 +0000}\0commit (initial): chore: initial\0`
  expect(parseReflog(raw)![0]).toMatchObject({ hash: hash(1), action: 'commit (initial): chore: initial', identity: raw.slice(0, -1) })
  expect(parseReflog('broken')).toBeNull()
  for (const action of ['commit: x', 'commit (initial): x', 'commit (amend): x', 'commit (merge): x', 'commit (cherry-pick): x', 'commit (rebase): x', 'merge other: Merge made by the ort strategy.', 'revert: x', 'cherry-pick: x', 'rebase (pick): x', 'rebase (reword): x']) expect(creationAction(action)).toBe(true)
  for (const action of ['checkout: x', 'reset: x', 'merge other: Fast-forward', 'pull: Fast-forward', 'fetch: x', 'rebase (start): x', 'rebase (finish): x', 'custom: x']) expect(creationAction(action)).toBe(false)
})

test('real reflog witness excludes same-second checkout/reset history and keeps new creations', async () => {
  const r = await makeRepo()
  const root = await r.git('rev-parse', 'HEAD')
  await r.git('checkout', '-b', 'other')
  await r.git('commit', '--allow-empty', '-m', 'feat: outside')
  const outside = await r.git('rev-parse', 'HEAD')
  await r.git('checkout', 'main')
  const boundary = await captureReflog(r.host, r.dir, root)
  expect(boundary).not.toBeNull()
  await r.git('checkout', 'other')
  expect(await agentCandidates(r.host, r.dir, root, outside, boundary)).toEqual([])
  await r.git('commit', '--allow-empty', '-m', 'feat: during')
  const created = await r.git('rev-parse', 'HEAD')
  expect((await agentCandidates(r.host, r.dir, root, created, boundary)).map((c) => c.hash)).toEqual([created])
  await r.git('checkout', 'main')
  const resetBoundary = await captureReflog(r.host, r.dir, root)
  await r.git('reset', '--hard', created)
  expect(await agentCandidates(r.host, r.dir, root, created, resetBoundary)).toEqual([])
  expect(await agentCandidates(r.host, r.dir, root, created, null)).toEqual([])
  expect(await agentCandidates(r.host, r.dir, root, created, { entry: 'missing' })).toEqual([])
})

test('unborn boundary marks initial commit, newly reachable is bounded and validates OIDs', async () => {
  const r = await makeRepo({}, 0)
  const boundary = await captureReflog(r.host, r.dir, null)
  expect(boundary).toEqual({ entry: null })
  await r.git('commit', '--allow-empty', '-m', 'chore: initial')
  const to = await r.git('rev-parse', 'HEAD')
  expect((await agentCandidates(r.host, r.dir, null, to, boundary)).map((c) => c.hash)).toEqual([to])
  expect((await newlyReachable(r.host, r.dir, null, to))[0]?.hash).toBe(to)
  expect(r.host.calls.some((c) => c.includes('--max-count=500'))).toBe(true)
  await expect(newlyReachable(r.host, r.dir, 'HEAD', to)).rejects.toThrow()
})

test('null HEAD is verified against existing history and a commit racing baseline capture', async () => {
  const existing = await makeRepo()
  expect(await captureReflog(existing.host, existing.dir, null)).toBeNull()
  await existing.git('checkout', '--orphan', 'unborn')
  expect(await captureReflog(existing.host, existing.dir, null)).toBeNull()
  const r = await makeRepo({}, 0)
  const run = r.host.run.bind(r.host)
  let raced = false
  r.host.run = async (argv, options) => {
    const result = await run(argv, options)
    if (argv.includes('reflog') && argv.includes('exists') && !raced) {
      raced = true
      await r.git('commit', '--allow-empty', '-m', 'chore: before tool')
    }
    return result
  }
  const boundary = await captureReflog(r.host, r.dir, null)
  expect(raced).toBe(true)
  expect(boundary).toBeNull()
  const head = await r.git('rev-parse', 'HEAD')
  expect(await agentCandidates(r.host, r.dir, null, head, boundary)).toEqual([])
})

test('real Git merge creations and manual completions are witnessed, fast-forward is not', async () => {
  for (const manual of [false, true]) {
    const r = await makeRepo({ 'base.txt': 'base\n' })
    await r.git('checkout', '-b', 'other')
    r.write('other.txt', 'other\n'); await r.git('add', '-A'); await r.git('commit', '-m', 'feat: other')
    await r.git('checkout', 'main')
    r.write('main.txt', 'main\n'); await r.git('add', '-A'); await r.git('commit', '-m', 'feat: main')
    const from = await r.git('rev-parse', 'HEAD')
    const boundary = await captureReflog(r.host, r.dir, from)
    await r.git('merge', '--no-ff', ...(manual ? ['--no-commit'] : []), 'other', '-m', 'feat: merge')
    if (manual) await r.git('commit', '-m', 'feat: merge')
    const to = await r.git('rev-parse', 'HEAD')
    const action = await r.git('reflog', 'show', '-1', '--format=%gs', 'HEAD')
    expect(action).toStartWith(manual ? 'commit (merge): ' : 'merge other: Merge made by ')
    expect((await agentCandidates(r.host, r.dir, from, to, boundary)).map((c) => c.hash)).toEqual([to])
    await r.git('checkout', '-b', 'forward')
    await r.git('commit', '--allow-empty', '-m', 'feat: already created')
    const forward = await r.git('rev-parse', 'HEAD')
    await r.git('checkout', 'main')
    const beforeForward = await captureReflog(r.host, r.dir, to)
    await r.git('merge', '--ff-only', 'forward')
    expect(await r.git('reflog', 'show', '-1', '--format=%gs', 'HEAD')).toContain('Fast-forward')
    expect(await agentCandidates(r.host, r.dir, to, forward, beforeForward)).toEqual([])
  }
})

test('real Git cherry-pick completion and rebase continuation prove creation', async () => {
  for (const operation of ['cherry-pick', 'rebase'] as const) {
    const r = await makeRepo({ 'a.txt': 'base\n' })
    await r.git('checkout', '-b', 'other')
    r.write('a.txt', 'other\n'); await r.git('commit', '-am', 'feat: other')
    await r.git('checkout', 'main')
    r.write('a.txt', 'main\n'); await r.git('commit', '-am', 'feat: main')
    const from = await r.git('rev-parse', 'HEAD')
    const boundary = await captureReflog(r.host, r.dir, from)
    expect((await r.host.run(['git', '-C', r.dir, operation, 'other'])).exitCode).toBe(1)
    r.write('a.txt', 'resolved\n'); await r.git('add', 'a.txt')
    if (operation === 'cherry-pick') await r.git('commit', '-m', 'feat: resolved')
    else await r.git('-c', 'core.editor=true', 'rebase', '--continue')
    const to = await r.git('rev-parse', 'HEAD')
    const actions = (await r.git('reflog', 'show', '--format=%gs', 'HEAD')).split('\n')
    expect(actions.some((action) => action.startsWith(operation === 'cherry-pick' ? 'commit (cherry-pick): ' : 'rebase (continue): '))).toBe(true)
    expect((await agentCandidates(r.host, r.dir, from, to, boundary)).map((c) => c.hash)).toEqual([to])
  }
})

test('unavailable, malformed, ambiguous and truncated witnesses fail closed', async () => {
  const r = await makeRepo()
  const from = hash(1), to = hash(2)
  const record = (oid: string, action: string, time = 100) => `${oid}\0HEAD@{${time} +0000}\0${action}\0`
  const baseline = record(from, 'commit: baseline')
  const boundary = { entry: baseline.slice(0, -1) }
  const fresh = record(to, 'commit: during', 101)
  const scripted = (stdout: string) => Object.assign(Object.create(r.host), { run: async (argv: string[]) => ({ exitCode: 0, stdout: argv.includes('rev-list') ? `${to} 101\n` : stdout, stderr: '' }) })
  expect(await captureReflog(scripted('broken'), r.dir, from)).toBeNull()
  expect(await agentCandidates(scripted('broken'), r.dir, from, to, boundary)).toEqual([])
  expect(await agentCandidates(scripted(fresh + baseline + baseline), r.dir, from, to, boundary)).toEqual([])
  expect(await agentCandidates(scripted(record(hash(3), 'commit: raced') + fresh + baseline), r.dir, from, to, boundary)).toEqual([])
  const older = Array.from({ length: 499 }, (_, n) => record(hash(n + 10), 'commit: older', n + 1)).join('')
  // A long existing reflog is safe when the captured boundary is still in the bounded read.
  expect(await agentCandidates(scripted(fresh + baseline + older), r.dir, from, to, boundary)).toEqual([{ hash: to, time: 101 }])
  expect(await agentCandidates(scripted(fresh + older + record(hash(999), 'commit: older')), r.dir, from, to, boundary)).toEqual([])
  const failed = Object.assign(Object.create(r.host), { run: async () => { throw new Error('unavailable') } })
  expect(await captureReflog(failed, r.dir, from)).toBeNull()
  expect(await agentCandidates(failed, r.dir, from, to, boundary)).toEqual([])
})
