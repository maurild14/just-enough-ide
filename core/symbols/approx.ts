import type { SearchQuery } from '../search/rg.ts'
import { codeLines, languageFor, outline, SYMBOL_CAP, type SymbolNode } from './outline.ts'

type Language = NonNullable<ReturnType<typeof languageFor>>
export type SymbolRef = { rel: string; line: number; text: string; container: string | null }
const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const languages: Language[] = ['ts', 'py', 'go', 'rs', 'java', 'cs', 'md']
const extensions = { ts: 'ts', py: 'py', go: 'go', rs: 'rs', java: 'java', cs: 'cs', md: 'md' }

export function definitionArgs(name: string, lang: ReturnType<typeof languageFor>): SearchQuery {
  const word = escape(name)
  const boundary = '([^A-Za-z0-9_$]|$)'
  const modifiers = '((export|default|declare|async|abstract|public|private|protected|internal|static|final|sealed|partial|virtual|override|pub|unsafe)[ \t]+)*'
  const shapes = {
    ts: `${modifiers}(function[ \t]*\\*?[ \t]+|class[ \t]+|interface[ \t]+|type[ \t]+|enum[ \t]+|const[ \t]+)${word}${boundary}`,
    py: `(async[ \t]+)?(def|class)[ \t]+${word}${boundary}`,
    go: `(func[ \t]+(\\([^)]*\\)[ \t]*)?|type[ \t]+)${word}${boundary}`,
    rs: `(pub(\\([^)]*\\))?[ \t]+)?(async[ \t]+)?(fn|struct|enum|trait)[ \t]+${word}${boundary}`,
    java: `${modifiers}((class|interface|enum|record)[ \t]+|[A-Za-z_$][^ \t()=;{}]*[ \t]+)${word}${boundary}`,
    cs: `${modifiers}((class|interface|enum|record|struct)[ \t]+|[A-Za-z_$][^ \t()=;{}]*[ \t]+)${word}${boundary}`,
    md: `#{1,6}[ \t]+${word}([ \t]+#*)?[ \t]*$`,
  }
  // Bare method declarations need a body marker to distinguish them from calls.
  const methods = `${modifiers}${word}[ \t]*(<[^>]*>)?[ \t]*\\([^)]*\\)[ \t]*(:[^={;]*)?\\{`
  return { text: `^[ \t]*(${(lang ? [shapes[lang]] : languages.map((item) => shapes[item])).join('|')}${!lang || ['ts', 'java', 'cs'].includes(lang) ? `|${methods}` : ''})`, regex: true, caseSensitive: true, wholeWord: false, include: [], exclude: [] }
}

export function isDefinitionLine(lang: Language, name: string, line: string): boolean {
  const bounded = line.slice(0, 2000)
  if (outline(`symbol.${extensions[lang]}`, bounded)?.some((node) => node.name === name)) return true
  if (['ts', 'java', 'cs'].includes(lang)) {
    const wrapped = outline(`symbol.${extensions[lang]}`, `class Container {\n${bounded}\n}`)
    return wrapped?.[0]?.children.some((node) => node.name === name) ?? false
  }
  return false
}

export function referencesQuery(name: string): SearchQuery {
  return { text: name, regex: false, wholeWord: true, caseSensitive: true, include: [], exclude: [] }
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'def', 'class', 'func', 'fn', 'new', 'super', 'this', 'sizeof', 'typeof', 'assert', 'match', 'with', 'except'])

export function calleeNames(text: string, node: SymbolNode, lang: Language): string[] {
  const names = new Set<string>()
  for (const { line, code } of codeLines(text, lang)) {
    if (line > node.endLine) break
    if (line < node.line) continue
    for (const match of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = match[0]
      let end = match.index + name.length
      while (code[end] === ' ' || code[end] === '\t') end++
      if (code[end] === '(' && name !== node.name && !KEYWORDS.has(name)) names.add(name)
      if (names.size >= SYMBOL_CAP) return [...names]
    }
  }
  return [...names]
}
