import type { Platform } from '../host.ts'
import { nativeRel, platformOf } from '../shared/paths.ts'
import type { SymbolRef } from './approx.ts'
import { SYMBOL_CAP, type SymbolKind, type SymbolNode } from './outline.ts'

export type LspOp = 'documentSymbol' | 'workspaceSymbol' | 'goToDefinition' | 'findReferences' | 'incomingCalls' | 'outgoingCalls'
const headers: Record<LspOp, string[]> = {
  documentSymbol: ['document symbols'], workspaceSymbol: ['workspace symbols'], goToDefinition: ['definition', 'definitions'],
  findReferences: ['references'], incomingCalls: ['incoming calls'], outgoingCalls: ['outgoing calls'],
}
const kinds = new Set<SymbolKind>(['function', 'class', 'method', 'type', 'interface', 'enum', 'const', 'heading'])

/** Synthetic fixture contract only; unknown real tool output must use the approximate fallback. */
export function parseLsp(op: LspOp, text: string, root: string, platform?: Platform): { symbols?: SymbolNode[]; refs?: SymbolRef[] } | null {
  if (text.length > 8 * 1024 * 1024 || !platform && root.startsWith('//')) return null
  const nativePlatform = platform ?? platformOf(root)
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('Synthetic fixture:'))
  if (!headers[op].includes(lines.shift()?.trim().replace(/:$/, '').toLowerCase() ?? '')) return null
  if (lines.length === 1 && /^(no results|no symbols|no references|no calls)\.$/i.test(lines[0]!.trim())) return op === 'documentSymbol' ? { symbols: [] } : { refs: [] }
  if (!lines.length) return null
  const symbols: SymbolNode[] = []
  const refs: SymbolRef[] = []
  const stack: { indent: number; node: SymbolNode }[] = []
  let count = 0
  for (const raw of lines) {
    if (++count > SYMBOL_CAP || raw.length > 4000) return null
    const body = raw.trim().replace(/^[-*]\s+/, '')
    // Match delimiters only: retrying a path prefix before whitespace makes long filenames quadratic.
    const location = /(?:\(line (\d+)(?:-(\d+))?\)|:(\d+):(\d+)(?:-(\d+):(\d+))?)(?=$|\s+-\s+)/.exec(body)
    if (!location) return null
    if (location[1] !== undefined && !/\s/.test(body[location.index - 1] ?? '')) return null
    let path = body.slice(0, location.index)
    if (location[1] !== undefined) path = path.trimEnd()
    const metadata = /\((\w+)\)\s+(?:-\s+)?/g
    let symbol: RegExpExecArray | null
    do { symbol = metadata.exec(path) } while (symbol && !/\s/.test(path[symbol.index - 1] ?? ''))
    const name = symbol ? path.slice(0, symbol.index).trimEnd() : ''
    if (symbol && !name) return null
    if (symbol) path = path.slice(symbol.index + symbol[0].length)
    const tail = body.slice(location.index + location[0].length)
    const text = tail ? tail.replace(/^\s+-\s+/, '') : name
    const rel = path.includes('\0') ? null : nativeRel(root, path, nativePlatform)
    const line = Number(location[1] ?? location[3])
    const endLine = Number(location[2] ?? location[5] ?? line)
    if (!rel || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(endLine) || endLine < line || location[4] !== undefined && Number(location[4]) < 1) return null
    if (op === 'documentSymbol') {
      if (!symbol || !kinds.has(symbol[1] as SymbolKind)) return null
      const node: SymbolNode = { name, kind: symbol[1] as SymbolKind, line, endLine, children: [] }
      const indent = raw.length - raw.trimStart().length
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
      const siblings = stack[stack.length - 1]?.node.children ?? symbols
      siblings.push(node)
      stack.push({ indent, node })
    } else refs.push({ rel, line, text, container: null })
  }
  return op === 'documentSymbol' ? { symbols } : { refs }
}
