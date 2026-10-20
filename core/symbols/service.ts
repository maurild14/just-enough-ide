import type { Host } from '../host.ts'
import { decodeUtf8, type Match } from '../search/rg.ts'
import { search } from '../search/service.ts'
import { nativeRel, joinPath } from '../shared/paths.ts'
import { calleeNames, definitionArgs, isDefinitionLine, referencesQuery, type SymbolRef } from './approx.ts'
import { enclosing, languageFor, outline, type SymbolNode } from './outline.ts'

export type Source = 'lsp' | 'approximate'
const TEXT_CAP = 4 * 1024 * 1024
const languages = ['ts', 'py', 'go', 'rs', 'java', 'cs', 'md'] as const

export async function readSource(host: Host, root: string, rel: string): Promise<string | null> {
  const safe = rel.includes('\0') ? null : nativeRel(root, rel, host.platform)
  if (!safe) return null
  const path = joinPath(root, safe)
  const [info, rootInfo] = await Promise.all([host.stat(path), host.stat(root)])
  if (!info || !rootInfo || info.kind !== 'file' || info.size > TEXT_CAP || !Number.isSafeInteger(info.size) || info.size < 0 || nativeRel(rootInfo.realPath, info.realPath, host.platform) === null) return null
  const bytes = await host.readHead(path, info.size + 1)
  if (!bytes || bytes.length !== info.size || bytes.includes(0)) return null
  return decodeUtf8(bytes)
}

export async function fileOutline(host: Host, root: string, rel: string): Promise<SymbolNode[] | null> {
  if (!languageFor(rel)) return null
  const text = await readSource(host, root, rel)
  return text === null ? null : outline(rel, text)
}

const definitionLine = (rel: string, name: string, line: string) => {
  const lang = languageFor(rel)
  return lang ? isDefinitionLine(lang, name, line) : languages.some((item) => isDefinitionLine(item, name, line))
}

export async function findSymbol(host: Host, root: string, name: string): Promise<SymbolRef[]> {
  const refs: SymbolRef[] = []
  const result = await search(host, root, definitionArgs(name, null), (match) => {
    if (definitionLine(match.rel, name, match.text)) refs.push({ rel: match.rel, line: match.line, text: match.text, container: null })
  }).done
  if (result.error) throw new Error(result.error)
  return refs
}

export async function definitions(host: Host, root: string, name: string, fromRel: string): Promise<SymbolRef[]> {
  const refs = await findSymbol(host, root, name)
  const safe = nativeRel(root, fromRel, host.platform)
  return [...refs.filter((ref) => ref.rel === safe), ...refs.filter((ref) => ref.rel !== safe)]
}

async function referenceData(host: Host, root: string, name: string): Promise<{ refs: SymbolRef[]; outlines: Map<string, SymbolNode[] | null> }> {
  const matches: Match[] = []
  const result = await search(host, root, referencesQuery(name), (match) => matches.push(match)).done
  if (result.error) throw new Error(result.error)
  const outlines = new Map<string, SymbolNode[] | null>()
  const refs: SymbolRef[] = []
  for (const match of matches) {
    if (!outlines.has(match.rel)) outlines.set(match.rel, await fileOutline(host, root, match.rel))
    const node = enclosing(outlines.get(match.rel) ?? [], match.line)
    refs.push({ rel: match.rel, line: match.line, text: match.text, container: node?.name ?? null })
  }
  return { refs, outlines }
}

export async function references(host: Host, root: string, name: string): Promise<SymbolRef[]> {
  return (await referenceData(host, root, name)).refs
}

export async function incoming(host: Host, root: string, name: string): Promise<SymbolRef[]> {
  const { refs, outlines } = await referenceData(host, root, name)
  const callers = new Map<string, SymbolRef>()
  for (const ref of refs) {
    const node = enclosing(outlines.get(ref.rel) ?? [], ref.line)
    if (!node || !['function', 'method'].includes(node.kind) || definitionLine(ref.rel, name, ref.text)) continue
    const key = JSON.stringify([ref.rel, node.line])
    if (!callers.has(key)) callers.set(key, { ...ref, line: node.line, container: node.name })
  }
  return [...callers.values()]
}

export async function outgoing(host: Host, root: string, rel: string, node: SymbolNode): Promise<SymbolRef[]> {
  const lang = languageFor(rel)
  const text = lang ? await readSource(host, root, rel) : null
  if (!lang || text === null) return []
  const refs: SymbolRef[] = []
  for (const name of calleeNames(text, node, lang)) {
    const first = (await definitions(host, root, name, rel))[0]
    if (first) refs.push(first)
  }
  return refs
}

export function symbolSendText(name: string, def: SymbolRef | null, refs: readonly SymbolRef[]): string {
  const cap = 12_000
  const header = `${name}${def ? ` (${def.rel}:${def.line})` : ''} and its ${refs.length} references: `
  const parts: string[] = []
  let length = header.length
  for (const ref of refs) {
    const part = `${ref.rel}:${ref.line}`
    const remaining = refs.length - parts.length - 1
    const suffix = remaining ? `, …and ${remaining} more.` : ''
    if (length + (parts.length ? 2 : 0) + part.length + suffix.length > cap) break
    parts.push(part)
    length += part.length + (parts.length > 1 ? 2 : 0)
  }
  const remaining = refs.length - parts.length
  const suffix = remaining ? `${parts.length ? ', ' : ''}…and ${remaining} more.` : ''
  return header.slice(0, Math.max(0, cap - parts.join(', ').length - suffix.length)) + parts.join(', ') + suffix
}
