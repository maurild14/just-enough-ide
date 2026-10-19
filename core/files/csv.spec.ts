import { expect, test } from 'bun:test'
import { parseDelimited } from './csv.ts'

test('quoted fields, escaped quotes, CRLF', () => {
  expect(parseDelimited('a,"b,c"\r\n"d""e",f', ',', 10)).toEqual([['a', 'b,c'], ['d"e', 'f']])
})
test('tab delimiter and quoted newline', () => {
  expect(parseDelimited('a\tb\n"x\ny"\tz\n', '\t', 10)).toEqual([['a', 'b'], ['x\ny', 'z']])
})
test('maxRows, trailing newline, empty text, BOM, empty fields', () => {
  expect(parseDelimited('1\n2\n3\n', ',', 2)).toEqual([['1'], ['2']])
  expect(parseDelimited('1,2\n', ',', 10)).toEqual([['1', '2']])
  expect(parseDelimited('', ',', 10)).toEqual([])
  expect(parseDelimited('﻿a,,c', ',', 10)).toEqual([['a', '', 'c']])
  expect(parseDelimited('a', ',', 0)).toEqual([])
})
test('unterminated quote keeps the rest', () => {
  expect(parseDelimited('a,"b', ',', 10)).toEqual([['a', 'b']])
})
