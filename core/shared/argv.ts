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

/** A shell the agent's own shell tool runs: Bash (POSIX) or PowerShell. */
export type Shell = 'bash' | 'powershell'

// PowerShell treats the typographic single quotes as quote characters too.
const PS_QUOTES = /['\u2018\u2019\u201a\u201b]/g

/**
 * One word as a single-quoted literal for `shell`: nothing inside expands.
 * Bash cannot escape inside single quotes, so a `'` closes, adds `\'` and
 * reopens; PowerShell doubles each quote character.
 */
export function shellQuote(word: string, shell: Shell): string {
  if (shell === 'powershell') return `'${word.replace(PS_QUOTES, (q) => q + q)}'`
  return `'${word.replaceAll("'", "'\\''")}'`
}

// Words both shells read literally when bare: no globs, variables, splatting, arrays or escapes.
const BARE = /^[A-Za-z0-9_./:=-]+$/

/**
 * An argv as one command line for `shell`: the program bare, every other word bare when it is plain
 * (so permission rules such as `Bash(git commit:*)` still match) and single-quoted otherwise.
 */
export function shellLine(argv: readonly string[], shell: Shell): string {
  const [program = '', ...rest] = argv
  return [program, ...rest.map((w) => (BARE.test(w) ? w : shellQuote(w, shell)))].join(' ')
}
