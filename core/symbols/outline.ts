export type SymbolKind = 'function' | 'class' | 'method' | 'type' | 'interface' | 'enum' | 'const' | 'heading'
export type SymbolNode = { name: string; kind: SymbolKind; line: number; endLine: number; children: SymbolNode[] }
export const SYMBOL_CAP = 2000
type Language = 'ts' | 'py' | 'go' | 'rs' | 'java' | 'cs' | 'md'
const EXTENSIONS: Record<string, Language> = { py: 'py', go: 'go', rs: 'rs', java: 'java', cs: 'cs', md: 'md', markdown: 'md' }

export function languageFor(rel: string): Language | null {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) return 'ts'
  return EXTENSIONS[ext] ?? null
}

/** Bounded line scanner shared with calls; strings/comments cannot contribute braces or calls. */
export function* codeLines(text: string, lang: Language): Generator<{ line: number; code: string }> {
  let block = false
  let quote = ''
  let triple = false
  let line = 0
  for (let at = 0; at < text.length;) {
    const newline = text.indexOf('\n', at)
    const end = newline < 0 ? text.length : newline
    const raw = text.slice(at, Math.min(end, at + 2000)).replace(/\r$/, '')
    const out: string[] = []
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!
      const next = raw[i + 1]
      if (block) {
        if (ch === '*' && next === '/') { block = false; out.push('  '); i++ }
        else out.push(' ')
      } else if (quote) {
        if (ch === '\\') { out.push('  '); i++ }
        else if (triple && raw.slice(i, i + 3) === quote.repeat(3)) { out.push('   '); i += 2; quote = ''; triple = false }
        else if (!triple && ch === quote) { quote = ''; out.push(' ') }
        else out.push(' ')
      } else if (lang === 'py' && ch === '#' || lang !== 'py' && ch === '/' && next === '/') break
      else if (lang !== 'py' && ch === '/' && next === '*') { block = true; out.push('  '); i++ }
      else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        triple = lang === 'py' && raw.slice(i, i + 3) === ch.repeat(3)
        if (triple) { out.push('   '); i += 2 } else out.push(' ')
      } else out.push(ch)
    }
    if (!triple && quote !== '`') quote = ''
    yield { line: ++line, code: out.join('') }
    at = end + 1
  }
}

const NON_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'function', 'super', 'this', 'else'])

function declaration(code: string, lang: Language, parent?: SymbolNode): { name: string; kind: SymbolKind; receiver?: string } | null {
  let match: RegExpExecArray | null
  if (lang === 'ts') {
    const prefix = code.replace(/^\s*(?:(?:export|default|declare|async|abstract)\s+)*/, '')
    match = /^(function\s*\*?\s+|class\s+|interface\s+|type\s+|enum\s+)([\w$]+)/.exec(prefix)
    if (match) return { name: match[2]!, kind: match[1]!.trim().startsWith('function') ? 'function' : match[1]!.trim() as SymbolKind }
    match = /^export\s+const\s+([\w$]+)\s*=/.exec(code.trimStart())
    if (match) return { name: match[1]!, kind: code.includes('=>') ? 'function' : 'const' }
  } else if (lang === 'go') {
    match = /^\s*func\s+(?:\(\s*\w+\s+\*?(\w+)(?:\[[^\]]*\])?\s*\)\s*)?(\w+)\s*(?:\[[^\]]*\])?\s*\(/.exec(code)
    if (match) return { name: match[2]!, kind: match[1] ? 'method' : 'function', receiver: match[1] }
    match = /^\s*type\s+(\w+)/.exec(code)
    if (match) return { name: match[1]!, kind: 'type' }
  } else if (lang === 'rs') {
    const prefix = code.replace(/^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const|extern)\s+)*/, '')
    match = /^(fn|struct|enum|trait)\s+(\w+)/.exec(prefix)
    if (match) return { name: match[2]!, kind: match[1] === 'fn' ? parent && ['type', 'class', 'interface'].includes(parent.kind) ? 'method' : 'function' : match[1] === 'struct' ? 'class' : match[1] === 'trait' ? 'interface' : 'enum' }
    match = /^impl(?:<[^>]*>)?\s+([^{}]+)/.exec(prefix)
    if (match) return { name: `impl ${match[1]!.trim().replace(/<[^>]*>/g, '')}`, kind: 'type' }
  } else if (lang === 'java' || lang === 'cs') {
    match = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial)\s+)*(class|interface|enum|record|struct)\s+(\w+)/.exec(code)
    if (match) return { name: match[2]!, kind: ['record', 'struct'].includes(match[1]!) ? 'class' : match[1] as SymbolKind }
  }
  if (parent && ['class', 'interface'].includes(parent.kind) && ['ts', 'java', 'cs'].includes(lang)) {
    match = /^\s*((?:[\w$<>\[\],?.]+\s+)*)([\w$]+)\s*(?:<[^>]*>)?\s*\(/.exec(code)
    const first = /^\s*([\w$]+)/.exec(code)?.[1]
    const typed = match && match[1]!.trim().length > 0
    if (match && !NON_METHOD.has(match[2]!) && !NON_METHOD.has(first ?? '') && (code.includes('{') || code.trimEnd().endsWith(';') || !code.includes(')') || code.trimEnd().endsWith(')') && typed)) return { name: match[2]!, kind: 'method' }
  }
  return null
}

function indentation(code: string): number {
  let columns = 0
  for (const ch of code) {
    if (ch === ' ') columns++
    else if (ch === '\t') columns += 8 - columns % 8
    else break
  }
  return columns
}

export function outline(rel: string, text: string): SymbolNode[] | null {
  const lang = languageFor(rel)
  if (!lang) return null
  const roots: SymbolNode[] = []
  const stack: { node: SymbolNode; depth: number; waiting?: boolean }[] = []
  const goTypes = new Map<string, SymbolNode>()
  const receivers: { node: SymbolNode; receiver: string }[] = []
  let count = 0
  let depth = 0
  let lastLine = 0
  let fence = ''
  for (const { line, code } of lang === 'md' ? markdownLines(text) : codeLines(text, lang)) {
    lastLine = line
    let found: ReturnType<typeof declaration> = null
    let level = 0
    if (lang === 'md') {
      const fenced = /^\s{0,3}(`{3,}|~{3,})/.exec(code)
      if (fenced) { if (!fence) fence = fenced[1]![0]!; else if (fenced[1]![0] === fence) fence = ''; continue }
      if (fence) continue
      const heading = /^\s{0,3}(#{1,6})[ \t]+(.+)$/.exec(code)
      if (!heading) continue
      level = heading[1]!.length
      while (stack.length && stack[stack.length - 1]!.depth >= level) stack.pop()!.node.endLine = line - 1
      found = { name: heading[2]!.replace(/[ \t]+#+[ \t]*$/, '').trim(), kind: 'heading' }
    } else if (lang === 'py') {
      if (!code.trim()) continue
      level = indentation(code)
      while (stack.length && stack[stack.length - 1]!.depth >= level) stack.pop()!.node.endLine = line - 1
      const match = /^\s*(?:async\s+)?(def|class)\s+(\w+)/.exec(code)
      if (match) found = { name: match[2]!, kind: match[1] === 'class' ? 'class' : stack[stack.length - 1]?.node.kind === 'class' ? 'method' : 'function' }
    } else found = declaration(code, lang, stack[stack.length - 1]?.node)
    if (found && count < SYMBOL_CAP) {
      const node: SymbolNode = { name: found.name, kind: found.kind, line, endLine: line, children: [] }
      const siblings = stack[stack.length - 1]?.node.children ?? roots
      siblings.push(node)
      count++
      if (lang === 'go' && found.kind === 'type') goTypes.set(found.name, node)
      if (found.receiver) receivers.push({ node, receiver: found.receiver })
      const block = lang === 'md' || lang === 'py' || code.includes('{') || (!code.includes(';') && (['class', 'interface', 'function', 'method', 'enum'].includes(found.kind) || lang === 'rs' && found.name.startsWith('impl ')))
      if (block) stack.push({ node, depth: lang === 'md' || lang === 'py' ? level : depth + 1, waiting: lang !== 'md' && lang !== 'py' && !code.includes('{') })
    }
    if (lang !== 'md' && lang !== 'py') {
      for (const ch of code) {
        if (ch === '{') { depth++; const scope = stack[stack.length - 1]; if (scope?.waiting && depth >= scope.depth) scope.waiting = false }
        else if (ch === '}') depth = Math.max(0, depth - 1)
      }
      while (stack.length && !stack[stack.length - 1]!.waiting && depth < stack[stack.length - 1]!.depth) stack.pop()!.node.endLine = line
    }
  }
  for (const scope of stack) scope.node.endLine = lastLine
  const attached = new Set<SymbolNode>()
  for (const { node, receiver } of receivers) {
    const parent = goTypes.get(receiver)
    if (parent) { attached.add(node); parent.children.push(node) }
  }
  return attached.size ? roots.filter((node) => !attached.has(node)) : roots
}

function* markdownLines(text: string): Generator<{ line: number; code: string }> {
  let line = 0
  for (let at = 0; at < text.length;) {
    const next = text.indexOf('\n', at)
    const end = next < 0 ? text.length : next
    yield { line: ++line, code: text.slice(at, Math.min(end, at + 2000)).replace(/\r$/, '') }
    at = end + 1
  }
}

export function enclosing(nodes: readonly SymbolNode[], line: number): SymbolNode | null {
  let found: SymbolNode | null = null
  const pending = [...nodes]
  while (pending.length) {
    const node = pending.pop()!
    // Go receiver methods live under a type whose source range does not include them.
    if (node.line <= line && node.endLine >= line && (!found || node.line >= found.line && node.endLine <= found.endLine)) found = node
    pending.push(...node.children)
  }
  return found
}
