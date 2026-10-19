import { expect, test } from 'bun:test'
import { isInside, joinPath, parentDirs, relativeTo, toPosix } from './paths.ts'

test('toPosix', () => expect(toPosix('a\\b\\c')).toBe('a/b/c'))

test('joinPath', () => {
  expect(joinPath('a', 'b')).toBe('a/b')
  expect(joinPath('a/', 'b')).toBe('a/b')
  expect(joinPath('C:\\x\\my app', 'ñ.ts')).toBe('C:/x/my app/ñ.ts')
  expect(joinPath('/', 'etc')).toBe('/etc')
})

test('relativeTo', () => {
  expect(relativeTo('C:\\Users\\x\\my app', 'C:\\Users\\x\\my app\\src\\ñ.ts')).toBe('src/ñ.ts')
  expect(relativeTo('/r', '/r/./a/../b.ts')).toBe('b.ts')
  expect(relativeTo('/r', '/r')).toBe('')
  expect(relativeTo('/r', '/other/x')).toBe('/other/x')
})

test('isInside', () => {
  expect(isInside('/r', '/r/a/b')).toBe(true)
  expect(isInside('/r', '/r')).toBe(true)
  expect(isInside('/r', '/r/../etc')).toBe(false)
  expect(isInside('/r', '/rr/a')).toBe(false)
  expect(isInside('/r', '/R/a')).toBe(false)
  expect(isInside('C:\\R', 'c:\\r\\a')).toBe(true)
  expect(isInside('C:\\R', 'D:\\r\\a')).toBe(false)
  expect(isInside('C:\\R', 'C:\\R\\..\\x')).toBe(false)
})

test('parentDirs', () => {
  expect(parentDirs('a/b/c.ts')).toEqual(['a', 'a/b'])
  expect(parentDirs('c.ts')).toEqual([])
})
