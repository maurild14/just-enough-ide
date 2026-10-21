import { expect, test } from 'bun:test'
import { ActivityLog, GLOW_MS, allows, shimmerPhase } from './log.ts'

test('glow fades linearly', () => {
  const log = new ActivityLog()
  log.touch('a.ts', 'read', 1000)
  expect(log.glow('a.ts', 1000)).toBe(1)
  expect(log.glow('a.ts', 1000 + GLOW_MS / 2)).toBe(0.5)
  expect(log.glow('a.ts', 1000 + GLOW_MS)).toBe(0)
  expect(log.glow('a.ts', 9999)).toBe(0)
  expect(log.glow('none.ts', 1000)).toBe(0)
  expect(log.touched('a.ts')).toBe(true)
  expect(log.touched('b.ts')).toBe(false)
})

test('overlapping active tools hold the glow until the final completion, then fade', () => {
  const log = new ActivityLog()
  log.start('src/user.ts', 'read', 1000)
  log.start('src/user.ts', 'write', 2000)
  const restored = ActivityLog.from(log.toJSON())
  expect(restored.glow('src/user.ts', 10_000)).toBe(1)
  restored.finish('src/user.ts', 'read', 10_000)
  expect(restored.glow('src/user.ts', 20_000)).toBe(1)
  restored.finish('src/user.ts', 'write', 20_000)
  expect(restored.glow('src/user.ts', 21_000)).toBe(0.5)
  expect(restored.glow('src/user.ts', 22_000)).toBe(0)
  expect(restored.toJSON()['src/user.ts']?.active).toBeUndefined()
})

test('kindOf is the latest kind; isGlowing', () => {
  const log = new ActivityLog()
  expect(log.isGlowing(0)).toBe(false)
  log.touch('a.ts', 'read', 0)
  log.touch('a.ts', 'write', 100)
  expect(log.kindOf('a.ts')).toBe('write')
  expect(log.kindOf('x')).toBeNull()
  expect(log.isGlowing(1000)).toBe(true)
  expect(log.isGlowing(2100)).toBe(false)
})

test('JSON round trip', () => {
  const log = new ActivityLog()
  log.touch('a.ts', 'write', 5)
  const copy = ActivityLog.from(JSON.parse(JSON.stringify(log.toJSON())))
  expect(copy.toJSON()).toEqual({ 'a.ts': { kind: 'write', at: 5 } })
  expect(copy.touched('a.ts')).toBe(true)
})

test('allows', () => {
  expect(allows('writes', 'read')).toBe(false)
  expect(allows('writes', 'write')).toBe(true)
  expect(allows('reads', 'write')).toBe(false)
  expect(allows('reads', 'read')).toBe(true)
  expect(allows('reads and writes', 'read')).toBe(true)
  expect(allows('writes', 'git')).toBe(true)
  expect(allows('none', 'git')).toBe(false)
  expect(allows('none', 'write')).toBe(false)
})

test('folder activity follows the latest allowed descendant, fades and respects literal path boundaries', () => {
  const log = new ActivityLog()
  log.touch('src/old.ts', 'write', 0)
  log.touch('src/api/user.ts', 'read', 500)
  log.touch('src-other/new.ts', 'git', 900)
  expect(log.forRow('src', true, 1000, 'reads and writes')).toEqual({ kind: 'read', glow: 0.75, inherited: true })
  expect(log.forRow('src', true, 1000, 'writes')).toEqual({ kind: 'write', glow: 0.5, inherited: true })
  expect(log.forRow('src', true, 2500, 'reads and writes')).toBeNull()
  expect(log.forRow('src', true, 1000, 'none')).toBeNull()
  expect(log.forRow('src/api/user.ts', false, 2500, 'reads')).toEqual({ kind: 'read', glow: 0, inherited: false })
})

test('shimmerPhase follows the 16-color steps of docs/design.md', () => {
  // bold 0-700 ms, color 700-1400 ms, dim 1400-2000 ms, then none
  const at = (ms: number) => shimmerPhase(Math.max(0, 1 - ms / GLOW_MS))
  expect(at(0)).toBe('bold')
  expect(at(699)).toBe('bold')
  expect(at(700)).toBe('color')
  expect(at(1399)).toBe('color')
  expect(at(1400)).toBe('dim')
  expect(at(1999)).toBe('dim')
  expect(at(2000)).toBe('none')
})
