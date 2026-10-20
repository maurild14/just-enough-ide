import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseLsp, type LspOp } from './lsp.ts'

const fixture = (op: LspOp) => readFileSync(new URL(`../../test/fixtures/lsp/${op}.txt`, import.meta.url), 'utf8')
test('explicitly synthetic operation fixtures parse as nodes or references', () => {
  expect(parseLsp('documentSymbol', fixture('documentSymbol'), '/acme-app')).toEqual({ symbols: [{ name: 'Store', kind: 'class', line: 1, endLine: 9, children: [{ name: 'getUser', kind: 'method', line: 3, endLine: 8, children: [] }] }] })
  for (const op of ['workspaceSymbol', 'goToDefinition', 'findReferences', 'incomingCalls', 'outgoingCalls'] as const) {
    const result = parseLsp(op, fixture(op), '/acme-app')
    expect(result?.refs?.length).toBe(op === 'findReferences' ? 2 : 1)
    expect(result?.refs?.[0]?.rel).toBe(op === 'incomingCalls' ? 'src/app.ts' : op === 'outgoingCalls' ? 'src/storage.ts' : 'src/store.ts')
    expect(result?.refs?.[0]?.line).toBe(op === 'incomingCalls' ? 8 : op === 'outgoingCalls' ? 2 : op === 'findReferences' ? 5 : 3)
  }
})

test('location forms, whitespace, Windows paths and field order vary without losing path identity', () => {
  expect(parseLsp('goToDefinition', '\nDefinition:\nC:\\acme-app\\src\\store.ts:3:2 - getUser\n', 'C:/acme-app')?.refs?.[0]).toEqual({ rel: 'src/store.ts', line: 3, text: 'getUser', container: null })
  expect(parseLsp('workspaceSymbol', 'Workspace symbols:\nsrc/store.ts (line 3) - getUser (function)', '/acme-app')?.refs?.[0]?.text).toBe('getUser (function)')
  expect(parseLsp('goToDefinition', 'Definition:\n/a/acme-app/a:b.ts:4:1 - load', '/a/acme-app')?.refs?.[0]?.rel).toBe('a:b.ts')
})

test('unknown, empty, malformed and escaping output falls back rather than inventing success', () => {
  for (const text of ['garbled', '', 'References:\nnot a location', 'References:\n../secret.ts:1:1', 'References:\n/a/secret.ts:1:1', 'References:\nsrc/app.ts:0:1', 'References:\nsrc/a\\b.ts:1:1']) expect(parseLsp('findReferences', text, '/acme-app')).toBeNull()
  expect(parseLsp('findReferences', 'Definition:\nsrc/app.ts:1:1', '/acme-app')).toBeNull()
  expect(parseLsp('findReferences', 'References:\nNo results.', '/acme-app')).toEqual({ refs: [] })
  expect(parseLsp('documentSymbol', 'Document symbols:\n' + Array.from({ length: 2001 }, (_, i) => `  - child${i} (function) src/app.ts:${i + 1}:1`).join('\n'), '/acme-app')).toBeNull()
  expect(parseLsp('documentSymbol', 'Document symbols:\n- Store (class) src/app.ts:1:1-3000:1\n' + Array.from({ length: 2000 }, (_, i) => `  - child${i} (method) src/app.ts:${i + 2}:1`).join('\n'), '/acme-app')).toBeNull()
})
