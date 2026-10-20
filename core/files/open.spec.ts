import { describe, expect, test } from 'bun:test'
import { openArgv, openRefusal, openUrlArgv } from './open.ts'

const path = 'C:\\x\\a b.ts'

test('URL opening only accepts HTTPS and reuses the platform opener', () => {
  const url = 'https://github.com/acme/acme-app'
  expect(openUrlArgv(url, 'win32')).toEqual(['explorer.exe', url])
  expect(openUrlArgv(url, 'darwin')).toEqual(['open', url])
  expect(openUrlArgv(url, 'linux')).toEqual(['xdg-open', url])
  for (const value of ['file:///x', 'http://github.com/acme/acme-app', '-x', 'https://', 'https://ana:tok@github.com/acme/acme-app', 'https://github.com/\nfile']) expect(openUrlArgv(value, 'win32')).toBeNull()
})

describe('openArgv', () => {
  test('empty command uses the OS opener', () => {
    expect(openArgv({ editorCommand: '', path, platform: 'win32' })).toEqual(['explorer.exe', path])
    expect(openArgv({ editorCommand: '  ', path: '/a', platform: 'darwin' })).toEqual(['open', '/a'])
    expect(openArgv({ editorCommand: '', path: '/a', platform: 'linux' })).toEqual(['xdg-open', '/a'])
  })
  test('{path}:{line} keeps the rest of the word', () => {
    expect(openArgv({ editorCommand: 'code -g {path}:{line}', path, line: 3, platform: 'win32' })).toEqual(['code', '-g', 'C:\\x\\a b.ts:3'])
  })
  test('no line strips :{line} from {path}:{line}', () => {
    expect(openArgv({ editorCommand: 'code -g {path}:{line}', path, platform: 'win32' })).toEqual(['code', '-g', path])
  })
  test('a word that only carries the line is dropped without a line', () => {
    expect(openArgv({ editorCommand: 'ed {path} :{line}', path: '/a', platform: 'linux' })).toEqual(['ed', '/a'])
    expect(openArgv({ editorCommand: 'ed {path} {line}', path: '/a', platform: 'linux' })).toEqual(['ed', '/a'])
    expect(openArgv({ editorCommand: 'ed --goto={line} {path}', path: '/a', platform: 'linux' })).toEqual(['ed', '/a'])
    expect(openArgv({ editorCommand: 'ed {path} +{line}', path: '/a', line: 9, platform: 'linux' })).toEqual(['ed', '/a', '+9'])
  })
  test('no {path} appends the path', () => {
    expect(openArgv({ editorCommand: 'zed', path: '/a', platform: 'linux' })).toEqual(['zed', '/a'])
    expect(openArgv({ editorCommand: 'zed', path: '/a', line: 2, platform: 'linux' })).toEqual(['zed', '/a'])
  })
  test('quoted words stay whole; $ in a path is literal', () => {
    expect(openArgv({ editorCommand: '"my editor" --open {path}', path: '/$&/a', platform: 'linux' })).toEqual(['my editor', '--open', '/$&/a'])
  })
})

describe('openRefusal', () => {
  const runnable = ['exe', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msc', 'scr', 'lnk', 'reg', 'hta', 'cpl', 'jar', 'sh', 'command', 'app', 'desktop', 'appimage']
  test('the OS opener refuses runnable types, any case', () => {
    for (const ext of runnable) {
      expect(openRefusal({ editorCommand: '', path: `/w/acme-app/run.${ext}` })).toBe('Set editorCommand to open this file type.')
      expect(openRefusal({ editorCommand: ' ', path: `C:\\w\\RUN.${ext.toUpperCase()}` })).toBe('Set editorCommand to open this file type.')
    }
    expect(openRefusal({ editorCommand: '', path: '/w/setup.bat. ' })).toBe('Set editorCommand to open this file type.')
  })
  test('documents, folders and a set editor command pass', () => {
    for (const p of ['/w/a.ts', '/w/README.md', '/w/src', '/w/.env', '/w/archive.tar.gz', '/w/js', '/w/bat.txt']) expect(openRefusal({ editorCommand: '', path: p })).toBeNull()
    expect(openRefusal({ editorCommand: 'code -g {path}', path: '/w/run.sh' })).toBeNull()
  })
})
