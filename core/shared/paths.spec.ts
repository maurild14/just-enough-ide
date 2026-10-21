import { expect, test } from 'bun:test'
import { insideRel, isInside, joinPath, nativePath, nativeRel, parentDirs, platformOf, projectRel, relativeTo, toPosix } from './paths.ts'
import * as paths from './paths.ts'

test('canonical containment preserves exact Windows component identity and refuses ambiguous metadata', () => {
  expect(paths).toHaveProperty('canonicalRel')
  for (const outside of ['C:/fixture/K/keep.txt', 'C:/fixture/K/keep.txt', 'C:/fixture/k-extra/keep.txt', 'keep.txt', 'C:keep.txt', 'C:/fixture/k/../keep.txt', 'C:/fixture/k//keep.txt']) expect(paths.canonicalRel('C:/fixture/k', outside, 'win32')).toBeNull()
  expect(paths.canonicalRel('C:\\fixture\\k', 'C:/fixture/k/src/K.txt', 'win32')).toBe('src/K.txt')
  expect(paths.canonicalRel('//files.example/share/k', '//files.example/share/k/a', 'win32')).toBe('a')
  expect(paths.canonicalRel('//files.example/share/k', '//files.example/share/K/a', 'win32')).toBeNull()
  expect(paths.canonicalRel('/acme-app', '/acme-app/a:b', 'linux')).toBe('a:b')
  expect(paths.canonicalRel('/acme-app', '/acme-app/a\nb.txt', 'linux')).toBe('a\nb.txt')
  expect(paths.canonicalRel('C:/acme-app', 'C:/acme-app/a\nb.txt', 'win32')).toBeNull()
  expect(paths.canonicalRel('/acme-app', '/acme-app', 'linux')).toBe('')
})

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

test('projectRel keeps typed paths inside the root', () => {
  expect(projectRel('/work/acme-app', 'src/api/user.ts')).toBe('src/api/user.ts')
  expect(projectRel('/work/acme-app', './src/../src/api')).toBe('src/api')
  expect(projectRel('/work/acme-app', '/work/acme-app/src/api/user.ts')).toBe('src/api/user.ts')
  expect(projectRel('C:\\work\\acme-app', 'C:\\Work\\acme-app\\src\\a.ts')).toBe('src/a.ts')
  expect(projectRel('C:\\work\\acme-app', 'src\\a.ts')).toBe('src/a.ts')
  expect(projectRel('/work/acme-app', '/work/acme-app')).toBe('')
  expect(projectRel('/work/acme-app', '/etc/passwd')).toBeNull()
  expect(projectRel('/work/acme-app', '../other/x.ts')).toBeNull()
  expect(projectRel('/work/acme-app', 'src/../../x.ts')).toBeNull()
  expect(projectRel('/work/acme-app', 'D:/work/acme-app/x.ts')).toBeNull()
})

test('insideRel preserves literal whitespace and rejects paths outside the root', () => {
  expect(insideRel('/acme-app', ' leading.ts')).toBe(' leading.ts')
  expect(insideRel('/acme-app', 'leading.ts ')).toBe('leading.ts ')
  expect(insideRel('/acme-app', '/acme-app/ leading.ts')).toBe(' leading.ts')
  expect(insideRel('C:/acme-app', 'src\\ leading.ts')).toBe('src/ leading.ts')
  for (const path of ['../outside.ts', '/outside.ts', 'D:/outside.ts', 'C:outside.ts', '//outside/share/file.ts']) {
    expect(insideRel('/acme-app', path)).toBeNull()
  }
  expect(projectRel('/acme-app', ' leading.ts ')).toBe('leading.ts')
})

test('platformOf reads the path shape', () => {
  expect(platformOf('C:\\work\\acme-app')).toBe('win32')
  expect(platformOf('c:/work/acme-app')).toBe('win32')
  expect(platformOf('\\\\server\\share\\acme-app')).toBe('win32')
  expect(platformOf('/Users/ana/acme-app')).toBe('darwin')
  expect(platformOf('/home/ana/acme-app')).toBe('linux')
  expect(platformOf('')).toBe('linux')
})

test('nativePath uses backslashes on Windows only', () => {
  expect(nativePath('win32', 'C:/work/acme-app/a b.ts')).toBe('C:' + String.fromCharCode(92) + 'work' + String.fromCharCode(92) + 'acme-app' + String.fromCharCode(92) + 'a b.ts')
  expect(nativePath('linux', '/work/acme-app/a.ts')).toBe('/work/acme-app/a.ts')
  expect(nativePath('darwin', '/Users/ana/acme-app/a.ts')).toBe('/Users/ana/acme-app/a.ts')
})

test('native literal paths keep POSIX colons and refuse unsupported backslashes before normalization', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    expect(nativeRel('/work/acme-app', './a:b.txt', platform)).toBe('a:b.txt')
    expect(nativeRel('/work/acme-app', 'a:b.txt', platform)).toBe('a:b.txt')
    expect(nativeRel('/work/acme-app', '/work/acme-app/a:b.txt', platform)).toBe('a:b.txt')
    expect(nativeRel('/work/acme-app', './a\\b.txt', platform)).toBeNull()
    expect(nativeRel('/work/acme-app', '../outside.txt', platform)).toBeNull()
    expect(nativeRel('/work/acme-app', '/outside.txt', platform)).toBeNull()
    expect(nativeRel('//work/acme-app', '//work/acme-app/a:b.txt', platform)).toBe('a:b.txt')
    expect(nativeRel('//work/acme-app', '//WORK/acme-app/a.txt', platform)).toBeNull()
  }
  expect(nativeRel('C:/work/acme-app', 'src\\a.txt', 'win32')).toBe('src/a.txt')
  for (const path of ['C:outside.txt', 'D:/outside.txt', '..\\outside.txt']) expect(nativeRel('C:/work/acme-app', path, 'win32')).toBeNull()
})
