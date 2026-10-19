import type { Touch } from './classify.ts'

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'type', 'get-content', 'gc'])
const SEARCHERS = new Set(['rg', 'grep'])
const GIT_MUTATING = new Set(['commit', 'push', 'pull', 'checkout', 'switch', 'merge', 'rebase', 'reset'])

// Flags that consume the next word (so it is not mistaken for a path).
const VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  head: new Set(['-n', '-c']),
  tail: new Set(['-n', '-c']),
  'get-content': new Set(['-totalcount', '-tail', '-head', '-first', '-last', '-encoding', '-delimiter', '-readcount', '-filter', '-include', '-exclude']),
  rg: new Set(['-e', '-f', '-g', '-t', '-T', '-A', '-B', '-C', '-m', '--regexp', '--file', '--glob', '--type', '--type-not', '--max-count', '--context', '--after-context', '--before-context']),
  grep: new Set(['-e', '-f', '-A', '-B', '-C', '-m', '--regexp', '--file', '--include', '--exclude', '--max-count', '--context']),
}
const PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file'])

/**
 * Split on `|`, `||`, `&&`, `;` and `&` outside quotes, and each segment into
 * words (quotes removed). Unquoted redirections (`>`, `>>`, `2>`, `>&`, `&>`,
 * `<`, also in the middle of a word) are dropped together with their target,
 * whether the target is attached or the next word. Quoted `>` is an argument.
 */
function segments(command: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let cur = ''
  let has = false
  let digitsOnly = true // the pending word is an unquoted run of digits (a file descriptor)
  let skipNext = false // the next word is a redirection target
  let quote: string | null = null
  const flushWord = () => {
    if (has) {
      if (skipNext) skipNext = false
      else words.push(cur)
    }
    cur = ''
    has = false
    digitsOnly = true
  }
  const flushSegment = () => {
    flushWord()
    skipNext = false
    if (words.length > 0) out.push(words)
    words = []
  }
  const chars = [...command]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
      digitsOnly = false
    } else if (/\s/.test(ch)) {
      flushWord()
    } else if (ch === '>' || ch === '<' || (ch === '&' && chars[i + 1] === '>')) {
      if (has && digitsOnly) {
        cur = '' // `2>`: the descriptor belongs to the operator
        has = false
      } else flushWord()
      while (chars[i] === '>' || chars[i] === '<' || chars[i] === '&') i++
      i--
      skipNext = true
    } else if (ch === '|' || ch === ';' || ch === '&') {
      flushSegment()
    } else {
      cur += ch
      has = true
      if (!/\d/.test(ch)) digitsOnly = false
    }
  }
  flushSegment()
  return out
}

function baseName(word: string): string {
  const name = word.replaceAll('\\', '/').split('/').pop() ?? word
  return name.toLowerCase().replace(/\.exe$/, '')
}

function readPaths(cmd: string, args: string[]): string[] {
  const valueFlags = VALUE_FLAGS[cmd] ?? new Set<string>()
  const searcher = SEARCHERS.has(cmd)
  const powershell = cmd === 'get-content' || cmd === 'gc'
  const paths: string[] = []
  let patternGiven = false
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    const lower = powershell ? w.toLowerCase() : w
    if (powershell && (lower === '-path' || lower === '-literalpath')) {
      const v = args[++i]
      if (v !== undefined) paths.push(v)
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      if (searcher && PATTERN_FLAGS.has(w)) patternGiven = true
      if (valueFlags.has(lower) || valueFlags.has(w)) i++
      continue
    }
    if (searcher && !patternGiven) {
      patternGiven = true
      continue
    }
    paths.push(w)
  }
  return paths
}

const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

/** First word that is not a global option or an option's value (`--opt=value` is one word). */
function gitSubcommand(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    if (GIT_VALUE_OPTS.has(w)) i++
    else if (!w.startsWith('-')) return w
  }
  return undefined
}

/** Classify a command line by reading it; nothing is ever executed. */
export function classifyShell(command: string): Touch | null {
  const reads: string[] = []
  let git = false
  for (const seg of segments(command)) {
    const words = seg
    if (words.length === 0) continue
    const cmd = baseName(words[0]!)
    if (cmd === 'git') {
      const sub = gitSubcommand(words.slice(1))
      if (sub && GIT_MUTATING.has(sub)) git = true
    } else if (READERS.has(cmd) || SEARCHERS.has(cmd)) {
      for (const p of readPaths(cmd, words.slice(1))) if (!reads.includes(p)) reads.push(p)
    }
  }
  if (git) return { kind: 'git', paths: [] }
  return reads.length > 0 ? { kind: 'read', paths: reads } : null
}
