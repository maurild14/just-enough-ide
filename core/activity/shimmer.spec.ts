import { expect, test } from 'bun:test'
import { shimmerRuns, shimmerColor, SWEEP_MS } from './shimmer.ts'
import { cellWidth } from '../shared/fit.ts'

test('the gradient crest moves left to right and repeats without changing the label', () => {
  const text = '  > account.ts      '
  const crest = (now: number) => {
    const cells = shimmerRuns(text, now).flatMap(run => [...run.text].map(() => run.strength))
    return cells.indexOf(Math.max(...cells))
  }
  expect(crest(360)).toBeLessThan(crest(720))
  expect(new Set(shimmerRuns(text, 480).map(run => run.strength)).size).toBeGreaterThan(2)
  expect(shimmerRuns(text, 480)).toEqual(shimmerRuns(text, 480 + SWEEP_MS))
  for (const now of [0, 60, 360, 480, 720, 1140]) {
    const runs = shimmerRuns(text, now)
    expect(runs.map(run => run.text).join('')).toBe(text)
    expect(runs.every(run => run.strength >= 0 && run.strength <= 1)).toBe(true)
    expect(runs.at(-1)?.strength).toBe(0)
  }
})

test('gradient runs retain graphemes and cell width, including wide and combining names', () => {
  for (const text of ['e\u0301.ts', '文件.md', '👩‍💻.ts', '', '   ']) for (const now of [60, 300, 720]) {
    const runs = shimmerRuns(text, now)
    expect(runs.map(run => run.text).join('')).toBe(text)
    expect(runs.reduce((sum, run) => sum + cellWidth(run.text), 0)).toBe(cellWidth(text))
    expect(runs.some(run => /^[\u0300-\u036f\u200d]/.test(run.text))).toBe(false)
  }
})

test('all activity hues have distinct gradient stops for light and dark themes', () => {
  for (const mode of ['light', 'dark'] as const) for (const kind of ['read', 'write', 'git'] as const) {
    const colors = [0, 0.25, 0.5, 0.75, 1].map(level => shimmerColor(kind, mode, level))
    expect(new Set(colors).size).toBe(5)
    expect(colors.every(color => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
  }
})
