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

type Word = { text: string; quoted: boolean }

/**
 * Split on `|`, `||`, `&&`, `;` and `&` outside quotes, and each segment into
 * words (quotes removed, the word remembers it was quoted). A `&` that belongs
 * to a redirection (`2>&1`, `&>`, `>&`) is part of its word, not a separator.
 */
function segments(command: string): Word[][] {
  const out: Word[][] = []
  let words: Word[] = []
  let cur = ''
  let has = false
  let quoted = false
  let quote: string | null = null
  const flushWord = () => {
    if (has) words.push({ text: cur, quoted })
    cur = ''
    has = false
    quoted = false
  }
  const flushSegment = () => {
    flushWord()
    if (words.length > 0) out.push(words)
    words = []
  }
  const chars = [...command]
  chars.forEach((ch, i) => {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
      quoted = true
    } else if (/\s/.test(ch)) {
      flushWord()
    } else if (ch === '&' && (chars[i - 1] === '>' || chars[i - 1] === '<' || chars[i + 1] === '>')) {
      cur += ch
      has = true
    } else if (ch === '|' || ch === ';' || ch === '&') {
      flushSegment()
    } else {
      cur += ch
      has = true
    }
  })
  flushSegment()
  return out
}

function baseName(word: string): string {
  const name = word.replaceAll('\\', '/').split('/').pop() ?? word
  return name.toLowerCase().replace(/\.exe$/, '')
}

/** Drop unquoted redirections (`>`, `>>`, `2>`, `>&`, `&>`, `<`), with or without a separate target. */
function withoutRedirects(words: Word[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    const m = w.quoted ? null : /^(\d*)(&?>>?|<)(&?)(.*)$/.exec(w.text)
    if (!m) {
      out.push(w.text)
      continue
    }
    if (m[4] === '') i++ // target is the next word
  }
  return out
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
    const words = withoutRedirects(seg)
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
