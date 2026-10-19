import { classifyShell } from './shell.ts'

export type ActivityKind = 'read' | 'write' | 'git'
export type Touch = { kind: ActivityKind; paths: string[] }

const READ = new Set(['read'])
const WRITE = new Set(['edit', 'write', 'notebookedit', 'multiedit'])
const SEARCH = new Set(['grep', 'glob', 'list'])
const SHELL = new Set(['bash', 'powershell', 'shell'])

function str(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/**
 * Map a host tool call to what it touches. Paths are raw (absolute or as the
 * tool gave them); the adapter converts them with `relativeTo`.
 */
export function classifyTool(tool: string, input: unknown): Touch | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  const id = tool.toLowerCase()
  const one = (kind: ActivityKind, p: string | undefined): Touch | null => (p ? { kind, paths: [p] } : null)

  if (READ.has(id)) return one('read', str(o, 'file_path', 'filePath', 'path'))
  if (WRITE.has(id)) return one('write', str(o, 'file_path', 'filePath', 'path', 'notebook_path'))
  if (id === 'patch') {
    const p = str(o, 'file_path', 'filePath', 'path')
    return { kind: 'write', paths: p ? [p] : [] }
  }
  if (SEARCH.has(id)) {
    const p = str(o, 'path', 'filePath', 'file_path')
    return { kind: 'read', paths: p ? [p] : [] }
  }
  if (SHELL.has(id)) {
    const c = str(o, 'command')
    return c ? classifyShell(c) : null
  }
  const p = str(o, 'filePath', 'file_path', 'path')
  if (p) return { kind: 'read', paths: [p] }
  const c = str(o, 'command')
  return c ? classifyShell(c) : null
}
