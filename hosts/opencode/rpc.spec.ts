import { expect, test } from 'bun:test'
import { JsonSchema, SchemaRepresentation } from 'effect'
import type { GitSnapshot } from '../../core/git/service.ts'
import { JeiRpc, fromWire, toWire, type WireGitSnapshot } from './rpc.ts'

test('git snapshots survive a JSON round trip with text and binary numstat counts', () => {
  const wire: WireGitSnapshot = {
    root: '/work/acme-app',
    status: {
      branch: { head: 'main', oid: null, upstream: null, ahead: 0, behind: 0 },
      entries: [{ path: 'src/a.ts', index: 'modified', worktree: null }],
    },
    numstat: { 'src/a.ts': { added: 3, removed: 1 }, 'logo.png': { added: null, removed: null } },
    staged: { 'src/a.ts': { added: 1, removed: 0 } }, hooks: true,
  }
  const snap: GitSnapshot = fromWire(wire)
  expect(snap.root !== null && snap.numstat.get('logo.png')).toEqual({ added: null, removed: null })
  expect(toWire(snap)).toEqual(wire)
  expect(fromWire(JSON.parse(JSON.stringify(toWire(snap))))).toEqual(snap)
  expect(toWire(fromWire({ root: null }))).toEqual({ root: null })
})

test('the portable contract names every service, includes error previews and declares path errors', () => {
  expect(JeiRpc.id).toBe('jei')
  expect(Object.keys(JeiRpc.methods)).toEqual(['state', 'listDir', 'preview', 'allFiles', 'open', 'stage', 'unstage', 'discard', 'diff', 'generate', 'commitPlan', 'commit', 'init', 'sync', 'graph', 'commitFiles', 'branches', 'switchBranch', 'createBranch', 'compare', 'checkout', 'revert', 'fetch', 'webUrl', 'openWeb', 'searchStart', 'searchCancel', 'replacePlan', 'replaceApply', 'quickOpenFiles', 'outline', 'findSymbol', 'definitions', 'references', 'incoming', 'outgoing'])
  expect(JeiRpc.methods.preview.output.properties.kind.enum).toContain('error')
  expect(JeiRpc.methods.commit.input.required).toEqual(['message', 'mode', 'approvedSensitive'])
  expect(JeiRpc.methods.commit.input.properties.approvedSensitive).toEqual({ type: 'array', items: { type: 'string' } })
  expect(JeiRpc.methods.sync.input.required).toEqual([])
  expect(JeiRpc.methods.open.input.required).toEqual(['rel'])
  for (const name of ['listDir', 'preview', 'open', 'stage', 'unstage', 'discard', 'diff'] as const) {
    expect(JeiRpc.methods[name].errors.outside_root.type).toBe('object')
  }
  expect(JSON.parse(JSON.stringify(JeiRpc))).toEqual(JeiRpc)
})


test('history schemas are closed objects with full hashes and explicit confirmation', () => {
  for (const method of ['graph', 'commitFiles', 'branches', 'switchBranch', 'createBranch', 'compare', 'checkout', 'revert', 'fetch', 'webUrl', 'openWeb'] as const) {
    expect(JeiRpc.methods[method].input.additionalProperties).toBe(false)
  }
  expect(JeiRpc.methods.commitFiles.input.properties.hash).toEqual({ type: 'string', minLength: 40, maxLength: 40 })
  for (const method of ['switchBranch', 'createBranch', 'checkout', 'revert'] as const) expect(JeiRpc.methods[method].input.required).toContain('confirmed')
})

test('every portable schema compiles with the installed host validator defaults', () => {
  for (const method of Object.values(JeiRpc.methods)) for (const schema of [method.input, method.output]) {
    expect(() => SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(schema))).not.toThrow()
  }
  for (const event of Object.values(JeiRpc.events)) expect(() => SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(event.schema))).not.toThrow()
})

test('Search and Symbols declare closed session-scoped review and streaming contracts', () => {
  const methods = JeiRpc.methods as Record<string, any>
  for (const name of ['searchStart', 'searchCancel', 'replacePlan', 'replaceApply', 'quickOpenFiles', 'outline', 'findSymbol', 'definitions', 'references', 'incoming', 'outgoing']) expect(methods[name]?.input.additionalProperties).toBe(false)
  expect(methods.searchStart.input.required).toContain('sessionID')
  expect(methods.searchStart.input.properties.query.additionalProperties).toBe(false)
  expect(methods.replaceApply.output.properties.error).toEqual({ type: 'string' })
  expect(methods.outline.output.required).toContain('file')
  expect((JeiRpc.events as any).searchMatches.schema.required).toEqual(['sessionID', 'id', 'matches'])
})
