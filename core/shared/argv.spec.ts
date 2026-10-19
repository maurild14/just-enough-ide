import { expect, test } from 'bun:test'
import { shellLine, shellQuote, splitCommand } from './argv.ts'

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

test('shellQuote: bash closes, escapes and reopens a single quote', () => {
  expect(shellQuote("fix: don't crash", 'bash')).toBe("'fix: don'\\''t crash'")
  expect(shellQuote('a $HOME `x` "y"\nbody', 'bash')).toBe("'a $HOME `x` \"y\"\nbody'")
})

test('shellQuote: PowerShell doubles every single-quote form', () => {
  expect(shellQuote("fix: don't crash", 'powershell')).toBe("'fix: don''t crash'")
  expect(shellQuote('it\u2019s $env:X', 'powershell')).toBe("'it\u2019\u2019s $env:X'")
})

test('shellLine quotes only the words that need it', () => {
  expect(shellLine(['git', '-C', '/work/acme-app', 'commit', '-m', "it's"], 'bash')).toBe(
    "git -C /work/acme-app commit -m 'it'\\''s'",
  )
  expect(shellLine(['git', '-C', 'C:\\work\\acme app', 'push', '-u', 'origin', 'feat/x'], 'powershell')).toBe(
    "git -C 'C:\\work\\acme app' push -u origin feat/x",
  )
  // Splatting, arrays, globs, variables and the empty word are always quoted.
  expect(shellLine(['git', '@x', 'a,b', '*.ts', '$HOME', '~', ''], 'powershell')).toBe("git '@x' 'a,b' '*.ts' '$HOME' '~' ''")
})
