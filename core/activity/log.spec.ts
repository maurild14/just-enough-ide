import { expect, test } from 'bun:test'
import { ActivityLog, GLOW_MS, allows } from './log.ts'

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
