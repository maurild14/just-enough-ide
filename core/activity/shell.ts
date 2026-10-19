import { splitCommand } from '../shared/argv.ts'
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

/** Split on `|`, `||`, `&&`, `;` and `&` outside quotes. */
function segments(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === '|' || ch === ';' || ch === '&') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

function baseName(word: string): string {
  const name = word.replaceAll('\\', '/').split('/').pop() ?? word
  return name.toLowerCase().replace(/\.exe$/, '')
}

/** Drop redirections (`>`, `>>`, `2>`, `>&`, `<`, with or without a separate target). */
function withoutRedirects(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    const m = /^(\d*)(>>?|<)(&?)(.*)$/.exec(w)
    if (!m) {
      out.push(w)
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

/** Classify a command line by reading it; nothing is ever executed. */
export function classifyShell(command: string): Touch | null {
  const reads: string[] = []
  let git = false
  for (const seg of segments(command)) {
    const words = withoutRedirects(splitCommand(seg))
    if (words.length === 0) continue
    const cmd = baseName(words[0]!)
    if (cmd === 'git') {
      const sub = words.slice(1).find((w) => !w.startsWith('-'))
      if (sub && GIT_MUTATING.has(sub)) git = true
    } else if (READERS.has(cmd) || SEARCHERS.has(cmd)) {
      for (const p of readPaths(cmd, words.slice(1))) if (!reads.includes(p)) reads.push(p)
    }
  }
  if (git) return { kind: 'git', paths: [] }
  return reads.length > 0 ? { kind: 'read', paths: reads } : null
}
