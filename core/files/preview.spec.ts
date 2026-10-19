import { describe, expect, test } from 'bun:test'
import { languageOf, PREVIEW_MAX_BYTES, previewKind } from './preview.ts'

const text = new TextEncoder().encode('hello')

describe('previewKind', () => {
  test('kinds', () => {
    expect(previewKind('x.png', 10, text)).toBe('image')
    expect(previewKind('X.JPG', 10, text)).toBe('image')
    expect(previewKind('a.ts', 3 * 1024 * 1024, text)).toBe('too-large')
    expect(previewKind('a.ts', PREVIEW_MAX_BYTES, text)).toBe('code')
    expect(previewKind('a.bin', 10, new Uint8Array([1, 0, 2]))).toBe('binary')
    expect(previewKind('README.md', 10, text)).toBe('markdown')
    expect(previewKind('d.csv', 10, text)).toBe('csv')
    expect(previewKind('d.tsv', 10, text)).toBe('tsv')
    expect(previewKind('a.ts', 0, new Uint8Array())).toBe('empty')
    expect(previewKind('a.ts', 10, text)).toBe('code')
  })
  test('NUL after the first 8 KiB does not count', () => {
    const head = new Uint8Array(9000).fill(65)
    head[8500] = 0
    expect(previewKind('a.txt', 9000, head)).toBe('code')
    head[8191] = 0
    expect(previewKind('a.txt', 9000, head)).toBe('binary')
  })
})

describe('languageOf', () => {
  test('by extension and special names', () => {
    expect(languageOf('a.ts')).toBe('typescript')
    expect(languageOf('A.PY')).toBe('python')
    expect(languageOf('Dockerfile')).toBe('dockerfile')
    expect(languageOf('Makefile')).toBe('makefile')
    expect(languageOf('notes.zzz')).toBeUndefined()
    expect(languageOf('.gitignore')).toBeUndefined()
    expect(languageOf('LICENSE')).toBeUndefined()
  })
})
