import { describe, expect, test } from 'bun:test'
import { cellWidth, fitEnd, fitPath, padEnd } from './fit.ts'

const SAMPLES = [
  '',
  'a',
  'user.ts',
  'señor-ñandú.ts',
  '日本語のファイル名.md',
  'docs/設計/概要.md',
  'rocket 🚀 launch.txt',
  'e\u0301cole.txt',
  'src/components/very/deep/folder/structure/UserProfileCard.tsx',
  'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file-with-a-rather-long-name.config.json',
  'very-long-name-without-any-directory.ts',
]

describe('cellWidth', () => {
  test('narrow, wide, emoji and combining', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('ñ')).toBe(1)
    expect(cellWidth('日本')).toBe(4)
    expect(cellWidth('Ａ')).toBe(2)
    expect(cellWidth('🚀')).toBe(2)
    expect(cellWidth('e\u0301')).toBe(1)
    expect(cellWidth('…')).toBe(1)
    expect(cellWidth('▸')).toBe(1)
    expect(cellWidth('')).toBe(0)
  })
})

describe('fitEnd', () => {
  test('keeps what fits and ellipsizes the rest', () => {
    expect(fitEnd('hello', 5)).toBe('hello')
    expect(fitEnd('fix: validate user input', 10)).toBe('fix: vali…')
    expect(fitEnd('hello', 0)).toBe('')
  })
  test('wide characters never straddle the edge', () => {
    expect(fitEnd('ab中文', 4)).toBe('ab…')
  })
  test('custom ellipsis (ASCII set)', () => {
    expect(fitEnd('hello world', 8, '...')).toBe('hello...')
  })
  test('fits for every width and sample', () => {
    for (const s of SAMPLES) for (let w = 0; w <= 60; w++) {
      expect(cellWidth(fitEnd(s, w))).toBeLessThanOrEqual(w)
      expect(cellWidth(fitEnd(s, w, '...'))).toBeLessThanOrEqual(w)
    }
  })
})

describe('fitPath', () => {
  test('middle ellipsis keeps the name', () => {
    expect(fitPath('src/api/handlers/user.ts', 24)).toBe('src/api/handlers/user.ts')
    expect(fitPath('src/api/handlers/user.ts', 14)).toBe('src/…/user.ts')
    expect(fitPath('src/api/handlers/user.ts', 9)).toBe('…/user.ts')
  })
  test('name only when the marker does not fit', () => {
    expect(fitPath('src/api/handlers/user.ts', 8)).toBe('user.ts')
  })
  test('name too long keeps the extension', () => {
    expect(fitPath('src/very-long-name.ts', 10)).toBe('very-l….ts')
    expect(fitPath('very-long-name.ts', 10)).toBe('very-l….ts')
    expect(fitPath('noext-very-long-name', 8)).toBe('noext-v…')
  })
  test('fits for every width and sample; the name survives when it fits', () => {
    for (const s of SAMPLES) for (let w = 0; w <= 60; w++) {
      for (const e of ['…', '...']) {
        const out = fitPath(s, w, e)
        expect(cellWidth(out)).toBeLessThanOrEqual(w)
        const name = s.slice(s.lastIndexOf('/') + 1)
        if (cellWidth(name) <= w) expect(out.endsWith(name)).toBe(true)
      }
    }
  })
})

describe('padEnd', () => {
  test('pads by cells', () => {
    expect(padEnd('ab', 4)).toBe('ab  ')
    expect(padEnd('日本', 6)).toBe('日本  ')
    expect(padEnd('abcdef', 3)).toBe('abcdef')
  })
})
