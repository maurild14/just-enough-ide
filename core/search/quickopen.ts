import { fuzzyScore } from '../shared/fuzzy.ts'

export function quickOpenArgs(inRepo: boolean): string[] {
  return inRepo ? ['ls-files', '-co', '--exclude-standard', '-z'] : ['rg', '--files', '--no-config', '--null']
}

export function parseQuery(text: string): { name: string; line: number | null } {
  const match = /^(.*):([1-9]\d*)$/.exec(text)
  return match && Number.isSafeInteger(Number(match[2])) ? { name: match[1]!, line: Number(match[2]) } : { name: text, line: null }
}

export function rankFiles(query: string, files: readonly string[], tiers: { touched: ReadonlySet<string>; recent: readonly string[] }, limit: number): string[] {
  const recent = new Set(tiers.recent)
  return files.flatMap((rel) => {
    const score = fuzzyScore(query, rel)
    if (score === null) return []
    const basename = rel.slice(rel.lastIndexOf('/') + 1)
    return [{ rel, tier: tiers.touched.has(rel) ? 0 : recent.has(rel) ? 1 : 2,
      score: score + (query && fuzzyScore(query, basename) !== null ? 100 : 0) }]
  }).sort((a, b) => a.tier - b.tier || (query ? b.score - a.score || a.rel.length - b.rel.length : 0) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .slice(0, Math.max(0, limit)).map(({ rel }) => rel)
}
