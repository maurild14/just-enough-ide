import { expect, test } from 'bun:test'
import { cellWidth } from '../shared/fit.ts'
import { fitTable, parseDelimited } from './csv.ts'

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

test('fitTable pads columns and never passes the width', () => {
  const rows = [['name', 'role'], ['Ana Rivera', 'admin'], ['Leo Park', 'dev']]
  expect(fitTable(rows, 80)).toEqual(['name        role', 'Ana Rivera  admin', 'Leo Park    dev'])
  expect(fitTable(rows, 40)).toEqual(['name       role', 'Ana Rivera admin', 'Leo Park   dev'])
  for (let w = 0; w <= 30; w++) for (const line of fitTable(rows, w)) expect(cellWidth(line)).toBeLessThanOrEqual(w)
})
test('fitTable shrinks the widest column first, then drops columns', () => {
  const rows = [['id', 'description'], ['1', 'a very long description text']]
  const lines = fitTable(rows, 20)
  expect(lines[1]).toBe('1  a very long desc…')
  expect(lines.every((l) => cellWidth(l) <= 20)).toBe(true)
  expect(fitTable([['a', 'b', 'c']], 3)).toEqual(['a b'])
  expect(fitTable([], 20)).toEqual([])
})
test('fitTable flattens newlines and tabs in cells', () => {
  expect(fitTable([['a\nb', 'c\td']], 80)).toEqual(['a b  c d'])
})
