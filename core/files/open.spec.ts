import { describe, expect, test } from 'bun:test'
import { openArgv } from './open.ts'

const path = 'C:\\x\\a b.ts'

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
