import { describe, expect, test } from 'bun:test'
import { cellWidth } from '../shared/fit.ts'
import { iconFor } from './icons.ts'

describe('iconFor', () => {
  test('plain and auto use Unicode', () => {
    for (const g of ['plain', 'auto'] as const) {
      expect(iconFor('src', true, false, g)).toBe('▸')
      expect(iconFor('src', true, true, g)).toBe('▾')
      expect(iconFor('a.ts', false, false, g)).toBe('·')
    }
  })
  test('nerd maps by extension, falls back to a default', () => {
    const ts = iconFor('a.ts', false, false, 'nerd')
    expect(ts).not.toBe('·')
    expect(iconFor('b.TS', false, false, 'nerd')).toBe(ts)
    expect(iconFor('a.json', false, false, 'nerd')).not.toBe(ts)
    expect(iconFor('a.zzz', false, false, 'nerd')).toBe(iconFor('b.qqq', false, false, 'nerd'))
    expect(iconFor('src', true, true, 'nerd')).not.toBe(iconFor('src', true, false, 'nerd'))
  })
  test('every icon is one cell', () => {
    for (const g of ['plain', 'auto', 'nerd'] as const)
      for (const n of ['a.ts', 'a.js', 'a.json', 'a.md', 'a.py', 'a.go', 'a.rs', 'a.zzz'])
        expect(cellWidth(iconFor(n, false, false, g))).toBe(1)
  })
})
