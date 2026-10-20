import type { Match } from './rg.ts'

export type FileGroup = { rel: string; matches: Match[] }
export const MATCH_CAP = 2000

export class ResultSet {
  private readonly grouped = new Map<string, Match[]>()
  private count = 0
  private cut = false
  add(match: Match): boolean {
    if (this.count >= MATCH_CAP) { this.cut = true; return false }
    const matches = this.grouped.get(match.rel) ?? []
    matches.push(match)
    this.grouped.set(match.rel, matches)
    this.count++
    return true
  }
  groups(): FileGroup[] { return [...this.grouped].map(([rel, matches]) => ({ rel, matches: [...matches] })) }
  total(): number { return this.count }
  files(): number { return this.grouped.size }
  truncated(): boolean { return this.cut }
}

export function sendText(query: string, matches: readonly Match[], cap = 12_000): string {
  const max = Math.max(0, cap)
  const snippets = matches.map((m) => `${m.rel}:${m.line} (${m.text.trim().slice(0, 80)})`)
  const header = matches.length === 1 ? '' : `These are the ${matches.length} uses of ${query}: `
  if ((header + snippets.join(', ')).length <= max) return header + snippets.join(', ')
  let text = header
  let shown = 0
  for (const snippet of snippets) {
    const next = text + (shown ? ', ' : '') + snippet
    const suffix = `, …and ${matches.length - shown - 1} more.`
    if (next.length + suffix.length > max) break
    text = next
    shown++
  }
  const suffix = `…and ${matches.length - shown} more.`
  return text.slice(0, Math.max(0, max - suffix.length - 2)) + (text && max >= suffix.length + 2 ? ', ' : '') + suffix.slice(0, max)
}
