import { expect, test } from 'bun:test'
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
  expect(Object.keys(JeiRpc.methods)).toEqual(['state', 'listDir', 'preview', 'allFiles', 'open', 'stage', 'unstage', 'discard', 'diff', 'generate', 'commitPlan', 'commit', 'init', 'sync'])
  expect(JeiRpc.methods.preview.output.properties.kind.enum).toContain('error')
  expect(JeiRpc.methods.commit.input.required).toEqual(['message', 'mode', 'allowSensitive'])
  expect(JeiRpc.methods.sync.input.required).toEqual([])
  expect(JeiRpc.methods.open.input.required).toEqual(['rel'])
  for (const name of ['listDir', 'preview', 'open', 'stage', 'unstage', 'discard', 'diff'] as const) {
    expect(JeiRpc.methods[name].errors.outside_root.type).toBe('object')
  }
  expect(JSON.parse(JSON.stringify(JeiRpc))).toEqual(JeiRpc)
})
