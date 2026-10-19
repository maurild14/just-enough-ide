const MATCH = 1
const WORD_START = 8
const BASENAME = 3
const CONSECUTIVE = 5
const GAP = 0.3
const LEAD = 0.1
const LENGTH = 0.02

function isBoundary(prev: string, ch: string): boolean {
  if ('/_-. '.includes(prev)) return true
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && ch !== ch.toLowerCase()
}

/**
 * Subsequence match, case-insensitive. Higher is better, null means no match.
 * Bonuses: word starts (after / _ - . or camelCase), consecutive characters,
 * characters inside the basename.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  const m = q.length
  const n = c.length
  if (m === 0) return 0
  if (m > n) return null

  const baseStart = candidate.lastIndexOf('/') + 1
  const gain: number[] = []
  for (let j = 0; j < n; j++) {
    let s = MATCH
    if (j === 0 || isBoundary(candidate[j - 1]!, candidate[j]!)) s += WORD_START
    if (j >= baseStart) s += BASENAME
    gain.push(s)
  }

  const NEG = -Infinity
  let prev: number[] = []
  for (let j = 0; j < n; j++) prev.push(c[j] === q[0] ? gain[j]! - LEAD * j : NEG)
  for (let i = 1; i < m; i++) {
    const cur: number[] = new Array<number>(n).fill(NEG)
    let run = NEG // max over k <= j-2 of prev[k] + GAP * k
    for (let j = 1; j < n; j++) {
      if (j >= 2) run = Math.max(run, prev[j - 2]! + GAP * (j - 2))
      if (c[j] !== q[i]) continue
      const viaGap = run === NEG ? NEG : run - GAP * (j - 1)
      const viaRun = prev[j - 1] === NEG ? NEG : prev[j - 1]! + CONSECUTIVE
      const best = Math.max(viaGap, viaRun)
      if (best !== NEG) cur[j] = best + gain[j]!
    }
    prev = cur
  }
  const best = Math.max(...prev)
  return best === NEG ? null : best - LENGTH * n
}
