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
export function parseLsp(op: LspOp, text: string, root: string): { symbols?: SymbolNode[]; refs?: SymbolRef[] } | null {
  if (text.length > 8 * 1024 * 1024) return null
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
    const location = /^(.*?)(?:\s+\(line (\d+)(?:-(\d+))?\)|:(\d+):(\d+)(?:-(\d+):(\d+))?)(?:\s+-\s+(.*))?$/.exec(body)
    if (!location) return null
    let path = location[1]!
    const symbol = /^(.+?)\s+\((\w+)\)\s+(?:-\s+)?(.+)$/.exec(path)
    if (symbol) path = symbol[3]!
    const rel = path.includes('\0') ? null : nativeRel(root, path, platformOf(root))
    const line = Number(location[2] ?? location[4])
    const endLine = Number(location[3] ?? location[6] ?? line)
    if (!rel || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(endLine) || endLine < line || location[5] !== undefined && Number(location[5]) < 1) return null
    if (op === 'documentSymbol') {
      if (!symbol || !kinds.has(symbol[2] as SymbolKind)) return null
      const node: SymbolNode = { name: symbol[1]!, kind: symbol[2] as SymbolKind, line, endLine, children: [] }
      const indent = raw.length - raw.trimStart().length
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
      const siblings = stack[stack.length - 1]?.node.children ?? symbols
      siblings.push(node)
      stack.push({ indent, node })
    } else refs.push({ rel, line, text: location[8] ?? (symbol ? symbol[1]! : ''), container: null })
  }
  return op === 'documentSymbol' ? { symbols } : { refs }
}
