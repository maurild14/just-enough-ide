/**
 * Split a command line into words. Single or double quotes keep a word whole and
 * are removed. There is no shell: no escapes, no expansion, no operators.
 */
export function splitCommand(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote: string | null = null
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}
