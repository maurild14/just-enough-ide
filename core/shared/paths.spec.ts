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

test('paths escaping a relative root are outside', () => {
  expect(isInside('.', '../x')).toBe(false)
  expect(isInside('', '../../etc')).toBe(false)
  expect(isInside('.', 'a/b')).toBe(true)
  expect(isInside('../a', '../a/b')).toBe(true)
})

test('windows-style roots', () => {
  expect(isInside('C:\\R\\', 'c:\\r\\a')).toBe(true)
  expect(isInside('C:', 'C:/x')).toBe(true)
  expect(isInside('\\\\srv\\share\\R', '\\\\SRV\\Share\\r\\a')).toBe(true)
  expect(isInside('\\\\srv\\share\\R', '\\\\srv\\other\\r\\a')).toBe(false)
})

test('parentDirs ignores dot segments', () => {
  expect(parentDirs('./a/./b.ts')).toEqual(['a'])
})

test('absolute and relative roots never match each other', () => {
  expect(isInside('/r', 'r/a')).toBe(false)
  expect(isInside('/r', 'a/b')).toBe(false)
  expect(isInside('', '/x')).toBe(false)
  expect(isInside('', '/etc/passwd')).toBe(false)
  expect(isInside('//srv/share', 'srv/share/x')).toBe(false)
  expect(isInside('//srv/share', '//srv/share/x')).toBe(true)
})
