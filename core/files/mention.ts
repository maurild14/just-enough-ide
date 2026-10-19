import { toPosix } from '../shared/paths.ts'

/** '@src/a.ts @"my file.ts" ' for the prompt: posix rels, spaces quoted, one trailing space. '' for no paths. */
export function mentionText(rels: readonly string[]): string {
  if (rels.length === 0) return ''
  return rels
    .map((rel) => {
      const p = toPosix(rel)
      return /\s/.test(p) ? `@"${p}"` : `@${p}`
    })
    .join(' ') + ' '
}
