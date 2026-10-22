import { cellWidth } from '../shared/fit.ts'
import type { ActivityKind } from './classify.ts'

export const ACTIVITY_FRAME_MS = 60
export const SWEEP_MS = 1200

const PALETTE = {
  dark: { read: ['#c084fc', '#f3e8ff'], write: ['#fb923c', '#fff3d6'], git: ['#4ade80', '#dcfce7'] },
  light: { read: ['#7e22ce', '#4a0878'], write: ['#c2410c', '#772307'], git: ['#15803d', '#074b24'] },
} as const

/** A contrasting crest stays readable on light backgrounds too. */
export function shimmerColor(kind: ActivityKind, mode: 'light' | 'dark', strength = 0): string {
  const [base, crest] = PALETTE[mode][kind]
  return '#' + [1, 3, 5].map(i => {
    const a = parseInt(base.slice(i, i + 2), 16), b = parseInt(crest.slice(i, i + 2), 16)
    return Math.round(a + (b - a) * Math.max(0, Math.min(1, strength))).toString(16).padStart(2, '0')
  }).join('')
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** One soft band crosses the label left to right; trailing padding never stretches its travel. */
export function shimmerRuns(text: string, now: number): { text: string; strength: number }[] {
  const width = cellWidth(text.trimEnd()), radius = Math.max(3, width * 0.3)
  const center = (Math.max(0, now) % SWEEP_MS) / SWEEP_MS * (width + radius * 2) - radius
  const runs: { text: string; strength: number }[] = []
  let column = 0
  for (const { segment } of graphemes.segment(text)) {
    const cells = cellWidth(segment)
    const strength = column >= width ? 0 : Math.round(Math.max(0, 1 - Math.abs(column + cells / 2 - center) / radius) ** 2 * 8) / 8
    const last = runs.at(-1)
    if (last?.strength === strength) last.text += segment
    else runs.push({ text: segment, strength })
    column += cells
  }
  return runs
}
