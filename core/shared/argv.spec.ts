import { expect, test } from 'bun:test'
import { splitCommand } from './argv.ts'

test('double quotes keep a word whole', () => {
  expect(splitCommand('code -g "{path}:{line}"')).toEqual(['code', '-g', '{path}:{line}'])
})

test('single quotes', () => {
  expect(splitCommand("zed 'my file'")).toEqual(['zed', 'my file'])
})

test('whitespace, empties, windows paths', () => {
  expect(splitCommand('  a   b ')).toEqual(['a', 'b'])
  expect(splitCommand('')).toEqual([])
  expect(splitCommand('a "" b')).toEqual(['a', '', 'b'])
  expect(splitCommand('"C:\\Program Files\\x.exe" --f')).toEqual(['C:\\Program Files\\x.exe', '--f'])
  expect(splitCommand('a"b c"d')).toEqual(['ab cd'])
})

test('unterminated quote keeps the rest', () => {
  expect(splitCommand('a "b c')).toEqual(['a', 'b c'])
})

test('no shell operators', () => {
  expect(splitCommand('a && b')).toEqual(['a', '&&', 'b'])
})
